/**
 * POST /api/tools/check-form-status
 *
 * Vapi tool: the voice agent calls this to find out whether the customer has
 * submitted the intake form yet.  The agent uses the result to decide whether
 * to proceed to pricing / payment or to ask the customer to check their phone.
 *
 * Request body (one of):
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
import { badRequest, parseBody, serverError } from "../_lib";
import { NextResponse } from "next/server";

type RequestBody = {
  sessionId?: string;
  jobId?: string;
};

type SessionRow = {
  intake_form_completed_at: string | null;
  job_id: string | null;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);

  if (!body?.sessionId && !body?.jobId) {
    return badRequest("Request body must include sessionId or jobId.");
  }

  const supabase = createSupabaseServiceClient();

  let sessionRow: SessionRow | null = null;

  if (body.sessionId) {
    const { data, error } = await supabase
      .from("call_sessions")
      .select("intake_form_completed_at, job_id")
      .eq("id", body.sessionId)
      .single();

    if (error || !data) {
      return serverError(`Call session not found: ${body.sessionId}`);
    }
    sessionRow = data as SessionRow;
  } else if (body.jobId) {
    // Find the call session linked to this job
    const { data, error } = await supabase
      .from("call_sessions")
      .select("intake_form_completed_at, job_id")
      .eq("job_id", body.jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return serverError(`Failed to look up call session for job: ${error.message}`);
    }
    sessionRow = (data as SessionRow | null) ?? null;
  }

  const completedAt = sessionRow?.intake_form_completed_at ?? null;
  const jobId = sessionRow?.job_id ?? body.jobId ?? null;

  // Optionally fetch current job status so the agent can see the full picture
  let jobStatus: string | null = null;
  if (jobId) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    jobStatus = (jobRow as { status: string } | null)?.status ?? null;
  }

  return NextResponse.json({
    success: true,
    completed: completedAt != null,
    completedAt,
    jobStatus,
  });
}
