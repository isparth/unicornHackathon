/**
 * POST /api/tools/check-form-status
 *
 * Vapi tool: the voice agent calls this to find out whether the customer has
 * submitted the intake form yet.  The agent uses the result to decide whether
 * to proceed to pricing / payment or to ask the customer to check their phone.
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
 *   { sessionId: string }   — look up by call session
 *   { jobId: string }       — look up by job (agent may only have the jobId)
 *
 * Response (success):
 *   {
 *     success:      true
 *     completed:    boolean         — true when form has been submitted
 *     completedAt:  string | null   — ISO timestamp of submission, or null
 *     jobStatus:    string | null   — current job.status (null if job not yet created)
 *   }
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { badRequest, logToolCall, parseVapiBody, serverError } from "../_lib";
import { NextResponse } from "next/server";

type Args = { sessionId?: string; jobId?: string };

type SessionRow = {
  intake_form_completed_at: string | null;
  job_id: string | null;
};

export async function POST(req: Request): Promise<NextResponse> {
  const { args, callId } = await parseVapiBody<Args>(req);

  if (!args.sessionId && !args.jobId) {
    return badRequest("Request body must include sessionId or jobId.");
  }

  const supabase = createSupabaseServiceClient();

  let sessionRow: SessionRow | null = null;

  if (args.sessionId) {
    const { data, error } = await supabase
      .from("call_sessions")
      .select("intake_form_completed_at, job_id")
      .eq("id", args.sessionId)
      .single();

    if (error || !data) {
      return serverError(`Call session not found: ${args.sessionId}`);
    }
    sessionRow = data as SessionRow;
  } else if (args.jobId) {
    const { data, error } = await supabase
      .from("call_sessions")
      .select("intake_form_completed_at, job_id")
      .eq("job_id", args.jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return serverError(`Failed to look up call session for job: ${error.message}`);
    }
    sessionRow = (data as SessionRow | null) ?? null;
  }

  const completedAt = sessionRow?.intake_form_completed_at ?? null;
  const jobId = sessionRow?.job_id ?? args.jobId ?? null;

  let jobStatus: string | null = null;
  if (jobId) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    jobStatus = (jobRow as { status: string } | null)?.status ?? null;
  }

  const payload = {
    success: true,
    completed: completedAt != null,
    completedAt,
    jobStatus,
  };

  void logToolCall({
    toolName: "check-form-status",
    callId,
    jobId: jobId ?? null,
    args: args as Record<string, unknown>,
    result: payload,
    success: true,
  });

  return NextResponse.json(payload);
}
