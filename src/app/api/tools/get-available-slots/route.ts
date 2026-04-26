/**
 * POST /api/tools/get-available-slots
 *
 * Vapi tool: fetch bookable slots for a job.  The agent reads the first few
 * slots to the customer and asks them to pick one.
 *
 * Accepts jobId or sessionId (resolved to jobId automatically).
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
 *   {
 *     jobId?:     string
 *     sessionId?: string
 *     maxSlots?:  number   — cap the number of slots returned (default 5)
 *   }
 *
 * Response (success):
 *   {
 *     success: true
 *     slots: Array<{
 *       workerId:    string
 *       workerName:  string
 *       startsAt:    string  (ISO)
 *       endsAt:      string  (ISO)
 *     }>
 *   }
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { getAvailableSlots } from "@/server/services/scheduling-service";
import { badRequest, logToolCall, parseVapiBody, vapiOk, vapiError } from "../_lib";
import { NextResponse } from "next/server";

type Args = { jobId?: string; sessionId?: string; maxSlots?: number };

async function resolveJobId(args: Args): Promise<{ jobId: string } | { error: NextResponse }> {
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
          { success: false, error: "not_found", message: `Call session has no linked job.` },
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
  const result = await getAvailableSlots(resolved.jobId);
  const durationMs = Date.now() - t0;

  if (!result.success) {
    void logToolCall({
      toolName: "get-available-slots",
      callId,
      jobId: resolved.jobId,
      args: args as Record<string, unknown>,
      result: result as Record<string, unknown>,
      success: false,
      durationMs,
    });
    return vapiError(toolCallId, result.message || "Failed to get available slots");
  }

  const maxSlots = typeof args.maxSlots === "number" && args.maxSlots > 0 ? args.maxSlots : 5;
  const slots = result.slots.slice(0, maxSlots).map((s) => ({
    workerId: s.workerId,
    workerName: s.workerName,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
  }));

  void logToolCall({
    toolName: "get-available-slots",
    callId,
    jobId: resolved.jobId,
    args: args as Record<string, unknown>,
    result: { success: true, slotsReturned: slots.length },
    success: true,
    durationMs,
  });

  return vapiOk(toolCallId, { success: true, slots });
}
