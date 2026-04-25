/**
 * Webhook Service tests
 *
 * Covers all three handlers:
 *   1. handleCheckoutSessionCompleted — happy path, idempotency, db errors
 *   2. handleCheckoutSessionExpired   — happy path, idempotency, db errors
 *   3. handlePaymentIntentFailed      — happy path, idempotency, not found
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
  handlePaymentIntentFailed,
} from "./webhook-service";

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockState = {
  payment?: Record<string, unknown> | null;
  paymentUpdateError?: { message: string } | null;
  jobUpdateError?: { message: string } | null;
};

let state: MockState = {};
const capturedPaymentUpdates: Record<string, unknown>[] = [];
const capturedJobUpdates: Record<string, unknown>[] = [];
const capturedReservationUpdates: Record<string, unknown>[] = [];

function makeChain(table: string) {
  const terminal = {
    single: async () => {
      if (table === "payments") {
        if (state.payment === null) return { data: null, error: { message: "not found" } };
        return {
          data: state.payment ?? null,
          error: state.payment ? null : { message: "not found" },
        };
      }
      return { data: null, error: null };
    },
  };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in"]) {
    chain[m] = () => ({ ...chain, ...terminal });
  }
  return { ...chain, ...terminal };
}

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      const base = makeChain(table);
      return {
        ...base,
        update: (payload: unknown) => {
          if (table === "payments") capturedPaymentUpdates.push(payload as Record<string, unknown>);
          if (table === "jobs") capturedJobUpdates.push(payload as Record<string, unknown>);
          if (table === "reservations") capturedReservationUpdates.push(payload as Record<string, unknown>);

          const resolveError = () =>
            table === "payments"
              ? (state.paymentUpdateError ?? null)
              : table === "jobs"
                ? (state.jobUpdateError ?? null)
                : null;

          // Supports .eq().eq() (jobs guard), .eq().then (single eq), and reservation chain
          const innerEq = {
            eq: () => Promise.resolve({ error: resolveError() }),
            then: (resolve: (v: unknown) => void) => resolve({ error: resolveError() }),
          };

          return {
            eq: () => ({ ...innerEq }),
          };
        },
      };
    },
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const STRIPE_SESSION_ID = "cs_test_abc123";
const STRIPE_INTENT_ID = "pi_test_xyz789";
const PAYMENT_ID = "pay-001";
const JOB_ID = "job-001";
const RESERVATION_ID = "res-001";

const pendingPayment = {
  id: PAYMENT_ID,
  job_id: JOB_ID,
  reservation_id: RESERVATION_ID,
  status: "pending",
};

const pendingPaymentNoReservation = {
  id: PAYMENT_ID,
  job_id: JOB_ID,
  reservation_id: null,
  status: "pending",
};

beforeEach(() => {
  state = {};
  capturedPaymentUpdates.length = 0;
  capturedJobUpdates.length = 0;
  capturedReservationUpdates.length = 0;
  vi.clearAllMocks();
});

// ─── handleCheckoutSessionCompleted ──────────────────────────────────────────

describe("handleCheckoutSessionCompleted", () => {
  it("returns payment_not_found when no payment matches the session ID", async () => {
    state = { payment: null };
    const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("payment_not_found");
  });

  it("marks the payment as paid", async () => {
    state = { payment: pendingPayment };
    await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    const update = capturedPaymentUpdates.find(
      (u) => (u as Record<string, unknown>).status === "paid",
    );
    expect(update).toBeTruthy();
  });

  it("stores stripe_payment_intent_id on the payment row", async () => {
    state = { payment: pendingPayment };
    await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    const update = capturedPaymentUpdates.find(
      (u) => (u as Record<string, unknown>).stripe_payment_intent_id === STRIPE_INTENT_ID,
    );
    expect(update).toBeTruthy();
  });

  it("advances the job to confirmed", async () => {
    state = { payment: pendingPayment };
    await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    const update = capturedJobUpdates.find(
      (u) => (u as Record<string, unknown>).status === "confirmed",
    );
    expect(update).toBeTruthy();
  });

  it("marks the reservation as confirmed", async () => {
    state = { payment: pendingPayment };
    await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    const update = capturedReservationUpdates.find(
      (u) => (u as Record<string, unknown>).status === "confirmed",
    );
    expect(update).toBeTruthy();
  });

  it("does not update reservation when reservation_id is null", async () => {
    state = { payment: pendingPaymentNoReservation };
    await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    expect(capturedReservationUpdates).toHaveLength(0);
  });

  it("returns alreadyProcessed=true when payment is already paid (idempotent)", async () => {
    state = { payment: { ...pendingPayment, status: "paid" } };
    const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(true);
    expect(capturedPaymentUpdates).toHaveLength(0);
    expect(capturedJobUpdates).toHaveLength(0);
  });

  it("returns alreadyProcessed=false on first processing", async () => {
    state = { payment: pendingPayment };
    const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(false);
  });

  it("returns db_error when payment update fails", async () => {
    state = { payment: pendingPayment, paymentUpdateError: { message: "write failed" } };
    const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, STRIPE_INTENT_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });

  it("handles null payment_intent_id gracefully", async () => {
    state = { payment: pendingPayment };
    const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, null);
    expect(result.success).toBe(true);
    const update = capturedPaymentUpdates.find(
      (u) => (u as Record<string, unknown>).status === "paid",
    );
    expect(update).toBeTruthy();
  });
});

// ─── handleCheckoutSessionExpired ─────────────────────────────────────────────

describe("handleCheckoutSessionExpired", () => {
  it("returns payment_not_found when no payment matches the session ID", async () => {
    state = { payment: null };
    const result = await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("payment_not_found");
  });

  it("marks the payment as failed", async () => {
    state = { payment: pendingPayment };
    await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    const update = capturedPaymentUpdates.find(
      (u) => (u as Record<string, unknown>).status === "failed",
    );
    expect(update).toBeTruthy();
  });

  it("moves the job back to slot_held", async () => {
    state = { payment: pendingPayment };
    await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    const update = capturedJobUpdates.find(
      (u) => (u as Record<string, unknown>).status === "slot_held",
    );
    expect(update).toBeTruthy();
  });

  it("returns alreadyProcessed=true when payment already failed (idempotent)", async () => {
    state = { payment: { ...pendingPayment, status: "failed" } };
    const result = await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(true);
    expect(capturedPaymentUpdates).toHaveLength(0);
  });

  it("returns alreadyProcessed=true when payment already paid (idempotent)", async () => {
    state = { payment: { ...pendingPayment, status: "paid" } };
    const result = await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(true);
  });

  it("returns db_error when payment update fails", async () => {
    state = { payment: pendingPayment, paymentUpdateError: { message: "write failed" } };
    const result = await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });

  it("returns alreadyProcessed=false on first processing", async () => {
    state = { payment: pendingPayment };
    const result = await handleCheckoutSessionExpired(STRIPE_SESSION_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(false);
  });
});

// ─── handlePaymentIntentFailed ────────────────────────────────────────────────

describe("handlePaymentIntentFailed", () => {
  it("returns payment_not_found when no payment matches the intent ID", async () => {
    state = { payment: null };
    const result = await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("payment_not_found");
  });

  it("marks the payment as failed", async () => {
    state = { payment: { ...pendingPayment, stripe_payment_intent_id: STRIPE_INTENT_ID } };
    await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    const update = capturedPaymentUpdates.find(
      (u) => (u as Record<string, unknown>).status === "failed",
    );
    expect(update).toBeTruthy();
  });

  it("moves the job back to slot_held", async () => {
    state = { payment: { ...pendingPayment, stripe_payment_intent_id: STRIPE_INTENT_ID } };
    await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    const update = capturedJobUpdates.find(
      (u) => (u as Record<string, unknown>).status === "slot_held",
    );
    expect(update).toBeTruthy();
  });

  it("returns alreadyProcessed=true when payment already failed (idempotent)", async () => {
    state = { payment: { ...pendingPayment, status: "failed", stripe_payment_intent_id: STRIPE_INTENT_ID } };
    const result = await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(true);
    expect(capturedPaymentUpdates).toHaveLength(0);
  });

  it("returns alreadyProcessed=true when payment already paid (idempotent)", async () => {
    state = { payment: { ...pendingPayment, status: "paid", stripe_payment_intent_id: STRIPE_INTENT_ID } };
    const result = await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(true);
  });

  it("returns db_error when payment update fails", async () => {
    state = {
      payment: { ...pendingPayment, stripe_payment_intent_id: STRIPE_INTENT_ID },
      paymentUpdateError: { message: "write failed" },
    };
    const result = await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });

  it("returns alreadyProcessed=false on first processing", async () => {
    state = { payment: { ...pendingPayment, stripe_payment_intent_id: STRIPE_INTENT_ID } };
    const result = await handlePaymentIntentFailed(STRIPE_INTENT_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyProcessed).toBe(false);
  });
});
