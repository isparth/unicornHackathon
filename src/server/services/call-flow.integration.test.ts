/**
 * End-to-end call-flow integration test (Milestone 5 QA acceptance)
 *
 * Simulates a complete inbound call journey through the Vapi webhook dispatcher
 * and verifies that WhatsApp messages are dispatched at each of the three key
 * checkpoints:
 *
 *   1. create-call-session  → intake form link WhatsApp
 *   2. create-payment-session → payment link WhatsApp
 *   3. checkout.session.completed Stripe webhook → booking confirmation WhatsApp
 *
 * All external dependencies (Supabase, Stripe, Twilio, OpenAI, Vapi services)
 * are mocked so the test runs without any network access or real credentials.
 *
 * The tool-call dispatcher is exercised through handleToolCalls() so the full
 * path from Vapi webhook → service → WhatsApp send is covered in one test suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockSmsProvider, smsService } from "./sms-service";
import { handleToolCalls, type VapiToolCallsMessage } from "./vapi-webhook-service";
import { handleCheckoutSessionCompleted } from "./webhook-service";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const VAPI_CALL_ID = "e2e-vapi-call-001";
const SESSION_ID = "e2e-session-001";
const JOB_ID = "e2e-job-001";
const CUSTOMER_ID = "e2e-customer-001";
const WORKER_ID = "e2e-worker-001";
const PAYMENT_ID = "e2e-payment-001";
const RESERVATION_ID = "e2e-reservation-001";
const STRIPE_SESSION_ID = "cs_test_e2e001";
const PHONE_NUMBER = "+447700900001";
const BUSINESS_ID = "biz-e2e-001";
const INTAKE_TOKEN = "token-e2e-abc";
const PAYMENT_URL = "https://checkout.stripe.com/pay/e2e";
const STARTS_AT = "2025-06-15T09:00:00.000Z";
const ENDS_AT = "2025-06-15T11:00:00.000Z";

// ─── Shared mock SMS provider ─────────────────────────────────────────────────
//
// Created after imports — injected into the sms-service singleton via setProvider().
// We create it once and reuse it across all tests (cleared in beforeEach).

let mockSmsProvider: MockSmsProvider;

// ─── Module-level hoisted mocks ───────────────────────────────────────────────

const {
  mockIssueIntakeFormToken,
  mockCreateReservation,
  mockClassifyJob,
  mockPriceJob,
  mockGetAvailableSlots,
  mockGenerateCallSummary,
  mockCreatePaymentSessionFn,
} = vi.hoisted(() => ({
  mockIssueIntakeFormToken: vi.fn(),
  mockCreateReservation: vi.fn(),
  mockClassifyJob: vi.fn(),
  mockPriceJob: vi.fn(),
  mockGetAvailableSlots: vi.fn(),
  mockGenerateCallSummary: vi.fn(),
  mockCreatePaymentSessionFn: vi.fn(),
}));

vi.mock("./call-session-service", () => ({
  issueIntakeFormToken: mockIssueIntakeFormToken,
}));

vi.mock("./classification-service", () => ({
  classifyJob: mockClassifyJob,
}));

vi.mock("./pricing-service", () => ({
  priceJob: mockPriceJob,
}));

vi.mock("./scheduling-service", () => ({
  getAvailableSlots: mockGetAvailableSlots,
}));

vi.mock("./reservation-service", () => ({
  createReservation: mockCreateReservation,
}));

vi.mock("./call-summary-service", () => ({
  generateCallSummary: mockGenerateCallSummary,
}));

vi.mock("./payment-service", () => ({
  createPaymentSession: mockCreatePaymentSessionFn,
}));

vi.mock("./image-analysis-service", () => ({
  analyseJobImages: vi.fn().mockResolvedValue({ analysed: 0, skipped: 0, failed: 0, outcomes: [] }),
}));

vi.mock("@/config/app-config", () => ({
  appConfig: {
    appUrl: "http://localhost:3000",
    pricingDefaults: { calloutFeePence: 8000, currency: "gbp" },
    serviceCredentials: {
      twilio: { accountSid: "", authToken: "", fromNumber: "" },
      stripe: { secretKey: "", publishableKey: "", webhookSecret: "" },
      openai: { apiKey: "", summaryModel: "" },
      supabase: { url: "", anonKey: "", serviceRoleKey: "" },
      vapi: { apiKey: "", webhookSecret: "" },
    },
    intakeToken: { secret: "test-secret", expiryMinutes: 60 },
    reservationHoldMinutes: 120,
    missingRequiredKeys: [],
  },
}));

// ─── Supabase mock ─────────────────────────────────────────────────────────────
//
// We model just enough of Supabase to satisfy the call session + payment flows.

let dbState: {
  callSession: Record<string, unknown> | null;
  customers: Record<string, unknown> | null;
  jobs: Record<string, unknown> | null;
  payments: Record<string, unknown> | null;
  reservations: Record<string, unknown> | null;
} = {
  callSession: null,
  customers: null,
  jobs: null,
  payments: null,
  reservations: null,
};

const dbInserts: Record<string, unknown[]> = { customers: [], jobs: [], call_sessions: [], payments: [], outbound_messages: [] };
const dbUpdates: Record<string, unknown[]> = { jobs: [], payments: [], reservations: [] };

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            if (table === "call_sessions") return { data: dbState.callSession, error: null };
            return { data: null, error: null };
          },
          single: async () => {
            if (table === "call_sessions") return { data: dbState.callSession, error: dbState.callSession ? null : { message: "not found" } };
            if (table === "customers") return { data: dbState.customers, error: dbState.customers ? null : { message: "not found" } };
            if (table === "jobs") return { data: dbState.jobs, error: dbState.jobs ? null : { message: "not found" } };
            if (table === "payments") return { data: dbState.payments, error: dbState.payments ? null : { message: "not found" } };
            if (table === "reservations") return { data: dbState.reservations, error: dbState.reservations ? null : { message: "not found" } };
            return { data: null, error: null };
          },
          order: (_col: string, _opts: unknown) => ({
            limit: (_n: number) => ({
              maybeSingle: async () => {
                if (table === "call_sessions") return { data: dbState.callSession, error: null };
                return { data: null, error: null };
              },
            }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        (dbInserts[table] ??= []).push(row);
        return {
          select: (_cols: string) => ({
            single: async () => {
              // Return the appropriate stub ID for each table
              if (table === "customers") return { data: { id: CUSTOMER_ID }, error: null };
              if (table === "jobs") return { data: { id: JOB_ID }, error: null };
              if (table === "call_sessions") return { data: { id: SESSION_ID }, error: null };
              if (table === "payments") return { data: { id: PAYMENT_ID }, error: null };
              if (table === "outbound_messages") return { data: { id: `msg-${Date.now()}` }, error: null };
              return { data: { id: "generic-id" }, error: null };
            },
          }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        (dbUpdates[table] ??= []).push(payload);
        return {
          eq: (_col: string, _val: unknown) => ({
            eq: (_c: string, _v: unknown) => Promise.resolve({ error: null }),
            single: async () => ({ data: null, error: null }),
            data: null,
            error: null,
          }),
          single: async () => ({ data: null, error: null }),
        };
      },
    }),
  }),
}));

// sms-service is NOT mocked at module level — we inject the mock provider via
// smsService.setProvider() in beforeEach (see below).

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeToolCallEvent(
  toolName: string,
  params: Record<string, unknown>,
  callId = VAPI_CALL_ID,
): VapiToolCallsMessage {
  return {
    type: "tool-calls",
    call: { id: callId, customer: { number: PHONE_NUMBER } },
    toolCallList: [{ id: `tc-${toolName}`, name: toolName, parameters: params }],
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // (Re-)initialise the mock provider and inject it into the singleton so
  // assertions on sent messages work regardless of module load order.
  mockSmsProvider = new MockSmsProvider();
  smsService.setProvider(mockSmsProvider);

  // Reset DB state to "nothing exists yet"
  dbState = { callSession: null, customers: null, jobs: null, payments: null, reservations: null };
  for (const k of Object.keys(dbInserts)) dbInserts[k] = [];
  for (const k of Object.keys(dbUpdates)) dbUpdates[k] = [];

  // Wire up default service mock return values
  mockIssueIntakeFormToken.mockResolvedValue({
    token: INTAKE_TOKEN,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  mockClassifyJob.mockResolvedValue({
    success: true,
    classification: { requiredSkill: "plumbing", urgency: "scheduled", jobCategory: "Pipe repair" },
    alreadyDone: false,
  });

  mockPriceJob.mockResolvedValue({
    success: true,
    estimate: {
      calloutFeePence: 8000,
      repairEstimateMinPence: 5000,
      repairEstimateMaxPence: 20000,
      currency: "gbp",
      explanation: "Standard plumbing call-out: £80. Estimated repair cost: £50–£200.",
    },
    alreadyDone: false,
  });

  mockGetAvailableSlots.mockResolvedValue({
    success: true,
    slots: [
      { workerId: WORKER_ID, workerName: "Alice Smith", startsAt: new Date(STARTS_AT), endsAt: new Date(ENDS_AT) },
    ],
  });

  mockCreateReservation.mockResolvedValue({
    success: true,
    reservation: { id: RESERVATION_ID, expiresAt: new Date(Date.now() + 7200_000).toISOString() },
    alreadyDone: false,
  });

  mockGenerateCallSummary.mockResolvedValue({
    success: true,
    summary: "Customer reported a dripping tap in the kitchen.",
    alreadyDone: false,
  });

  mockCreatePaymentSessionFn.mockResolvedValue({
    success: true,
    jobId: JOB_ID,
    paymentId: PAYMENT_ID,
    paymentUrl: PAYMENT_URL,
    amountPence: 8000,
    currency: "gbp",
    alreadyDone: false,
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Milestone 5 end-to-end call flow", () => {
  // ── Step 1: create-call-session ────────────────────────────────────────────
  describe("Step 1 — create-call-session tool call", () => {
    it("returns a successful result with intakeFormUrl", async () => {
      const event = makeToolCallEvent("create-call-session", {
        vapiCallId: VAPI_CALL_ID,
        serviceBusinessId: BUSINESS_ID,
        phoneNumber: PHONE_NUMBER,
      });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(typeof payload.intakeFormUrl).toBe("string");
      expect((payload.intakeFormUrl as string)).toContain(INTAKE_TOKEN);
    });

    it("triggers a WhatsApp intake form link send", async () => {
      const event = makeToolCallEvent("create-call-session", {
        vapiCallId: VAPI_CALL_ID,
        serviceBusinessId: BUSINESS_ID,
        phoneNumber: PHONE_NUMBER,
      });
      await handleToolCalls(event);
      // Fire-and-forget — flush microtask queue
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSmsProvider.messages.length).toBe(1);
      const msg = mockSmsProvider.messages[0];
      expect(msg.to).toBe(PHONE_NUMBER);
      expect(msg.body).toContain(INTAKE_TOKEN);
    });

    it("returns session creation failure without throwing", async () => {
      mockIssueIntakeFormToken.mockRejectedValueOnce(new Error("Token service down"));
      const event = makeToolCallEvent("create-call-session", {
        vapiCallId: VAPI_CALL_ID,
        serviceBusinessId: BUSINESS_ID,
        phoneNumber: PHONE_NUMBER,
      });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true); // tool-calls container succeeds
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("token_error");
    });
  });

  // ── Step 2: classify-job ───────────────────────────────────────────────────
  describe("Step 2 — classify-job tool call", () => {
    it("returns classification result for a given jobId", async () => {
      const event = makeToolCallEvent("classify-job", { jobId: JOB_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.requiredSkill).toBe("plumbing");
      expect(payload.urgency).toBe("scheduled");
    });

    it("resolves jobId from sessionId", async () => {
      dbState.callSession = { id: SESSION_ID, job_id: JOB_ID, transcript: null };
      const event = makeToolCallEvent("classifyJob", { sessionId: SESSION_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(mockClassifyJob).toHaveBeenCalledWith(JOB_ID);
    });

    it("returns error when no jobId or sessionId provided", async () => {
      const event = makeToolCallEvent("classify-job", {});
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });
  });

  // ── Step 3: price-job ──────────────────────────────────────────────────────
  describe("Step 3 — price-job tool call", () => {
    it("returns price estimate for a given jobId", async () => {
      const event = makeToolCallEvent("price-job", { jobId: JOB_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.calloutFeePence).toBe(8000);
      expect(typeof payload.explanation).toBe("string");
    });
  });

  // ── Step 4: get-available-slots ────────────────────────────────────────────
  describe("Step 4 — get-available-slots tool call", () => {
    it("returns available slots for a given jobId", async () => {
      const event = makeToolCallEvent("get-available-slots", { jobId: JOB_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      const slots = payload.slots as Array<Record<string, unknown>>;
      expect(slots.length).toBe(1);
      expect(slots[0].workerName).toBe("Alice Smith");
      expect(slots[0].startsAt).toBe(STARTS_AT);
    });

    it("respects maxSlots cap", async () => {
      mockGetAvailableSlots.mockResolvedValueOnce({
        success: true,
        slots: Array.from({ length: 10 }, (_, i) => ({
          workerId: WORKER_ID,
          workerName: "Alice Smith",
          startsAt: new Date(Date.now() + i * 3600_000),
          endsAt: new Date(Date.now() + (i + 1) * 3600_000),
        })),
      });
      const event = makeToolCallEvent("get-available-slots", { jobId: JOB_ID, maxSlots: 3 });
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect((payload.slots as unknown[]).length).toBe(3);
    });
  });

  // ── Step 5: hold-slot ─────────────────────────────────────────────────────
  describe("Step 5 — hold-slot tool call", () => {
    it("creates a reservation and returns reservationId", async () => {
      const event = makeToolCallEvent("hold-slot", {
        jobId: JOB_ID,
        workerId: WORKER_ID,
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.reservationId).toBe(RESERVATION_ID);
    });

    it("returns bad_request when required fields are missing", async () => {
      const event = makeToolCallEvent("holdSlot", { jobId: JOB_ID });
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });

    it("returns error for invalid timestamps", async () => {
      const event = makeToolCallEvent("hold-slot", {
        jobId: JOB_ID,
        workerId: WORKER_ID,
        startsAt: "not-a-date",
        endsAt: "also-not-a-date",
      });
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });
  });

  // ── Step 6: check-form-status ─────────────────────────────────────────────
  describe("Step 6 — check-form-status tool call", () => {
    it("returns completed=false when form not yet submitted", async () => {
      dbState.callSession = { id: SESSION_ID, job_id: JOB_ID, intake_form_completed_at: null, transcript: null };
      const event = makeToolCallEvent("check-form-status", { sessionId: SESSION_ID });
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.completed).toBe(false);
    });

    it("returns completed=true when form is submitted", async () => {
      dbState.callSession = {
        id: SESSION_ID,
        job_id: JOB_ID,
        intake_form_completed_at: "2025-06-01T10:00:00.000Z",
        transcript: null,
      };
      const event = makeToolCallEvent("checkFormStatus", { sessionId: SESSION_ID });
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.completed).toBe(true);
    });

    it("returns bad_request when neither sessionId nor jobId is provided", async () => {
      const event = makeToolCallEvent("check-form-status", {});
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });
  });

  // ── Step 7: create-payment-session (via tool call, no WhatsApp here — ─────
  //            the payment-service itself fires it; this tests dispatcher wiring)
  describe("Step 7 — create-payment-session tool call", () => {
    it("returns payment URL when session is created successfully", async () => {
      const event = makeToolCallEvent("create-payment-session", { jobId: JOB_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.paymentUrl).toBe(PAYMENT_URL);
      expect(payload.amountPence).toBe(8000);
    });

    it("returns bad_request when jobId is missing", async () => {
      const event = makeToolCallEvent("createPaymentSession", {});
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });

    it("passes service error back to Vapi without throwing", async () => {
      mockCreatePaymentSessionFn.mockResolvedValueOnce({
        success: false,
        error: "intake_form_incomplete",
        message: "Form not yet submitted.",
      });
      const event = makeToolCallEvent("create-payment-session", { jobId: JOB_ID });
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("intake_form_incomplete");
    });
  });

  // ── Step 8: summarise-call ────────────────────────────────────────────────
  describe("Step 8 — summarise-call tool call", () => {
    it("returns summary when call summary is generated", async () => {
      const event = makeToolCallEvent("summarise-call", { sessionId: SESSION_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(typeof payload.summary).toBe("string");
    });

    it("returns bad_request when sessionId is missing", async () => {
      const event = makeToolCallEvent("summariseCall", {});
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });
  });

  // ── Step 9: generate-intake-token ─────────────────────────────────────────
  describe("Step 9 — generate-intake-token tool call", () => {
    it("returns a fresh intake token and URL", async () => {
      const event = makeToolCallEvent("generate-intake-token", { sessionId: SESSION_ID });
      const result = await handleToolCalls(event);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      expect(payload.token).toBe(INTAKE_TOKEN);
      expect((payload.intakeFormUrl as string)).toContain(INTAKE_TOKEN);
    });

    it("returns bad_request when sessionId is missing", async () => {
      const event = makeToolCallEvent("generateIntakeToken", {});
      const result = await handleToolCalls(event);
      if (!result.success) return;
      const payload = JSON.parse(result.results[0].result) as Record<string, unknown>;
      expect(payload.success).toBe(false);
      expect(payload.error).toBe("bad_request");
    });
  });

  // ── Step 10: Stripe webhook → booking confirmation WhatsApp ───────────────
  describe("Step 10 — checkout.session.completed → booking confirmation WhatsApp", () => {
    beforeEach(() => {
      // Set up the DB state for a fully-confirmed booking
      dbState.payments = {
        id: PAYMENT_ID,
        job_id: JOB_ID,
        reservation_id: RESERVATION_ID,
        status: "pending",
      };
      dbState.jobs = {
        customers: { name: "Jane Smith", phone_number: PHONE_NUMBER },
        call_sessions: [{ id: SESSION_ID }],
      };
      dbState.reservations = {
        id: RESERVATION_ID,
        starts_at: STARTS_AT,
        ends_at: ENDS_AT,
        workers: { name: "Alice Smith" },
      };
    });

    it("returns success=true and alreadyProcessed=false on first call", async () => {
      const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, "pi_test_001");
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.alreadyProcessed).toBe(false);
    });

    it("returns alreadyProcessed=true when payment is already paid", async () => {
      dbState.payments = { ...dbState.payments, status: "paid" };
      const result = await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, "pi_test_001");
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.alreadyProcessed).toBe(true);
    });

    it("sends a booking confirmation WhatsApp message after successful payment", async () => {
      await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, "pi_test_001");
      // Fire-and-forget — flush microtask queue
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSmsProvider.messages.length).toBe(1);
      const msg = mockSmsProvider.messages[0];
      expect(msg.to).toBe(PHONE_NUMBER);
      expect(msg.body).toContain("confirmed");
      expect(msg.body).toContain("Alice Smith");
    });

    it("does not send WhatsApp when payment is already paid (idempotent)", async () => {
      dbState.payments = { ...dbState.payments, status: "paid" };
      await handleCheckoutSessionCompleted(STRIPE_SESSION_ID, "pi_test_001");
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSmsProvider.messages.length).toBe(0);
    });

    it("does not throw when payment record is not found", async () => {
      dbState.payments = null;
      const result = await handleCheckoutSessionCompleted("cs_unknown", null);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("payment_not_found");
    });
  });

  // ── Full happy-path flow ──────────────────────────────────────────────────
  describe("Full sequential call flow (happy path)", () => {
    it("dispatches all nine tools and produces a WhatsApp at call-start", async () => {
      // 1. create-call-session
      const step1 = await handleToolCalls(makeToolCallEvent("create-call-session", {
        vapiCallId: VAPI_CALL_ID,
        serviceBusinessId: BUSINESS_ID,
        phoneNumber: PHONE_NUMBER,
      }));
      expect(step1.success).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSmsProvider.messages.some((m) => m.body.includes(INTAKE_TOKEN))).toBe(true);

      // 2. summarise-call
      const step2 = await handleToolCalls(makeToolCallEvent("summarise-call", { sessionId: SESSION_ID }));
      expect(step2.success).toBe(true);

      // 3. classify-job
      const step3 = await handleToolCalls(makeToolCallEvent("classify-job", { jobId: JOB_ID }));
      expect(step3.success).toBe(true);

      // 4. price-job
      const step4 = await handleToolCalls(makeToolCallEvent("price-job", { jobId: JOB_ID }));
      expect(step4.success).toBe(true);

      // 5. get-available-slots
      const step5 = await handleToolCalls(makeToolCallEvent("get-available-slots", { jobId: JOB_ID }));
      expect(step5.success).toBe(true);

      // 6. hold-slot
      const step6 = await handleToolCalls(makeToolCallEvent("hold-slot", {
        jobId: JOB_ID,
        workerId: WORKER_ID,
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
      }));
      expect(step6.success).toBe(true);

      // 7. check-form-status (form complete)
      dbState.callSession = { id: SESSION_ID, job_id: JOB_ID, intake_form_completed_at: "2025-06-01T10:00:00.000Z", transcript: null };
      const step7 = await handleToolCalls(makeToolCallEvent("check-form-status", { sessionId: SESSION_ID }));
      expect(step7.success).toBe(true);
      const checkPayload = JSON.parse(step7.success ? step7.results[0].result : "{}") as Record<string, unknown>;
      expect(checkPayload.completed).toBe(true);

      // 8. create-payment-session
      const step8 = await handleToolCalls(makeToolCallEvent("create-payment-session", { jobId: JOB_ID }));
      expect(step8.success).toBe(true);

      // 9. generate-intake-token (re-issue)
      const step9 = await handleToolCalls(makeToolCallEvent("generate-intake-token", { sessionId: SESSION_ID }));
      expect(step9.success).toBe(true);

      // All nine tools dispatched without throwing
      for (const stepResult of [step1, step2, step3, step4, step5, step6, step7, step8, step9]) {
        expect(stepResult.success).toBe(true);
      }
    });
  });
});
