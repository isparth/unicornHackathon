/**
 * POST /api/tools/price-job
 *
 * Vapi tool: run the Pricing Service for a job and get back the price
 * estimate the agent should read to the customer.
 *
 * Accepts either jobId or sessionId — sessionId is resolved to the linked job.
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
 *   {
 *     jobId?:     string   — jobs.id
 *     sessionId?: string   — call_sessions.id (alternative to jobId)
 *   }
 *
 * Response (success):
 *   {
 *     success:                true
 *     calloutFeePence:        number
 *     repairEstimateMinPence: number
 *     repairEstimateMaxPence: number
 *     currency:               string
 *     explanation:            string   — read this to the customer verbatim
 *     alreadyDone:            boolean
 *   }
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { priceJob } from "@/server/services/pricing-service";
import { badRequest, logToolCall, parseVapiBody, vapiOk, vapiError } from "../_lib";
import { NextResponse } from "next/server";

type Args = { jobId?: string; sessionId?: string };

async function resolveJobId(
  args: Args,
): Promise<{ jobId: string } | { error: NextResponse }> {
  if (args.jobId) return { jobId: args.jobId };

  if (args.sessionId) {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("call_sessions")
      .select("job_id")
      .eq("id", args.sessionId)
      .single();

    if (error || !data) {
      return {
        error: NextResponse.json(
          { success: false, error: "not_found", message: `Call session not found: ${args.sessionId}` },
          { status: 404 },
        ),
      };
    }

    const jobId = (data as { job_id: string | null }).job_id;
    if (!jobId) {
      return {
        error: NextResponse.json(
          { success: false, error: "not_found", message: `Call session ${args.sessionId} has no linked job yet.` },
          { status: 422 },
        ),
      };
    }

    return { jobId };
  }

  return {
    error: NextResponse.json(
      { success: false, error: "bad_request", message: "Request body must include jobId or sessionId." },
      { status: 400 },
    ),
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const { args, callId, toolCallId } = await parseVapiBody<Args>(req);

  if (!args.jobId && !args.sessionId) {
    return vapiError(toolCallId, "Request body must include jobId or sessionId.");
  }

  const resolved = await resolveJobId(args);
  if ("error" in resolved) return resolved.error;

  const t0 = Date.now();
  const result = await priceJob(resolved.jobId);
  const durationMs = Date.now() - t0;

  void logToolCall({
    toolName: "price-job",
    callId,
    jobId: resolved.jobId,
    args: args as Record<string, unknown>,
    result: result as Record<string, unknown>,
    success: result.success,
    durationMs,
  });

  if (!result.success) {
    return vapiError(toolCallId, result.message || "Pricing failed");
  }

  const { estimate } = result;
  return vapiOk(toolCallId, {
    success: true,
    calloutFeePence: estimate.calloutFeePence,
    repairEstimateMinPence: estimate.repairEstimateMinPence,
    repairEstimateMaxPence: estimate.repairEstimateMaxPence,
    currency: estimate.currency,
    explanation: estimate.explanation,
    alreadyDone: result.alreadyDone,
  });
}
