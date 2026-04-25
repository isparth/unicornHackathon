/**
 * Stripe Webhook Route tests
 *
 * Tests the HTTP layer: signature verification, event routing, HTTP status codes.
 * The webhook service functions are mocked so we only test the route's own logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Hoist mock functions so vi.mock factories can reference them
const {
  mockHandleCompleted,
  mockHandleExpired,
  mockHandleFailed,
  mockConstructEvent,
} = vi.hoisted(() => ({
  mockHandleCompleted: vi.fn().mockResolvedValue({ success: true, alreadyProcessed: false }),
  mockHandleExpired: vi.fn().mockResolvedValue({ success: true, alreadyProcessed: false }),
  mockHandleFailed: vi.fn().mockResolvedValue({ success: true, alreadyProcessed: false }),
  mockConstructEvent: vi.fn(),
}));

// Mock app-config with a known webhook secret
vi.mock("@/config/app-config", () => ({
  appConfig: {
    appUrl: "http://localhost:3000",
    serviceCredentials: {
      stripe: {
        secretKey: "sk_test_mock",
        publishableKey: "pk_test_mock",
        webhookSecret: "whsec_test_mock",
      },
    },
  },
}));

vi.mock("@/server/services/webhook-service", () => ({
  handleCheckoutSessionCompleted: mockHandleCompleted,
  handleCheckoutSessionExpired: mockHandleExpired,
  handlePaymentIntentFailed: mockHandleFailed,
}));

// Mock Stripe client — constructEvent is the key method under test
vi.mock("@/server/stripe/client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mockConstructEvent },
  }),
}));

import { POST } from "./route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: string, signature = "valid-sig"): Request {
  return new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body,
  });
}

function makeStripeEvent(type: string, data: Record<string, unknown>): object {
  return { id: `evt_test_${type}`, type, data: { object: data } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleCompleted.mockResolvedValue({ success: true, alreadyProcessed: false });
  mockHandleExpired.mockResolvedValue({ success: true, alreadyProcessed: false });
  mockHandleFailed.mockResolvedValue({ success: true, alreadyProcessed: false });
});

// ─── Signature verification ───────────────────────────────────────────────────

describe("Signature verification", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const req = new Request("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/stripe-signature/i);
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const req = makeRequest("{}", "invalid-sig");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/verification failed/i);
  });

  it("returns 200 when signature is valid", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", { id: "cs_test", mode: "payment", payment_intent: "pi_test" }),
    );
    const req = makeRequest("{}", "valid-sig");
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ─── Event routing ────────────────────────────────────────────────────────────

describe("Event routing", () => {
  it("routes checkout.session.completed to handleCheckoutSessionCompleted", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", {
        id: "cs_test_123",
        mode: "payment",
        payment_intent: "pi_test_abc",
      }),
    );
    await POST(makeRequest("{}"));
    expect(mockHandleCompleted).toHaveBeenCalledWith("cs_test_123", "pi_test_abc");
  });

  it("routes checkout.session.expired to handleCheckoutSessionExpired", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.expired", { id: "cs_test_456", mode: "payment" }),
    );
    await POST(makeRequest("{}"));
    expect(mockHandleExpired).toHaveBeenCalledWith("cs_test_456");
  });

  it("routes payment_intent.payment_failed to handlePaymentIntentFailed", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("payment_intent.payment_failed", { id: "pi_test_789" }),
    );
    await POST(makeRequest("{}"));
    expect(mockHandleFailed).toHaveBeenCalledWith("pi_test_789");
  });

  it("returns 200 for unknown event types without calling any handler", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("customer.created", { id: "cus_test" }),
    );
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockHandleCompleted).not.toHaveBeenCalled();
    expect(mockHandleExpired).not.toHaveBeenCalled();
    expect(mockHandleFailed).not.toHaveBeenCalled();
  });

  it("skips non-payment mode checkout sessions", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", {
        id: "cs_test_sub",
        mode: "subscription", // not payment mode
        payment_intent: null,
      }),
    );
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockHandleCompleted).not.toHaveBeenCalled();
  });
});

// ─── Handler error propagation ────────────────────────────────────────────────

describe("Handler error propagation", () => {
  it("returns 200 when handler returns payment_not_found (non-fatal)", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", {
        id: "cs_unknown",
        mode: "payment",
        payment_intent: "pi_test",
      }),
    );
    mockHandleCompleted.mockResolvedValueOnce({
      success: false,
      error: "payment_not_found",
      message: "No payment found",
    });
    const res = await POST(makeRequest("{}"));
    // payment_not_found is non-fatal — still 200 so Stripe doesn't retry
    expect(res.status).toBe(200);
  });

  it("returns 500 when handler returns a db_error", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", {
        id: "cs_test_err",
        mode: "payment",
        payment_intent: "pi_test",
      }),
    );
    mockHandleCompleted.mockResolvedValueOnce({
      success: false,
      error: "db_error",
      message: "Failed to update payment",
    });
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(500);
  });

  it("returns 200 with received:true on success", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", {
        id: "cs_test_ok",
        mode: "payment",
        payment_intent: "pi_test",
      }),
    );
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it("returns 200 when handler reports alreadyProcessed (idempotent replay)", async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeStripeEvent("checkout.session.completed", {
        id: "cs_test_dup",
        mode: "payment",
        payment_intent: "pi_test",
      }),
    );
    mockHandleCompleted.mockResolvedValueOnce({ success: true, alreadyProcessed: true });
    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
  });
});
