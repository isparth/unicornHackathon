/**
 * GET /api/activity
 *
 * Returns recent tool_call_logs rows for the activity page.
 * Supports:
 *   ?limit=N     — max rows to return (default 50, max 200)
 *   ?since=<iso> — only return rows created after this timestamp
 *   ?callId=<id> — filter to a specific Vapi call
 *   ?jobId=<id>  — filter to a specific job
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { NextResponse } from "next/server";

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(isNaN(rawLimit) ? 50 : rawLimit, 200);
  const since = searchParams.get("since");
  const callId = searchParams.get("callId");
  const jobId = searchParams.get("jobId");

  const supabase = createSupabaseServiceClient();

  let query = supabase
    .from("tool_call_logs")
    .select("id, tool_name, call_id, job_id, session_id, args, result, success, duration_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (since) query = query.gt("created_at", since);
  if (callId) query = query.eq("call_id", callId);
  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    logs: (data ?? []).reverse(), // oldest first for display
    fetchedAt: new Date().toISOString(),
  });
}
