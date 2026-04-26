/**
 * SMS Service
 *
 * Handles outbound SMS message generation, delivery, and DB tracking.
 *
 * Architecture:
 *   SmsProvider interface     — pluggable transport (Twilio, mock, future providers)
 *   TwilioSmsProvider         — real delivery via Twilio REST API
 *   MockSmsProvider           — in-memory store for dev / tests (no network calls)
 *   SmsService                — orchestrates: renders template → sends → writes
 *                               outbound_messages row to DB
 *
 * Message templates (OutboundMessageType):
 *   intake_form_link          — sent immediately when a call session is created
 *   image_upload_link         — optional, sent when worker requests photos
 *   payment_link              — sent after slot is held and form is complete
 *   booking_confirmation      — sent after successful Stripe payment
 *
 * Design rules:
 *   - A failed SMS NEVER throws into the caller — returns SmsResult { success: false }
 *   - Every sent message is written to outbound_messages for auditability
 *   - DB write failure is logged but does not fail the send result
 *   - TwilioSmsProvider is only instantiated when credentials are present
 *   - The service falls back to MockSmsProvider when Twilio vars are absent
 */

import { appConfig } from "@/config/app-config";
import { getTwilioClient } from "@/server/twilio/client";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import type { OutboundMessageType } from "@/domain/types";

// ─── Provider interface ───────────────────────────────────────────────────────

export type SmsResult =
  | { success: true; provider: string; providerMessageId?: string }
  | { success: false; provider: string; error: string };

export interface SmsProvider {
  readonly name: string;
  /** Send a raw SMS. Returns SmsResult — never throws. */
  send(to: string, body: string): Promise<SmsResult>;
}

// ─── Twilio provider ──────────────────────────────────────────────────────────

/**
 * TwilioSmsProvider
 *
 * Sends SMS via the Twilio Messages API.
 * The `from` number is read from appConfig.serviceCredentials.twilio.fromNumber.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to be set.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  async send(to: string, body: string): Promise<SmsResult> {
    try {
      const twilio = getTwilioClient();
      const from = appConfig.serviceCredentials.twilio.fromNumber;
      if (!from) {
        return {
          success: false,
          provider: this.name,
          error: "TWILIO_FROM_NUMBER is not configured.",
        };
      }

      // If the from number is the WhatsApp sandbox (+14155238886) or any
      // whatsapp:-prefixed address, send via WhatsApp channel.
      // Both to and from must carry the "whatsapp:" prefix for the Twilio API.
      const isWhatsApp = from === "+14155238886" || from.startsWith("whatsapp:");
      const resolvedFrom = isWhatsApp
        ? `whatsapp:${from.replace(/^whatsapp:/, "")}`
        : from;
      const resolvedTo = isWhatsApp
        ? `whatsapp:${to.replace(/^whatsapp:/, "")}`
        : to;

      const message = await twilio.messages.create({
        to: resolvedTo,
        from: resolvedFrom,
        body,
      });
      return {
        success: true,
        provider: this.name,
        providerMessageId: message.sid,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[sms:twilio] Failed to send to ${to}:`, error);
      return { success: false, provider: this.name, error };
    }
  }
}

// ─── Mock provider ────────────────────────────────────────────────────────────

export type MockSentMessage = {
  to: string;
  body: string;
  sentAt: string;
};

/**
 * MockSmsProvider
 *
 * In-memory SMS provider for local development and tests.
 * No network calls. Stores sent messages in `messages` for test assertions.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly messages: MockSentMessage[] = [];
  private _shouldFail = false;

  /** Force the next send() call to return a failure (for error path tests). */
  failNext(): void {
    this._shouldFail = true;
  }

  async send(to: string, body: string): Promise<SmsResult> {
    if (this._shouldFail) {
      this._shouldFail = false;
      return { success: false, provider: this.name, error: "Simulated SMS failure" };
    }
    const msg: MockSentMessage = { to, body, sentAt: new Date().toISOString() };
    this.messages.push(msg);
    console.log(`[sms:mock] → ${to}: ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`);
    return {
      success: true,
      provider: this.name,
      providerMessageId: `mock-${Date.now()}`,
    };
  }

  /** Clear stored messages — call between tests. */
  clear(): void {
    this.messages.length = 0;
    this._shouldFail = false;
  }
}

// ─── Template rendering ───────────────────────────────────────────────────────

