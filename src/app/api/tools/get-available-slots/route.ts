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
import { badRequest, parseVapiBody } from "../_lib";
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

  return { error: badRequest("Request body must include jobId or sessionId.") };
}

export async function POST(req: Request): Promise<NextResponse> {
  const { args } = await parseVapiBody<Args>(req);

  if (!args.jobId && !args.sessionId) {
    return badRequest("Request body must include jobId or sessionId.");
  }

  const resolved = await resolveJobId(args);
  if ("error" in resolved) return resolved.error;

  const result = await getAvailableSlots(resolved.jobId);

  if (!result.success) {
    const status = result.error === "job_not_found" ? 404 : result.error === "not_classified" ? 422 : 500;
    return NextResponse.json(
      { success: false, error: result.error, message: result.message },
      { status },
    );
  }

  const maxSlots = typeof args.maxSlots === "number" && args.maxSlots > 0 ? args.maxSlots : 5;
  const slots = result.slots.slice(0, maxSlots).map((s) => ({
    workerId: s.workerId,
    workerName: s.workerName,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
  }));

  return NextResponse.json({ success: true, slots });
}
