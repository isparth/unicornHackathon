/**
 * Payment Service
 *
 * Creates Stripe Checkout Sessions for job call-out fees and writes the
 * resulting payment record to the database.
 *
 * Flow:
 *   1. Load the job — must exist and be in a payable state.
 *   2. Idempotency check — if a payment row already exists for this job with
 *      a valid Stripe Checkout Session, return the existing URL.
 *   3. Hard gate — intake form must be complete and customer fields present.
 *   4. Create a Stripe Checkout Session (mode: "payment", hosted UI).
 *      - line_item: call-out fee from the job's price_estimate.
 *      - client_reference_id: jobId so webhooks can look up the job.
 *      - success_url / cancel_url: back to the app.
 *      - metadata: jobId, reservationId for audit / webhook use.
 *   5. Write a payments row to the DB (status: pending).
 *   6. Link payments.id → jobs.payment_id and advance job to awaiting_payment.
 *   7. Return { paymentUrl, paymentId, amountPence, currency }.
 *
 * Error codes:
 *   job_not_found         — job does not exist
 *   invalid_job_state     — job is not in a payable state
 *   intake_form_incomplete — intake form not yet submitted
 *   missing_customer_fields — required customer contact fields absent
 *   stripe_not_configured — STRIPE_SECRET_KEY env var not set
 *   stripe_error          — Stripe API returned an error
 *   db_error              — Supabase write failed
 */

import { appConfig } from "@/config/app-config";
import { getStripeClient } from "@/server/stripe/client";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import { smsService } from "./sms-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatePaymentSessionResult =
  | {
      success: true;
      jobId: string;
      paymentId: string;
      /** Stripe-hosted Checkout URL — send this to the customer via SMS */
      paymentUrl: string;
      amountPence: number;
      currency: string;
      alreadyDone: boolean;
    }
  | {
      success: false;
      error:
        | "job_not_found"
        | "invalid_job_state"
        | "intake_form_incomplete"
        | "missing_customer_fields"
        | "stripe_not_configured"
        | "stripe_error"
        | "db_error";
      message: string;
    };

// Job statuses that allow payment session creation
const PAYABLE_STATUSES = new Set(["priced", "slot_held", "awaiting_payment"]);

// Required customer fields
const REQUIRED_CUSTOMER_FIELDS = [
  "name",
  "address_line_1",
  "city",
  "postcode",
] as const;

// ─── Core function ────────────────────────────────────────────────────────────

