"use server";

/**
 * Payment Session Action
 *
 * Creates a (stub) payment session for a job, enforcing the hard gate that
 * blocks payment creation if the customer has not completed the intake form.
 *
 * Hard gate rules (all checked server-side — cannot be bypassed by the UI):
 *   1. Job must exist.
 *   2. The call session linked to the job must have intake_form_completed_at set.
 *   3. The job must have all required customer contact fields (name, address).
 *   4. The job must be in a state that allows payment (priced, slot_held, or awaiting_payment).
 *
 * The payment session creation itself is a stub in v1 — it advances the job to
 * `awaiting_payment` and returns a placeholder payment URL. Stripe integration
 * is wired in Milestone 4.
 *
 * The voice agent and dashboard both call this action and both receive the same
 * typed error response when the gate blocks.
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatePaymentSessionResult =
  | {
      success: true;
      jobId: string;
      /** Placeholder URL — real Stripe URL wired in Milestone 4 */
      paymentUrl: string;
      amountPence: number;
      currency: string;
    }
  | {
      success: false;
      error:
        | "job_not_found"
        | "intake_form_incomplete"
        | "missing_customer_fields"
        | "invalid_job_state"
        | "db_error";
      message: string;
    };

// Job statuses that are allowed to initiate payment
const PAYABLE_STATUSES = new Set([
  "priced",
  "slot_held",
  "awaiting_payment", // idempotent — already in payment flow
]);

// ─── Server action ────────────────────────────────────────────────────────────

/**
 * Create (or retrieve) a payment session for a job.
 *
 * @param jobId - The jobs.id to create a payment session for.
 */
export async function createPaymentSession(
  jobId: string,
): Promise<CreatePaymentSessionResult> {
  const supabase = createSupabaseServiceClient();

  // 1. Load the job with its customer and price estimate
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select(
      "id, status, customer_id, price_estimate, call_sessions(id, intake_form_completed_at, customer_id)",
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
    price_estimate: priceEstimate,
  } = job as {
    status: string;
    customer_id: string | null;
    price_estimate: {
      calloutFeePence: number;
      currency: string;
    } | null;
    call_sessions: Array<{
      id: string;
      intake_form_completed_at: string | null;
      customer_id: string | null;
    }>;
  };

  // 2. Hard gate: job must be in a payable state
  if (!PAYABLE_STATUSES.has(status)) {
    return {
      success: false,
      error: "invalid_job_state",
      message: `Job is in state "${status}" which does not allow payment creation. The job must be priced or have a slot held first.`,
    };
  }

  // 3. Hard gate: intake form must be complete
  //    We check call_sessions linked to this job.
  const sessions = (
    job as {
      call_sessions: Array<{
        id: string;
        intake_form_completed_at: string | null;
      }>;
    }
  ).call_sessions;

  const formCompleted = sessions.some((s) => s.intake_form_completed_at != null);

  if (!formCompleted) {
    return {
      success: false,
      error: "intake_form_incomplete",
      message:
        "The intake form has not been completed. The payment link cannot be created until the customer has submitted their contact details via the intake form.",
    };
  }

  // 4. Hard gate: customer must have required contact fields
  if (customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("name, address_line_1, city, postcode, phone_number")
      .eq("id", customerId)
      .single();

    const c = customer as {
      name: string | null;
      address_line_1: string | null;
      city: string | null;
      postcode: string | null;
      phone_number: string | null;
    } | null;

    const missingFields: string[] = [];
    if (!c?.name?.trim()) missingFields.push("name");
    if (!c?.address_line_1?.trim()) missingFields.push("address");
    if (!c?.city?.trim()) missingFields.push("city");
    if (!c?.postcode?.trim()) missingFields.push("postcode");

    if (missingFields.length > 0) {
      return {
        success: false,
        error: "missing_customer_fields",
        message: `Customer record is missing required fields: ${missingFields.join(", ")}. The intake form may not have been fully processed yet.`,
      };
    }
  }

  // 5. Determine the payment amount — callout fee from the price estimate
  const amountPence = priceEstimate?.calloutFeePence ?? 0;
  const currency = priceEstimate?.currency ?? "gbp";

  // 6. Advance job to awaiting_payment (idempotent — skip if already there)
  if (status !== "awaiting_payment") {
    const { error: updateError } = await supabase
      .from("jobs")
      .update({
        status: "awaiting_payment",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateError) {
      return {
        success: false,
        error: "db_error",
        message: `Failed to advance job to awaiting_payment: ${updateError.message}`,
      };
    }
  }

  // 7. Return the (stub) payment URL — Stripe Checkout wired in Milestone 4
  const paymentUrl = `/payment/stub?jobId=${jobId}&amount=${amountPence}&currency=${currency}`;

  return {
    success: true,
    jobId,
    paymentUrl,
    amountPence,
    currency,
  };
}
