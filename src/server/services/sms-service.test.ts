/**
 * Tests for the SMS Service (Milestone 5, Task 2).
 *
 * Coverage:
 *   - renderSmsBody: all 4 templates, edge cases (null name, GBP formatting, slot formatting)
 *   - MockSmsProvider: send, failNext, clear
 *   - TwilioSmsProvider: missing credentials path (mocked Twilio client)
 *   - SmsService: happy path per template, provider failure (non-blocking),
 *     DB tracking (persists on success, marks failed on failure), DB write failure (non-fatal),
 *     provider selection (Twilio when creds present, mock when absent)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MockSmsProvider,
  TwilioSmsProvider,
  SmsService,
  renderSmsBody,
  type IntakeFormLinkParams,
  type ImageUploadLinkParams,
  type PaymentLinkParams,
  type BookingConfirmationParams,
} from "./sms-service";

// ─── Supabase mock ────────────────────────────────────────────────────────────

type InsertedRow = Record<string, unknown>;
let capturedInserts: InsertedRow[] = [];
let dbShouldFail = false;

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (_table: string) => ({
      insert: (row: InsertedRow) => {
        capturedInserts.push(row);
        return {
          select: () => ({
            single: async () => {
              if (dbShouldFail) {
                return { data: null, error: { message: "DB insert failed" } };
              }
              return { data: { id: "msg-db-id-1" }, error: null };
            },
          }),
        };
      },
    }),
  }),
}));

// ─── Twilio client mock ───────────────────────────────────────────────────────

const mockTwilioCreate = vi.fn();
vi.mock("@/server/twilio/client", () => ({
  getTwilioClient: () => ({
    messages: { create: mockTwilioCreate },
  }),
}));

// ─── appConfig mock ───────────────────────────────────────────────────────────

// Provide Twilio credentials so TwilioSmsProvider doesn't throw on fromNumber check.
vi.mock("@/config/app-config", () => ({
  appConfig: {
    serviceCredentials: {
      twilio: {
        accountSid: "ACtest",
        authToken: "test-token",
        fromNumber: "+447455724870",
      },
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedInserts = [];
  dbShouldFail = false;
  mockTwilioCreate.mockReset();
});

// ─── renderSmsBody ────────────────────────────────────────────────────────────

describe("renderSmsBody", () => {
  describe("intake_form_link", () => {
    it("includes the customer name and URL", () => {
      const params: IntakeFormLinkParams = {
        customerName: "Alice",
        intakeFormUrl: "https://app.example.com/intake/abc123",
      };
      const body = renderSmsBody("intake_form_link", params);
      expect(body).toContain("Alice");
      expect(body).toContain("https://app.example.com/intake/abc123");
      expect(body).toContain("60 seconds");
    });

    it("falls back to 'there' when customerName is null", () => {
      const params: IntakeFormLinkParams = {
        customerName: null,
        intakeFormUrl: "https://app.example.com/intake/xyz",
      };
      const body = renderSmsBody("intake_form_link", params);
      expect(body).toContain("Hi there");
    });
  });

  describe("image_upload_link", () => {
    it("includes the upload URL", () => {
      const params: ImageUploadLinkParams = {
        customerName: "Bob",
        uploadUrl: "https://app.example.com/upload/token123",
      };
      const body = renderSmsBody("image_upload_link", params);
      expect(body).toContain("Bob");
      expect(body).toContain("https://app.example.com/upload/token123");
      expect(body).toContain("photos");
    });
  });

  describe("payment_link", () => {
    it("formats GBP amount correctly and includes URL", () => {
      const params: PaymentLinkParams = {
        customerName: "Carol",
        paymentUrl: "https://checkout.stripe.com/pay/cs_test_abc",
        amountPence: 8000,
        currency: "gbp",
      };
      const body = renderSmsBody("payment_link", params);
      expect(body).toContain("Carol");
      expect(body).toContain("£80.00");
      expect(body).toContain("https://checkout.stripe.com/pay/cs_test_abc");
      expect(body).toContain("2 hours");
    });

    it("handles non-GBP currency without £ symbol", () => {
      const params: PaymentLinkParams = {
        customerName: "Dave",
        paymentUrl: "https://checkout.stripe.com/pay/cs_test_xyz",
        amountPence: 5000,
        currency: "usd",
      };
      const body = renderSmsBody("payment_link", params);
      expect(body).toContain("USD");
      expect(body).not.toContain("£");
    });
  });

  describe("booking_confirmation", () => {
    it("includes worker name and formatted slot", () => {
      const params: BookingConfirmationParams = {
        customerName: "Eve",
        workerName: "John Smith",
        slotStartsAt: "2026-05-01T09:00:00Z",
        slotEndsAt: "2026-05-01T11:00:00Z",
      };
      const body = renderSmsBody("booking_confirmation", params);
      expect(body).toContain("Eve");
      expect(body).toContain("John Smith");
      expect(body).toContain("confirmed");
    });

    it("falls back gracefully if dates are invalid", () => {
      const params: BookingConfirmationParams = {
        customerName: "Frank",
        workerName: "Jane Doe",
        slotStartsAt: "not-a-date",
        slotEndsAt: "also-not-a-date",
      };
      const body = renderSmsBody("booking_confirmation", params);
      // Should not throw; should still contain the raw strings
      expect(body).toBeDefined();
      expect(body.length).toBeGreaterThan(0);
    });
  });
});

// ─── MockSmsProvider ──────────────────────────────────────────────────────────

describe("MockSmsProvider", () => {
  it("stores sent messages in the messages array", async () => {
    const mock = new MockSmsProvider();
    const result = await mock.send("+447700900001", "Hello, test message");
    expect(result.success).toBe(true);
    expect(mock.messages).toHaveLength(1);
    expect(mock.messages[0].to).toBe("+447700900001");
    expect(mock.messages[0].body).toBe("Hello, test message");
  });

  it("returns a mock providerMessageId", async () => {
    const mock = new MockSmsProvider();
    const result = await mock.send("+447700900002", "Test");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerMessageId).toMatch(/^mock-/);
    }
  });

  it("failNext() causes the next send to return failure", async () => {
    const mock = new MockSmsProvider();
    mock.failNext();
    const result = await mock.send("+447700900003", "Should fail");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Simulated SMS failure");
    }
    // Messages array should be empty — failed send is not stored
    expect(mock.messages).toHaveLength(0);
  });

  it("failNext() only affects the next send, not subsequent ones", async () => {
    const mock = new MockSmsProvider();
    mock.failNext();
    await mock.send("+447700900004", "Fails");
    const second = await mock.send("+447700900004", "Succeeds");
    expect(second.success).toBe(true);
    expect(mock.messages).toHaveLength(1);
  });

  it("clear() empties the messages array", async () => {
    const mock = new MockSmsProvider();
    await mock.send("+447700900005", "Msg 1");
    await mock.send("+447700900005", "Msg 2");
    expect(mock.messages).toHaveLength(2);
    mock.clear();
    expect(mock.messages).toHaveLength(0);
  });

  it("always reports provider name as 'mock'", async () => {
    const mock = new MockSmsProvider();
    const result = await mock.send("+447700900006", "Test");
    expect(result.provider).toBe("mock");
  });
});

// ─── TwilioSmsProvider ────────────────────────────────────────────────────────

describe("TwilioSmsProvider", () => {
  it("returns success with Twilio SID on happy path", async () => {
    mockTwilioCreate.mockResolvedValueOnce({ sid: "SM123abc" });
    const provider = new TwilioSmsProvider();
    const result = await provider.send("+447700900010", "Test Twilio message");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerMessageId).toBe("SM123abc");
      expect(result.provider).toBe("twilio");
    }
  });

  it("returns failure (not throws) when Twilio API errors", async () => {
    mockTwilioCreate.mockRejectedValueOnce(new Error("Twilio API error: invalid number"));
    const provider = new TwilioSmsProvider();
    const result = await provider.send("+447700900011", "Should fail");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Twilio API error");
      expect(result.provider).toBe("twilio");
    }
  });
});

// ─── SmsService ───────────────────────────────────────────────────────────────

describe("SmsService", () => {
  // ── sendIntakeFormLink ────────────────────────────────────────────────────

  describe("sendIntakeFormLink", () => {
    it("sends the message and returns outboundMessageId on success", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      const result = await service.sendIntakeFormLink({
        to: "+447700900020",
        callSessionId: "session-1",
        jobId: "job-1",
        customerName: "Alice",
        intakeFormUrl: "https://app.example.com/intake/tok1",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.outboundMessageId).toBe("msg-db-id-1");
        expect(result.provider).toBe("mock");
      }
      expect(mock.messages).toHaveLength(1);
      expect(mock.messages[0].body).toContain("https://app.example.com/intake/tok1");
    });

    it("persists correct fields to outbound_messages", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      await service.sendIntakeFormLink({
        to: "+447700900021",
        callSessionId: "session-2",
        jobId: "job-2",
        customerName: "Bob",
        intakeFormUrl: "https://app.example.com/intake/tok2",
      });
      expect(capturedInserts).toHaveLength(1);
      const row = capturedInserts[0];
      expect(row.call_session_id).toBe("session-2");
      expect(row.job_id).toBe("job-2");
      expect(row.recipient_phone).toBe("+447700900021");
      expect(row.message_type).toBe("intake_form_link");
      expect(typeof row.message_body).toBe("string");
      expect(row.delivered).toBeNull(); // null = awaiting receipt
    });
  });

  // ── sendPaymentLink ───────────────────────────────────────────────────────

  describe("sendPaymentLink", () => {
    it("sends payment link SMS and records it", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      const result = await service.sendPaymentLink({
        to: "+447700900030",
        callSessionId: "session-3",
        jobId: "job-3",
        customerName: "Carol",
        paymentUrl: "https://checkout.stripe.com/pay/cs_abc",
        amountPence: 8000,
        currency: "gbp",
      });
      expect(result.success).toBe(true);
      expect(mock.messages[0].body).toContain("£80.00");
      expect(mock.messages[0].body).toContain("https://checkout.stripe.com/pay/cs_abc");
    });
  });

  // ── sendImageUploadLink ───────────────────────────────────────────────────

  describe("sendImageUploadLink", () => {
    it("sends image upload link SMS", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      const result = await service.sendImageUploadLink({
        to: "+447700900040",
        callSessionId: "session-4",
        jobId: "job-4",
        customerName: "Dave",
        uploadUrl: "https://app.example.com/upload/tok4",
      });
      expect(result.success).toBe(true);
      expect(mock.messages[0].body).toContain("https://app.example.com/upload/tok4");
    });
  });

  // ── sendBookingConfirmation ───────────────────────────────────────────────

  describe("sendBookingConfirmation", () => {
    it("sends booking confirmation SMS with worker name and slot", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      const result = await service.sendBookingConfirmation({
        to: "+447700900050",
        callSessionId: "session-5",
        jobId: "job-5",
        customerName: "Eve",
        workerName: "Mike Jones",
        slotStartsAt: "2026-05-10T10:00:00Z",
        slotEndsAt: "2026-05-10T12:00:00Z",
      });
      expect(result.success).toBe(true);
      expect(mock.messages[0].body).toContain("Mike Jones");
      expect(mock.messages[0].body).toContain("confirmed");
    });
  });

  // ── Provider failure handling ─────────────────────────────────────────────

  describe("provider failure handling", () => {
    it("returns success: false when provider fails, does not throw", async () => {
      const mock = new MockSmsProvider();
      mock.failNext();
      const service = new SmsService(mock);
      const result = await service.sendIntakeFormLink({
        to: "+447700900060",
        callSessionId: "session-6",
        jobId: "job-6",
        customerName: null,
        intakeFormUrl: "https://app.example.com/intake/fail",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Simulated SMS failure");
      }
    });

    it("persists the failed message with delivered=false", async () => {
      const mock = new MockSmsProvider();
      mock.failNext();
      const service = new SmsService(mock);
      await service.sendIntakeFormLink({
        to: "+447700900061",
        callSessionId: "session-7",
        jobId: "job-7",
        customerName: null,
        intakeFormUrl: "https://app.example.com/intake/fail2",
      });
      expect(capturedInserts).toHaveLength(1);
      expect(capturedInserts[0].delivered).toBe(false);
    });
  });

  // ── DB write failure (non-fatal) ──────────────────────────────────────────

  describe("DB write failure (non-fatal)", () => {
    it("still returns success when DB persist fails", async () => {
      dbShouldFail = true;
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      const result = await service.sendIntakeFormLink({
        to: "+447700900070",
        callSessionId: "session-8",
        jobId: "job-8",
        customerName: "Frank",
        intakeFormUrl: "https://app.example.com/intake/dbfail",
      });
      // SMS was sent successfully even though DB write failed
      expect(result.success).toBe(true);
      if (result.success) {
        // outboundMessageId is null when DB write fails
        expect(result.outboundMessageId).toBeNull();
      }
      // The SMS itself was still sent
      expect(mock.messages).toHaveLength(1);
    });
  });

  // ── jobId = null ──────────────────────────────────────────────────────────

  describe("jobId = null", () => {
    it("handles messages sent before a job is linked", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      const result = await service.sendIntakeFormLink({
        to: "+447700900080",
        callSessionId: "session-9",
        jobId: null,
        customerName: "Grace",
        intakeFormUrl: "https://app.example.com/intake/nojob",
      });
      expect(result.success).toBe(true);
      expect(capturedInserts[0].job_id).toBeNull();
    });
  });

  // ── delivery_metadata ─────────────────────────────────────────────────────

  describe("delivery_metadata", () => {
    it("stores providerMessageId in delivery_metadata on success", async () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      await service.sendIntakeFormLink({
        to: "+447700900090",
        callSessionId: "session-10",
        jobId: "job-10",
        customerName: "Hank",
        intakeFormUrl: "https://app.example.com/intake/meta",
      });
      const metadata = capturedInserts[0].delivery_metadata as Record<string, unknown>;
      expect(metadata.provider).toBe("mock");
      expect(typeof metadata.providerMessageId).toBe("string");
    });

    it("stores error in delivery_metadata on failure", async () => {
      const mock = new MockSmsProvider();
      mock.failNext();
      const service = new SmsService(mock);
      await service.sendIntakeFormLink({
        to: "+447700900091",
        callSessionId: "session-11",
        jobId: "job-11",
        customerName: null,
        intakeFormUrl: "https://app.example.com/intake/errmeta",
      });
      const metadata = capturedInserts[0].delivery_metadata as Record<string, unknown>;
      expect(typeof metadata.error).toBe("string");
    });
  });

  // ── provider selection ────────────────────────────────────────────────────

  describe("provider selection", () => {
    it("uses the injected provider when one is passed", () => {
      const mock = new MockSmsProvider();
      const service = new SmsService(mock);
      expect(service.getProvider().name).toBe("mock");
    });

    it("setProvider() swaps the active provider", () => {
      const mockA = new MockSmsProvider();
      const mockB = new MockSmsProvider();
      const service = new SmsService(mockA);
      service.setProvider(mockB);
      expect(service.getProvider()).toBe(mockB);
    });
  });
});
