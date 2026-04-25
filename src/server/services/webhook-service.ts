/**
 * Webhook Service
 *
 * Handles Stripe webhook events after the route handler has verified the
 * signature. All functions are idempotent — replaying the same event
 * produces the same result without duplicating DB writes.
 *
 * Events handled:
 *
 *   checkout.session.completed
 *     → payment succeeded (mode=payment)
 *     → marks payment as paid
 *     → stores stripe_payment_intent_id on the payment row
 *     → advances job to confirmed
 *     → marks reservation as confirmed
 *
 *   checkout.session.expired
 *     → customer let the Checkout Session time out without paying
 *     → marks payment as failed
 *     → moves job back to slot_held (reservation still held)
 *       so the voice agent can offer a new payment link
 *
 *   payment_intent.payment_failed
 *     → card declined / bank refused
 *     → marks payment as failed
 *     → moves job back to slot_held
 *
 * Error codes returned by each handler:
 *   payment_not_found   — no payment row for the Stripe session/intent
 *   already_processed   — payment is already in the target state (idempotent)
 *   db_error            — a Supabase write failed
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { smsService } from "./sms-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookHandlerResult =
  | { success: true; alreadyProcessed: boolean }
  | { success: false; error: "payment_not_found" | "already_processed" | "db_error"; message: string };

// ─── checkout.session.completed ───────────────────────────────────────────────

/**
 * Payment succeeded.
 * Idempotent: if the payment row is already "paid", returns alreadyProcessed=true.
 */
