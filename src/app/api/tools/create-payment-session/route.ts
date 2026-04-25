/**
 * POST /api/tools/create-payment-session
 *
 * Vapi tool: create a Stripe Checkout Session for a job and return the
 * payment URL so the voice agent can send it to the customer via SMS.
 *
 * Request body:
 *   {
 *     jobId: string   — jobs.id
 *   }
 *
 * Response (success):
 *   {
 *     success:     true
 *     jobId:       string
 *     paymentId:   string
 *     paymentUrl:  string  — Stripe-hosted Checkout URL to send to customer
 *     amountPence: number
 *     currency:    string
 *     alreadyDone: boolean — true if an existing pending session was returned
 *   }
 *
 * Response (failure):
 *   {
 *     success: false
 *     error:   string  — typed error code
 *     message: string
 *   }
 *
 * HTTP status codes:
 *   200 — session created or returned (alreadyDone)
 *   400 — bad request (missing jobId)
 *   404 — job not found
 *   409 — intake form not yet complete
 *   422 — invalid job state or missing customer fields
 *   500 — stripe error or db error
 *   503 — Stripe not configured
 */

import { NextResponse } from "next/server";
import { createPaymentSession } from "@/server/services/payment-service";
import { badRequest, parseBody } from "../_lib";

type RequestBody = {
  jobId: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);

  if (!body?.jobId?.trim()) {
    return badRequest("Request body must include jobId.");
  }

  const result = await createPaymentSession(body.jobId);

  if (!result.success) {
    const status =
      result.error === "job_not_found" ? 404
      : result.error === "intake_form_incomplete" ? 409
      : result.error === "invalid_job_state" || result.error === "missing_customer_fields" ? 422
      : result.error === "stripe_not_configured" ? 503
      : 500;

    return NextResponse.json(
      { success: false, error: result.error, message: result.message },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    jobId: result.jobId,
    paymentId: result.paymentId,
    paymentUrl: result.paymentUrl,
    amountPence: result.amountPence,
    currency: result.currency,
    alreadyDone: result.alreadyDone,
  });
}
