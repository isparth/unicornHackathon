/**
 * Notification Service tests
 *
 * Covers:
 *   - LoggingNotificationProvider: records events, returns success, clears log
 *   - NotificationService typed helpers: correct event type + payload forwarded
 *   - Provider error handling: exceptions are caught, never propagate
 *   - Provider swapping at runtime
 *   - All four event types: payment_requested, booking_confirmed,
 *     payment_failed, reservation_expired
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LoggingNotificationProvider,
  NotificationService,
  notificationService,
  type NotificationPayload,
  type NotificationResult,
  type NotificationProvider,
} from "./notification-service";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_PAYMENT_REQUESTED = {
  jobId: "job-001",
  customerPhone: "+447700900001",
  customerName: "Alice",
  paymentUrl: "https://checkout.stripe.com/pay/cs_test_abc",
  amountPence: 8000,
  currency: "gbp",
};

const BASE_BOOKING_CONFIRMED = {
  jobId: "job-001",
  customerPhone: "+447700900001",
  customerName: "Alice",
  workerName: "Bob",
  slotStartsAt: "2026-05-01T10:00:00Z",
  slotEndsAt: "2026-05-01T12:00:00Z",
};

const BASE_PAYMENT_FAILED = {
  jobId: "job-001",
  customerPhone: "+447700900001",
  customerName: "Alice",
  reason: "card_declined",
};

const BASE_RESERVATION_EXPIRED = {
  jobId: "job-001",
  reservationId: "res-001",
  customerPhone: "+447700900001",
  customerName: "Alice",
};

// ─── LoggingNotificationProvider ─────────────────────────────────────────────

describe("LoggingNotificationProvider", () => {
  let provider: LoggingNotificationProvider;

  beforeEach(() => {
    provider = new LoggingNotificationProvider();
  });

  it("has name 'logging'", () => {
    expect(provider.name).toBe("logging");
  });

  it("returns success: true for every send", async () => {
    const result = await provider.send({
      event: "payment_requested",
      ...BASE_PAYMENT_REQUESTED,
    });
    expect(result.success).toBe(true);
  });

  it("appends the event to the events log", async () => {
    await provider.send({ event: "payment_requested", ...BASE_PAYMENT_REQUESTED });
    expect(provider.events).toHaveLength(1);
    expect(provider.events[0].payload.event).toBe("payment_requested");
  });

  it("accumulates multiple events in order", async () => {
    await provider.send({ event: "payment_requested", ...BASE_PAYMENT_REQUESTED });
    await provider.send({ event: "booking_confirmed", ...BASE_BOOKING_CONFIRMED });
    expect(provider.events).toHaveLength(2);
    expect(provider.events[0].payload.event).toBe("payment_requested");
    expect(provider.events[1].payload.event).toBe("booking_confirmed");
  });

  it("clear() empties the event log", async () => {
    await provider.send({ event: "payment_requested", ...BASE_PAYMENT_REQUESTED });
    provider.clear();
    expect(provider.events).toHaveLength(0);
  });

  it("records the provider name on each event log entry", async () => {
    await provider.send({ event: "payment_failed", ...BASE_PAYMENT_FAILED });
    expect(provider.events[0].provider).toBe("logging");
  });

  it("records a timestamp on each event log entry", async () => {
    await provider.send({ event: "reservation_expired", ...BASE_RESERVATION_EXPIRED });
    expect(provider.events[0].timestamp).toBeTruthy();
    expect(new Date(provider.events[0].timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ─── NotificationService — typed helpers ─────────────────────────────────────

describe("NotificationService typed helpers", () => {
  let provider: LoggingNotificationProvider;
  let service: NotificationService;

  beforeEach(() => {
    provider = new LoggingNotificationProvider();
    service = new NotificationService(provider);
  });

  it("notifyPaymentRequested sends event=payment_requested", async () => {
    await service.notifyPaymentRequested(BASE_PAYMENT_REQUESTED);
    expect(provider.events[0].payload.event).toBe("payment_requested");
  });

  it("notifyPaymentRequested forwards all payload fields", async () => {
    await service.notifyPaymentRequested(BASE_PAYMENT_REQUESTED);
    const payload = provider.events[0].payload as typeof BASE_PAYMENT_REQUESTED & { event: string };
    expect(payload.jobId).toBe("job-001");
    expect(payload.paymentUrl).toBe(BASE_PAYMENT_REQUESTED.paymentUrl);
    expect(payload.amountPence).toBe(8000);
    expect(payload.currency).toBe("gbp");
  });

  it("notifyBookingConfirmed sends event=booking_confirmed", async () => {
    await service.notifyBookingConfirmed(BASE_BOOKING_CONFIRMED);
    expect(provider.events[0].payload.event).toBe("booking_confirmed");
  });

  it("notifyBookingConfirmed forwards worker and slot fields", async () => {
    await service.notifyBookingConfirmed(BASE_BOOKING_CONFIRMED);
    const payload = provider.events[0].payload as typeof BASE_BOOKING_CONFIRMED & { event: string };
    expect(payload.workerName).toBe("Bob");
    expect(payload.slotStartsAt).toBe("2026-05-01T10:00:00Z");
  });

  it("notifyPaymentFailed sends event=payment_failed", async () => {
    await service.notifyPaymentFailed(BASE_PAYMENT_FAILED);
    expect(provider.events[0].payload.event).toBe("payment_failed");
  });

  it("notifyPaymentFailed forwards optional reason", async () => {
    await service.notifyPaymentFailed(BASE_PAYMENT_FAILED);
    const payload = provider.events[0].payload as typeof BASE_PAYMENT_FAILED & { event: string };
    expect(payload.reason).toBe("card_declined");
  });

  it("notifyPaymentFailed works without a reason field", async () => {
    const { reason: _, ...noReason } = BASE_PAYMENT_FAILED;
    const result = await service.notifyPaymentFailed(noReason);
    expect(result.success).toBe(true);
  });

  it("notifyReservationExpired sends event=reservation_expired", async () => {
    await service.notifyReservationExpired(BASE_RESERVATION_EXPIRED);
    expect(provider.events[0].payload.event).toBe("reservation_expired");
  });

  it("notifyReservationExpired works without customerPhone/Name (optional fields)", async () => {
    const result = await service.notifyReservationExpired({
      jobId: "job-002",
      reservationId: "res-002",
    });
    expect(result.success).toBe(true);
  });

  it("returns success: true from each typed helper", async () => {
    const results = await Promise.all([
      service.notifyPaymentRequested(BASE_PAYMENT_REQUESTED),
      service.notifyBookingConfirmed(BASE_BOOKING_CONFIRMED),
      service.notifyPaymentFailed(BASE_PAYMENT_FAILED),
      service.notifyReservationExpired(BASE_RESERVATION_EXPIRED),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

// ─── NotificationService — error handling ─────────────────────────────────────

describe("NotificationService error handling", () => {
  it("catches provider exceptions and returns success: false", async () => {
    const throwingProvider: NotificationProvider = {
      name: "throwing",
      send: async () => { throw new Error("SMS gateway unreachable"); },
    };
    const service = new NotificationService(throwingProvider);

    const result = await service.notifyPaymentRequested(BASE_PAYMENT_REQUESTED);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/unreachable/);
    expect(result.provider).toBe("throwing");
  });

  it("catches non-Error throws and still returns success: false", async () => {
    const throwingProvider: NotificationProvider = {
      name: "string-throw",
      send: async () => { throw "unexpected string error"; },
    };
    const service = new NotificationService(throwingProvider);
    const result = await service.notifyBookingConfirmed(BASE_BOOKING_CONFIRMED);
    expect(result.success).toBe(false);
  });

  it("does not rethrow — booking flow is never interrupted by notification failure", async () => {
    const throwingProvider: NotificationProvider = {
      name: "failing",
      send: async (): Promise<NotificationResult> => {
        throw new Error("network down");
      },
    };
    const service = new NotificationService(throwingProvider);

    // If this throws the test fails — it must not throw
    await expect(
      service.notifyPaymentFailed(BASE_PAYMENT_FAILED),
    ).resolves.not.toThrow();
  });
});

// ─── NotificationService — provider management ────────────────────────────────

describe("NotificationService provider management", () => {
  it("uses LoggingNotificationProvider by default", () => {
    const service = new NotificationService();
    expect(service.getProvider().name).toBe("logging");
  });

  it("setProvider swaps the active provider", async () => {
    const service = new NotificationService();
    const customProvider: NotificationProvider = {
      name: "custom",
      send: async () => ({ success: true, provider: "custom" }),
    };
    service.setProvider(customProvider);
    expect(service.getProvider().name).toBe("custom");
  });

  it("subsequent sends use the new provider after setProvider", async () => {
    const original = new LoggingNotificationProvider();
    const service = new NotificationService(original);

    const replacement = new LoggingNotificationProvider();
    service.setProvider(replacement);

    await service.notifyPaymentRequested(BASE_PAYMENT_REQUESTED);

    expect(original.events).toHaveLength(0);
    expect(replacement.events).toHaveLength(1);
  });
});

// ─── Singleton export ─────────────────────────────────────────────────────────

describe("notificationService singleton", () => {
  it("is a NotificationService instance", () => {
    expect(notificationService).toBeInstanceOf(NotificationService);
  });

  it("uses the logging provider by default", () => {
    expect(notificationService.getProvider().name).toBe("logging");
  });
});
