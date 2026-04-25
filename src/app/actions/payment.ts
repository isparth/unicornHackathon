"use server";

/**
 * Payment Session Action
 *
 * Thin server-action wrapper around the PaymentService.
 * All business logic (hard gates, Stripe call, DB write) lives in
 * src/server/services/payment-service.ts.
 *
 * This action is called by:
 *   - The voice agent via the /api/tools/create-payment-session route
 *   - The dashboard UI directly
 *
 * Hard gate rules (enforced in payment-service.ts, not bypassable via UI):
 *   1. Job must exist.
 *   2. The call session linked to the job must have intake_form_completed_at set.
 *   3. The job must have all required customer contact fields (name, address).
 *   4. The job must be in a state that allows payment (priced, slot_held, or awaiting_payment).
 */

import {
  createPaymentSession as _createPaymentSession,
  type CreatePaymentSessionResult,
} from "@/server/services/payment-service";

export type { CreatePaymentSessionResult };

/**
 * Create (or retrieve) a Stripe Checkout Session for a job.
 *
 * @param jobId - The jobs.id to create a payment session for.
 * @returns A typed result with the Stripe-hosted paymentUrl on success.
 */
export async function createPaymentSession(
  jobId: string,
): Promise<CreatePaymentSessionResult> {
  return _createPaymentSession(jobId);
}