export type IntakeFormLinkParams = {
  customerName: string | null;
  intakeFormUrl: string;
};

export type ImageUploadLinkParams = {
  customerName: string | null;
  uploadUrl: string;
};

export type PaymentLinkParams = {
  customerName: string | null;
  paymentUrl: string;
  amountPence: number;
  currency: string;
};

export type BookingConfirmationParams = {
  customerName: string | null;
  workerName: string;
  slotStartsAt: string; // ISO string
  slotEndsAt: string;   // ISO string
};

/** Render the message body for a given template type. */
export function renderSmsBody(
  type: OutboundMessageType,
  params:
    | IntakeFormLinkParams
    | ImageUploadLinkParams
    | PaymentLinkParams
    | BookingConfirmationParams,
): string {
  const name = params.customerName ?? "there";

  switch (type) {
    case "intake_form_link": {
      const p = params as IntakeFormLinkParams;
      return (
        `Hi ${name}, your AI booking assistant needs a few details. ` +
        `Please fill in this short form (takes under 60 seconds): ${p.intakeFormUrl}`
      );
    }

    case "image_upload_link": {
      const p = params as ImageUploadLinkParams;
      return (
        `Hi ${name}, if you have photos of the issue, please upload them here ` +
        `so our engineer can prepare: ${p.uploadUrl}`
      );
    }

    case "payment_link": {
      const p = params as PaymentLinkParams;
      const amount = formatAmount(p.amountPence, p.currency);
      return (
        `Hi ${name}, to confirm your booking please pay the ${amount} call-out fee: ` +
        `${p.paymentUrl} — your slot is held for 2 hours.`
      );
    }

    case "booking_confirmation": {
      const p = params as BookingConfirmationParams;
      const slot = formatSlot(p.slotStartsAt, p.slotEndsAt);
      return (
        `Hi ${name}, your booking is confirmed! ${p.workerName} will attend on ${slot}. ` +
        `Please be available at your address.`
      );
    }
  }
}

function formatAmount(pence: number, currency: string): string {
  const pounds = (pence / 100).toFixed(2);
  const symbol = currency.toLowerCase() === "gbp" ? "£" : currency.toUpperCase() + " ";
  return `${symbol}${pounds}`;
}