export async function handleCheckoutSessionCompleted(
  stripeSessionId: string,
  stripePaymentIntentId: string | null,
): Promise<WebhookHandlerResult> {
  const supabase = createSupabaseServiceClient();

  // 1. Look up the payment row by Stripe session ID
  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, job_id, reservation_id, status")
    .eq("stripe_checkout_session_id", stripeSessionId)
    .single();

  if (paymentError || !payment) {
    return {
      success: false,
      error: "payment_not_found",
      message: `No payment found for Stripe session: ${stripeSessionId}`,
    };
  }

  const { id: paymentId, job_id: jobId, reservation_id: reservationId, status } =
    payment as {
      id: string;
      job_id: string;
      reservation_id: string | null;
      status: string;
    };

  // 2. Idempotency — already confirmed
  if (status === "paid") {
    return { success: true, alreadyProcessed: true };
  }

  // 3. Mark payment as paid
  const { error: paymentUpdateError } = await supabase
    .from("payments")
    .update({
      status: "paid",
      stripe_payment_intent_id: stripePaymentIntentId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId);

  if (paymentUpdateError) {
    return {
      success: false,
      error: "db_error",
      message: `Failed to update payment to paid: ${paymentUpdateError.message}`,
    };
  }

  // 4. Advance job to confirmed
  const { error: jobUpdateError } = await supabase
    .from("jobs")
    .update({
      status: "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "awaiting_payment"); // guard — only move if still awaiting

  if (jobUpdateError) {
    return {
      success: false,
      error: "db_error",
      message: `Failed to advance job to confirmed: ${jobUpdateError.message}`,
    };
  }

  // 5. Mark reservation as confirmed (locks the slot permanently)
  if (reservationId) {
    await supabase
      .from("reservations")
      .update({
        status: "confirmed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId)
      .eq("status", "held"); // only update if still held
  }

  // 6. Send booking confirmation via WhatsApp (fire-and-forget).
  //    Look up customer phone, customer name, worker name, and slot times.
  (async () => {
    try {
      // Fetch customer contact info via the job
      const { data: jobRow } = await supabase
        .from("jobs")
        .select("customers(name, phone_number), call_sessions(id)")
        .eq("id", jobId)
        .single();

      const j = jobRow as {
        customers: { name: string | null; phone_number: string | null } | null;
        call_sessions: Array<{ id: string }>;
      } | null;

      const phoneNumber = j?.customers?.phone_number;
      if (!phoneNumber) return; // no phone — can't send

      const callSessionId = j?.call_sessions?.[0]?.id ?? null;
      if (!callSessionId) return; // no session to attribute message to

      // Fetch slot times and worker name from the reservation
      let workerName = "your engineer";
      let slotStartsAt = "";
      let slotEndsAt = "";

      if (reservationId) {
        const { data: resRow } = await supabase
          .from("reservations")
          .select("starts_at, ends_at, workers(name)")
          .eq("id", reservationId)
          .single();

        const r = resRow as {
          starts_at: string;
          ends_at: string;
          workers: { name: string | null } | null;
        } | null;

        if (r) {
          slotStartsAt = r.starts_at;
          slotEndsAt = r.ends_at;
          workerName = r.workers?.name ?? "your engineer";
        }
      }

      await smsService.sendBookingConfirmation({
        to: phoneNumber,
        callSessionId,
        jobId,
        customerName: j?.customers?.name ?? null,
        workerName,
        slotStartsAt,
        slotEndsAt,
      });
    } catch (err) {
      console.error("[webhook-service] WhatsApp booking confirmation send failed:", err);
    }
  })();

  return { success: true, alreadyProcessed: false };
}

// ─── checkout.session.expired ─────────────────────────────────────────────────

/**
 * Customer let the Checkout Session time out without paying.
 * Moves payment to failed, job back to slot_held so it can be retried.
 * Idempotent: if already failed/paid, returns alreadyProcessed=true.
 */
export async function handleCheckoutSessionExpired(
  stripeSessionId: string,
): Promise<WebhookHandlerResult> {
  const supabase = createSupabaseServiceClient();

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, job_id, status")
    .eq("stripe_checkout_session_id", stripeSessionId)
    .single();

  if (paymentError || !payment) {
    return {
      success: false,
      error: "payment_not_found",
      message: `No payment found for Stripe session: ${stripeSessionId}`,
    };
  }

  const { id: paymentId, job_id: jobId, status } = payment as {
    id: string;
    job_id: string;
    status: string;
  };

  // Idempotency
  if (status === "failed" || status === "paid") {
    return { success: true, alreadyProcessed: true };
  }

  // Mark payment failed
  const { error: paymentUpdateError } = await supabase
    .from("payments")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", paymentId);

  if (paymentUpdateError) {
    return {
      success: false,
      error: "db_error",
      message: `Failed to mark payment as failed: ${paymentUpdateError.message}`,
    };
  }

  // Move job back to slot_held so the voice agent can retry payment
  await supabase
    .from("jobs")
    .update({ status: "slot_held", updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "awaiting_payment");

  return { success: true, alreadyProcessed: false };
}

// ─── payment_intent.payment_failed ───────────────────────────────────────────

/**
 * Card declined or payment failed at the PaymentIntent level.
 * Same outcome as session expired — payment failed, job back to slot_held.
 * Idempotent: looks up by stripe_payment_intent_id.
 */
export async function handlePaymentIntentFailed(
  stripePaymentIntentId: string,
): Promise<WebhookHandlerResult> {
  const supabase = createSupabaseServiceClient();

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, job_id, status")
    .eq("stripe_payment_intent_id", stripePaymentIntentId)
    .single();

  if (paymentError || !payment) {
    // payment_intent.payment_failed can fire before checkout.session.completed
    // links the intent ID — treat as a non-fatal miss
    return {
      success: false,
      error: "payment_not_found",
      message: `No payment found for PaymentIntent: ${stripePaymentIntentId}`,
    };
  }

  const { id: paymentId, job_id: jobId, status } = payment as {
    id: string;
    job_id: string;
    status: string;
  };

  // Idempotency
  if (status === "failed" || status === "paid") {
    return { success: true, alreadyProcessed: true };
  }

  const { error: paymentUpdateError } = await supabase
    .from("payments")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", paymentId);

  if (paymentUpdateError) {
    return {
      success: false,
      error: "db_error",
      message: `Failed to mark payment as failed: ${paymentUpdateError.message}`,
    };
  }

  await supabase
    .from("jobs")
    .update({ status: "slot_held", updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "awaiting_payment");

  return { success: true, alreadyProcessed: false };
}
