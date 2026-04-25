/**
 * Notification Service
 *
 * Defines the notification event model and a pluggable provider interface.
 * In v1 the default implementation is a LoggingNotificationProvider that
 * records every event to the console and an in-memory log — useful for
 * development, testing, and demo walkthroughs without a real SMS gateway.
 *
 * Swapping to a real provider (Vapi SMS, Twilio, etc.) requires only:
 *   1. Implement the NotificationProvider interface.
 *   2. Pass the new provider to NotificationService or call setProvider().
 *
 * Events:
 *   payment_requested   — customer has been sent a payment link
 *   booking_confirmed   — payment succeeded, booking is locked in
 *   payment_failed      — card declined or Stripe session expired
 *   reservation_expired — hold window elapsed without payment
 *
 * All send methods return a typed result so callers can decide whether to
 * surface the error (e.g. log it) or silently continue — notifications must
 * never block the core booking flow.
 */

// ─── Event types ─────────────────────────────────────────────────────────────

export type NotificationEventType =
  | "payment_requested"
  | "booking_confirmed"
  | "payment_failed"
  | "reservation_expired";

export type PaymentRequestedPayload = {
  event: "payment_requested";
  jobId: string;
  customerPhone: string;
  customerName: string;
  paymentUrl: string;
  amountPence: number;
  currency: string;
};

export type BookingConfirmedPayload = {
  event: "booking_confirmed";
  jobId: string;
  customerPhone: string;
  customerName: string;
  workerName: string;
  slotStartsAt: string;  // ISO string
  slotEndsAt: string;    // ISO string
};

export type PaymentFailedPayload = {
  event: "payment_failed";
  jobId: string;
  customerPhone: string;
  customerName: string;
  reason?: string;
};

export type ReservationExpiredPayload = {
  event: "reservation_expired";
  jobId: string;
  reservationId: string;
  customerPhone?: string;
  customerName?: string;
};

export type NotificationPayload =
  | PaymentRequestedPayload
  | BookingConfirmedPayload
  | PaymentFailedPayload
  | ReservationExpiredPayload;

// ─── Result type ──────────────────────────────────────────────────────────────

export type NotificationResult =
  | { success: true; provider: string }
  | { success: false; provider: string; error: string };

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * A NotificationProvider is responsible for delivering a single notification
 * event.  Implementations are free to batch, queue, or skip events as needed.
 */
export interface NotificationProvider {
  readonly name: string;
  send(payload: NotificationPayload): Promise<NotificationResult>;
}

// ─── Logged event record (for testing / inspection) ───────────────────────────

export type LoggedNotificationEvent = {
  timestamp: string;
  provider: string;
  result: NotificationResult;
  payload: NotificationPayload;
};

// ─── Logging provider (default / dev / test) ─────────────────────────────────

/**
 * LoggingNotificationProvider
 *
 * Writes every event to console and keeps an in-memory log so tests can
 * inspect what was sent without any external dependency.
 *
 * This is the default provider for v1.  Replace it with a real SMS or
 * messaging provider in production.
 */
export class LoggingNotificationProvider implements NotificationProvider {
  readonly name = "logging";
  readonly events: LoggedNotificationEvent[] = [];

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const result: NotificationResult = { success: true, provider: this.name };
    const record: LoggedNotificationEvent = {
      timestamp: new Date().toISOString(),
      provider: this.name,
      result,
      payload,
    };
    this.events.push(record);
    console.log(`[notifications:${this.name}] ${payload.event}`, {
      jobId: "jobId" in payload ? payload.jobId : undefined,
      event: payload.event,
    });
    return result;
  }

  /** Clear the event log — useful between tests. */
  clear(): void {
    this.events.length = 0;
  }
}

// ─── Notification Service ─────────────────────────────────────────────────────

/**
 * NotificationService
 *
 * Thin orchestration layer that delegates to the active provider.
 * Wraps every send() call in a try/catch so a broken provider never
 * propagates an exception into the booking flow.
 */
export class NotificationService {
  private provider: NotificationProvider;

  constructor(provider: NotificationProvider = new LoggingNotificationProvider()) {
    this.provider = provider;
  }

  /** Swap the active provider at runtime (e.g. in tests). */
  setProvider(provider: NotificationProvider): void {
    this.provider = provider;
  }

  getProvider(): NotificationProvider {
    return this.provider;
  }

  // ─── Typed send helpers ───────────────────────────────────────────────────

  async notifyPaymentRequested(
    payload: Omit<PaymentRequestedPayload, "event">,
  ): Promise<NotificationResult> {
    return this.send({ event: "payment_requested", ...payload });
  }

  async notifyBookingConfirmed(
    payload: Omit<BookingConfirmedPayload, "event">,
  ): Promise<NotificationResult> {
    return this.send({ event: "booking_confirmed", ...payload });
  }

  async notifyPaymentFailed(
    payload: Omit<PaymentFailedPayload, "event">,
  ): Promise<NotificationResult> {
    return this.send({ event: "payment_failed", ...payload });
  }

  async notifyReservationExpired(
    payload: Omit<ReservationExpiredPayload, "event">,
  ): Promise<NotificationResult> {
    return this.send({ event: "reservation_expired", ...payload });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      return await this.provider.send(payload);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[notifications] Provider "${this.provider.name}" threw:`, error);
      return { success: false, provider: this.provider.name, error };
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Default singleton using the logging provider.
 * Import this in server actions / webhook handlers / service code.
 */
export const notificationService = new NotificationService();