function formatSlot(startsAt: string, endsAt: string): string {
  try {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const dateStr = start.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const startTime = start.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const endTime = end.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${dateStr} between ${startTime}–${endTime}`;
  } catch {
    return `${startsAt} – ${endsAt}`;
  }
}

// ─── Send result with DB tracking ─────────────────────────────────────────────

export type SendSmsResult =
  | {
      success: true;
      provider: string;
      providerMessageId?: string;
      outboundMessageId: string | null; // null if DB write failed (non-fatal)
    }
  | { success: false; provider: string; error: string };

// ─── SMS Service ──────────────────────────────────────────────────────────────

/**
 * SmsService
 *
 * Orchestrates template rendering, SMS delivery, and DB tracking.
 * Uses a pluggable SmsProvider so tests can inject a MockSmsProvider.
 *
 * The active provider is determined at construction time:
 *   - If Twilio credentials are present → TwilioSmsProvider
 *   - Otherwise → MockSmsProvider (safe for local dev and CI)
 *
 * All send methods catch every error — a broken SMS provider never
 * propagates an exception into the booking flow.
 */
export class SmsService {
  private provider: SmsProvider;

  constructor(provider?: SmsProvider) {
    if (provider) {
      this.provider = provider;
    } else {
      const { accountSid, authToken, fromNumber } =
        appConfig.serviceCredentials.twilio;
      if (accountSid && authToken && fromNumber) {
        this.provider = new TwilioSmsProvider();
      } else {
        this.provider = new MockSmsProvider();
      }
    }
  }

  getProvider(): SmsProvider {
    return this.provider;
  }

  /** Swap the provider at runtime (useful in tests). */
  setProvider(provider: SmsProvider): void {
    this.provider = provider;
  }

  // ─── Typed send helpers ─────────────────────────────────────────────────────

  async sendIntakeFormLink(
    opts: { to: string; callSessionId: string; jobId: string | null } & IntakeFormLinkParams,
  ): Promise<SendSmsResult> {
    const body = renderSmsBody("intake_form_link", opts);
    return this._sendAndTrack({
      to: opts.to,
      body,
      messageType: "intake_form_link",
      callSessionId: opts.callSessionId,
      jobId: opts.jobId,
    });
  }

  async sendImageUploadLink(
    opts: { to: string; callSessionId: string; jobId: string | null } & ImageUploadLinkParams,
  ): Promise<SendSmsResult> {
    const body = renderSmsBody("image_upload_link", opts);
    return this._sendAndTrack({
      to: opts.to,
      body,
      messageType: "image_upload_link",
      callSessionId: opts.callSessionId,
      jobId: opts.jobId,
    });
  }

  async sendPaymentLink(
    opts: { to: string; callSessionId: string; jobId: string | null } & PaymentLinkParams,
  ): Promise<SendSmsResult> {
    const body = renderSmsBody("payment_link", opts);
    return this._sendAndTrack({
      to: opts.to,
      body,
      messageType: "payment_link",
      callSessionId: opts.callSessionId,
      jobId: opts.jobId,
    });
  }

  async sendBookingConfirmation(
    opts: { to: string; callSessionId: string; jobId: string | null } & BookingConfirmationParams,
  ): Promise<SendSmsResult> {
    const body = renderSmsBody("booking_confirmation", opts);
    return this._sendAndTrack({
      to: opts.to,
      body,
      messageType: "booking_confirmation",
      callSessionId: opts.callSessionId,
      jobId: opts.jobId,
    });
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async _sendAndTrack(opts: {
    to: string;
    body: string;
    messageType: OutboundMessageType;
    callSessionId: string;
    jobId: string | null;
  }): Promise<SendSmsResult> {
    // Safety-net: normalise UK local numbers to E.164 if not already done upstream
    const rawTo = opts.to.replace(/[\s\-().]/g, "");
    let normalisedTo = rawTo;
    if (!rawTo.startsWith("+") && !rawTo.startsWith("whatsapp:")) {
      if (rawTo.startsWith("0044")) normalisedTo = `+44${rawTo.slice(4)}`;
      else if (rawTo.startsWith("0") && rawTo.length >= 10) normalisedTo = `+44${rawTo.slice(1)}`;
      else if (rawTo.startsWith("44") && rawTo.length >= 12) normalisedTo = `+${rawTo}`;
    }
    if (normalisedTo !== rawTo) {
      console.warn(`[sms] Normalised phone from "${rawTo}" to "${normalisedTo}"`);
    }
    opts = { ...opts, to: normalisedTo };

    // 1. Send via provider
    let result: SmsResult;
    try {
      result = await this.provider.send(opts.to, opts.body);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[sms] Provider "${this.provider.name}" threw unexpectedly:`, error);
      result = { success: false, provider: this.provider.name, error };
    }

    // 2. Write to outbound_messages (best-effort — never blocks the send result)
    let outboundMessageId: string | null = null;
    try {
      outboundMessageId = await this._persistMessage({
        callSessionId: opts.callSessionId,
        jobId: opts.jobId,
        recipientPhone: opts.to,
        messageType: opts.messageType,
        messageBody: opts.body,
        delivered: result.success ? null : false, // null = awaiting receipt; false = failed
        deliveryMetadata: result.success
          ? { provider: result.provider, providerMessageId: result.providerMessageId ?? null }
          : { provider: result.provider, error: result.error },
      });
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error(`[sms] Failed to persist outbound_messages row:`, msg);
    }

    if (!result.success) {
      return { success: false, provider: result.provider, error: result.error };
    }

    return {
      success: true,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      outboundMessageId,
    };
  }

  private async _persistMessage(opts: {
    callSessionId: string;
    jobId: string | null;
    recipientPhone: string;
    messageType: OutboundMessageType;
    messageBody: string;
    delivered: boolean | null;
    deliveryMetadata: Record<string, unknown>;
  }): Promise<string | null> {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("outbound_messages")
      .insert({
        call_session_id: opts.callSessionId,
        job_id: opts.jobId,
        recipient_phone: opts.recipientPhone,
        message_type: opts.messageType,
        message_body: opts.messageBody,
        delivered: opts.delivered,
        delivery_metadata: opts.deliveryMetadata,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Unknown DB error persisting outbound message");
    }
    return (data as { id: string }).id;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Default singleton.
 * Automatically selects TwilioSmsProvider when credentials are present,
 * otherwise falls back to MockSmsProvider.
 */
export const smsService = new SmsService();