export async function createPaymentSession(
  jobId: string,
): Promise<CreatePaymentSessionResult> {
  const supabase = createSupabaseServiceClient();

  // 1. Load the job
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select(
      `id, status, customer_id, reservation_id, price_estimate, payment_id,
       call_sessions(id, intake_form_completed_at)`,
    )
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return {
      success: false,
      error: "job_not_found",
      message: `Job not found: ${jobId}`,
    };
  }

  const {
    status,
    customer_id: customerId,
    reservation_id: reservationId,
    price_estimate: priceEstimate,
    payment_id: existingPaymentId,
  } = job as {
    status: string;
    customer_id: string | null;
    reservation_id: string | null;
    price_estimate: { calloutFeePence: number; currency: string } | null;
    payment_id: string | null;
    call_sessions: Array<{ id: string; intake_form_completed_at: string | null }>;
  };

  // 2. Idempotency — return existing session if job already has a payment
  if (existingPaymentId && status === "awaiting_payment") {
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, stripe_checkout_session_id, amount_pence, currency, metadata")
      .eq("id", existingPaymentId)
      .eq("status", "pending")
      .single();

    const p = existingPayment as {
      id: string;
      stripe_checkout_session_id: string | null;
      amount_pence: number;
      currency: string;
      metadata: { checkout_url?: string };
    } | null;

    if (p?.stripe_checkout_session_id && p.metadata?.checkout_url) {
      return {
        success: true,
        jobId,
        paymentId: p.id,
        paymentUrl: p.metadata.checkout_url,
        amountPence: p.amount_pence,
        currency: p.currency,
        alreadyDone: true,
      };
    }
  }

  // 3a. Hard gate: payable state
  if (!PAYABLE_STATUSES.has(status)) {
    return {
      success: false,
      error: "invalid_job_state",
      message: `Job is in state "${status}" which does not allow payment creation. The job must be priced or have a slot held first.`,
    };
  }

  // 3b. Hard gate: intake form must be complete
  const sessions = (
    job as { call_sessions: Array<{ intake_form_completed_at: string | null }> }
  ).call_sessions;

  if (!sessions.some((s) => s.intake_form_completed_at != null)) {
    return {
      success: false,
      error: "intake_form_incomplete",
      message:
        "The intake form has not been completed. The payment link cannot be created until the customer has submitted their contact details.",
    };
  }

  // 3c. Hard gate: required customer fields
  if (customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("name, address_line_1, city, postcode")
      .eq("id", customerId)
      .single();

    const c = customer as Record<string, string | null> | null;
    const missing = REQUIRED_CUSTOMER_FIELDS.filter((f) => !c?.[f]?.trim());

    if (missing.length > 0) {
      return {
        success: false,
        error: "missing_customer_fields",
        message: `Customer record is missing required fields: ${missing.join(", ")}.`,
      };
    }
  }

  // 4. Determine payment amount
  const amountPence = priceEstimate?.calloutFeePence ?? appConfig.pricingDefaults.calloutFeePence;
  const currency = priceEstimate?.currency ?? appConfig.pricingDefaults.currency;

  // 5. Create Stripe Checkout Session
  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return {
      success: false,
      error: "stripe_not_configured",
      message: "Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.",
    };
  }

  const appUrl = appConfig.appUrl;
  const successUrl = `${appUrl}/payment/success?jobId=${jobId}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/payment/cancelled?jobId=${jobId}`;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountPence,
            product_data: {
              name: "Call-out fee",
              description:
                "Engineer call-out fee for your booked appointment. " +
                "Any additional repair costs will be agreed on-site.",
            },
          },
        },
      ],
      client_reference_id: jobId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        job_id: jobId,
        reservation_id: reservationId ?? "",
      },
      // Pre-fill customer email if we have it (fetched from customers table above)
      payment_intent_data: {
        metadata: {
          job_id: jobId,
          reservation_id: reservationId ?? "",
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: "stripe_error",
      message: `Stripe Checkout Session creation failed: ${message}`,
    };
  }

  const checkoutUrl = session.url ?? "";

  // 6. Write payments row
  const { data: newPayment, error: paymentInsertError } = await supabase
    .from("payments")
    .insert({
      job_id: jobId,
      reservation_id: reservationId ?? null,
      status: "pending",
      amount_pence: amountPence,
      currency,
      stripe_checkout_session_id: session.id,
      metadata: {
        checkout_url: checkoutUrl,
        stripe_session_id: session.id,
      },
    })
    .select("id")
    .single();

  if (paymentInsertError || !newPayment) {
    return {
      success: false,
      error: "db_error",
      message: `Payment record could not be created: ${paymentInsertError?.message ?? "unknown error"}`,
    };
  }

  const paymentId = (newPayment as { id: string }).id;

  // 7. Link payment to job and advance to awaiting_payment
  const { error: jobUpdateError } = await supabase
    .from("jobs")
    .update({
      status: "awaiting_payment",
      payment_id: paymentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (jobUpdateError) {
    return {
      success: false,
      error: "db_error",
      message: `Payment created (${paymentId}) but failed to update job: ${jobUpdateError.message}`,
    };
  }

  // 8. Send the payment link via WhatsApp (fire-and-forget).
  //    Look up the customer's phone number and the linked call session.
  (async () => {
    try {
      const { data: callSession } = await supabase
        .from("call_sessions")
        .select("id, customers(name, phone_number)")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const session = callSession as {
        id: string;
        customers: { name: string | null; phone_number: string | null } | null;
      } | null;

      const phoneNumber = session?.customers?.phone_number;
      if (!phoneNumber) return; // no phone — can't send

      await smsService.sendPaymentLink({
        to: phoneNumber,
        callSessionId: session.id,
        jobId,
        customerName: session.customers?.name ?? null,
        paymentUrl: checkoutUrl,
        amountPence,
        currency,
      });
    } catch (err) {
      console.error("[payment-service] WhatsApp payment link send failed:", err);
    }
  })();

  return {
    success: true,
    jobId,
    paymentId,
    paymentUrl: checkoutUrl,
    amountPence,
    currency,
    alreadyDone: false,
  };
}
