/**
 * POST /api/tools/price-job
 *
 * Vapi tool: run the Pricing Service for a job and get back the price
 * estimate the agent should read to the customer.
 *
 * Accepts either jobId or sessionId — sessionId is resolved to the linked job.
 *
 * Request body:
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
import { badRequest, parseBody } from "../_lib";
import { NextResponse } from "next/server";

type RequestBody = {
  jobId?: string;
  sessionId?: string;
};

async function resolveJobId(
  body: RequestBody,
): Promise<{ jobId: string } | { error: NextResponse }> {
  if (body.jobId) return { jobId: body.jobId };

  if (body.sessionId) {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("call_sessions")
      .select("job_id")
      .eq("id", body.sessionId)
      .single();

    if (error || !data) {
      return {
        error: NextResponse.json(
          { success: false, error: "not_found", message: `Call session not found: ${body.sessionId}` },
          { status: 404 },
        ),
      };
    }

    const jobId = (data as { job_id: string | null }).job_id;
    if (!jobId) {
      return {
        error: NextResponse.json(
          { success: false, error: "not_found", message: `Call session ${body.sessionId} has no linked job yet.` },
          { status: 422 },
        ),
      };
    }

    return { jobId };
  }

  return {
    error: badRequest("Request body must include jobId or sessionId."),
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);
  if (!body) return badRequest("Request body must include jobId or sessionId.");

  const resolved = await resolveJobId(body);
  if ("error" in resolved) return resolved.error;

  const result = await priceJob(resolved.jobId);

  if (!result.success) {
    const status =
      result.error === "not_found" ? 404
      : result.error === "not_classified" ? 422
      : 500;

    return NextResponse.json(
      { success: false, error: result.error, message: result.message },
      { status },
    );
  }

  const { estimate } = result;
  return NextResponse.json({
    success: true,
    calloutFeePence: estimate.calloutFeePence,
    repairEstimateMinPence: estimate.repairEstimateMinPence,
    repairEstimateMaxPence: estimate.repairEstimateMaxPence,
    currency: estimate.currency,
    explanation: estimate.explanation,
    alreadyDone: result.alreadyDone,
  });
}
