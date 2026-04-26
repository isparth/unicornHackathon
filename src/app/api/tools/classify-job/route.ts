/**
 * POST /api/tools/classify-job
 *
 * Vapi tool: run the Classification Service for a job.
 * The agent calls this after the call summary is written.
 *
 * Accepts either a jobId directly, or a sessionId — if a sessionId is given
 * the handler resolves it to the linked job automatically, so the agent only
 * needs to track one identifier during a call.
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
 *   {
 *     jobId?:     string   — jobs.id
 *     sessionId?: string   — call_sessions.id (alternative to jobId)
 *   }
 *
 * Response (success):
 *   {
 *     success:        true
 *     requiredSkill:  "plumbing" | "heating" | "electrical"
 *     urgency:        "emergency" | "same_day" | "scheduled"
 *     jobCategory:    string
 *     alreadyDone:    boolean
 *   }
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { classifyJob } from "@/server/services/classification-service";
import { badRequest, parseVapiBody } from "../_lib";
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
    error: badRequest("Request body must include jobId or sessionId."),
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const { args } = await parseVapiBody<Args>(req);

  if (!args.jobId && !args.sessionId) {
    return badRequest("Request body must include jobId or sessionId.");
  }

  const resolved = await resolveJobId(args);
  if ("error" in resolved) return resolved.error;

  const result = await classifyJob(resolved.jobId);

  if (!result.success) {
    const status =
      result.error === "not_found" ? 404
      : result.error === "no_summary" ? 422
      : result.error === "invalid_output" ? 422
      : 500;

    return NextResponse.json(
      { success: false, error: result.error, message: result.message },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    requiredSkill: result.classification.requiredSkill,
    urgency: result.classification.urgency,
    jobCategory: result.classification.jobCategory,
    alreadyDone: result.alreadyDone,
  });
}
