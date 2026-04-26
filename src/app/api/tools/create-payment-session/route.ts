/**
 * POST /api/tools/create-payment-session
 *
 * Vapi tool: create a Stripe Checkout Session for a job and return the
 * payment URL so the voice agent can send it to the customer via SMS.
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
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
import { badRequest, logToolCall, parseVapiBody, vapiOk, vapiError } from "../_lib";

type Args = { jobId?: string };

export async function POST(req: Request): Promise<NextResponse> {
  const { args, callId, toolCallId } = await parseVapiBody<Args>(req);

  if (!args.jobId?.trim()) {
    return vapiError(toolCallId, "Request body must include jobId.");
  }

  const t0 = Date.now();
  const result = await createPaymentSession(args.jobId);
  const durationMs = Date.now() - t0;

  void logToolCall({
    toolName: "create-payment-session",
    callId,
    jobId: args.jobId,
    args: args as Record<string, unknown>,
    result: result as Record<string, unknown>,
    success: result.success,
    durationMs,
  });

  if (!result.success) {
    return vapiError(toolCallId, result.message || "Payment session creation failed");
  }

  return vapiOk(toolCallId, {
    success: true,
    jobId: result.jobId,
    paymentId: result.paymentId,
    paymentUrl: result.paymentUrl,
    amountPence: result.amountPence,
    currency: result.currency,
    alreadyDone: result.alreadyDone,
  });
}
