/**
 * Payment action tests
 *
 * The action is now a thin wrapper around payment-service.ts.
 * These tests verify that the hard gate logic is preserved end-to-end
 * (action → service → hard gates) by mocking Supabase + Stripe.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPaymentSession } from "./payment";

// ─── Stripe mock ───────────────────────────────────────────────────────────────

const mockSessionCreate = vi.fn().mockResolvedValue({
  id: "cs_test_mock",
  url: "https://checkout.stripe.com/pay/cs_test_mock",
});

vi.mock("@/server/stripe/client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: mockSessionCreate } },
  }),
}));

vi.mock("@/config/app-config", () => ({
  appConfig: {
    appUrl: "http://localhost:3000",
    pricingDefaults: { calloutFeePence: 8000, currency: "gbp" },
    serviceCredentials: {
      stripe: { secretKey: "sk_test_mock", publishableKey: "", webhookSecret: "" },
      twilio: { accountSid: "", authToken: "", fromNumber: "" },
    },
  },
}));

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockData = {
  job?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  paymentInsertError?: { message: string } | null;
  jobUpdateError?: { message: string } | null;
};

let mockData: MockData = {};
const capturedUpdates: Record<string, unknown>[] = [];

function makeChain(table: string) {
  const terminal = {
    single: async () => {
      if (table === "jobs") {
        if (mockData.job === null) return { data: null, error: { message: "not found" } };
        return { data: mockData.job ?? null, error: mockData.job ? null : { message: "not found" } };
      }
      if (table === "customers") {
        return { data: mockData.customer ?? null, error: null };
      }
      if (table === "payments") {
        // No existing payment by default
        return { data: null, error: { message: "not found" } };
      }
      return { data: null, error: null };
    },
  };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq"]) {
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
        insert: () => ({
          select: () => ({
            single: async () => {
              if (mockData.paymentInsertError) {
                return { data: null, error: mockData.paymentInsertError };
              }
              return { data: { id: "pay-001" }, error: null };
            },
          }),
        }),
        update: (payload: unknown) => {
          capturedUpdates.push(payload as Record<string, unknown>);
          return {
            eq: () => ({
              then: (resolve: (v: unknown) => void) =>
                resolve({ error: mockData.jobUpdateError ?? null }),
            }),
          };
        },
      };
    },
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID = "job-payment-test-001";
const CUSTOMER_ID = "cust-001";

const pricedJobWithFormDone = {
  id: JOB_ID,
  status: "priced",
  customer_id: CUSTOMER_ID,
  reservation_id: null,
  payment_id: null,
  price_estimate: { calloutFeePence: 8000, currency: "gbp" },
  call_sessions: [{ id: "sess-001", intake_form_completed_at: "2024-01-01T10:00:00Z" }],
};

const fullCustomer = {
  name: "Jane Smith",
  address_line_1: "10 High Street",
  city: "London",
  postcode: "SW1A 1AA",
  phone_number: "+447911123456",
};

beforeEach(() => {
  mockData = {};
  capturedUpdates.length = 0;
  vi.clearAllMocks();
  mockSessionCreate.mockResolvedValue({
    id: "cs_test_mock",
    url: "https://checkout.stripe.com/pay/cs_test_mock",
  });
});

// ─── Hard gate: intake form ───────────────────────────────────────────────────

describe("createPaymentSession — hard gate: intake form", () => {
  it("blocks payment when no call session has intake_form_completed_at set", async () => {
    mockData = {
      job: {
        ...pricedJobWithFormDone,
        call_sessions: [{ id: "sess-001", intake_form_completed_at: null }],
      },
      customer: fullCustomer,
    };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("intake_form_incomplete");
    expect(result.message).toMatch(/intake form/i);
  });

  it("blocks payment when call_sessions array is empty", async () => {
    mockData = { job: { ...pricedJobWithFormDone, call_sessions: [] }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("intake_form_incomplete");
  });

  it("allows payment when intake_form_completed_at is set", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
  });
});

// ─── Hard gate: job state ─────────────────────────────────────────────────────

describe("createPaymentSession — hard gate: job state", () => {
  it("blocks payment when job is in intake state", async () => {
    mockData = { job: { ...pricedJobWithFormDone, status: "intake" }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_job_state");
  });

  it("blocks payment when job is in qualified state", async () => {
    mockData = { job: { ...pricedJobWithFormDone, status: "qualified" }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_job_state");
  });

  it("allows payment for priced jobs", async () => {
    mockData = { job: { ...pricedJobWithFormDone, status: "priced" }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
  });

  it("allows payment for slot_held jobs", async () => {
    mockData = { job: { ...pricedJobWithFormDone, status: "slot_held" }, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
  });
});

// ─── Hard gate: customer fields ───────────────────────────────────────────────

describe("createPaymentSession — hard gate: customer fields", () => {
  it("blocks payment when customer name is missing", async () => {
    mockData = { job: pricedJobWithFormDone, customer: { ...fullCustomer, name: null } };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
    expect(result.message).toContain("name");
  });

  it("blocks payment when address is missing", async () => {
    mockData = { job: pricedJobWithFormDone, customer: { ...fullCustomer, address_line_1: null } };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
  });

  it("blocks payment when postcode is missing", async () => {
    mockData = { job: pricedJobWithFormDone, customer: { ...fullCustomer, postcode: null } };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_customer_fields");
  });

  it("lists all missing fields in one error", async () => {
    mockData = { job: pricedJobWithFormDone, customer: { ...fullCustomer, name: null, city: null } };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain("name");
    expect(result.message).toContain("city");
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("createPaymentSession — happy path", () => {
  it("returns success with a real Stripe paymentUrl", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.paymentUrl).toBe("https://checkout.stripe.com/pay/cs_test_mock");
    expect(result.jobId).toBe(JOB_ID);
  });

  it("returns the callout fee amount from the price estimate", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.amountPence).toBe(8000);
    expect(result.currency).toBe("gbp");
  });

  it("advances job to awaiting_payment", async () => {
    mockData = { job: pricedJobWithFormDone, customer: fullCustomer };
    await createPaymentSession(JOB_ID);
    const jobUpdate = capturedUpdates.find(
      (u) => (u as Record<string, unknown>).status === "awaiting_payment",
    );
    expect(jobUpdate).toBeTruthy();
  });

  it("returns job_not_found when the job does not exist", async () => {
    mockData = { job: null };
    const result = await createPaymentSession("nonexistent");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("job_not_found");
  });

  it("returns db_error when the payment insert fails", async () => {
    mockData = {
      job: pricedJobWithFormDone,
      customer: fullCustomer,
      paymentInsertError: { message: "write failed" },
    };
    const result = await createPaymentSession(JOB_ID);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });
});
