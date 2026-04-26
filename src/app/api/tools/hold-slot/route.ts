/**
 * POST /api/tools/hold-slot
 *
 * Vapi tool: reserve a specific slot for a job.  The agent calls this once
 * the customer has chosen a time.
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
 *   {
 *     jobId:     string   — jobs.id
 *     workerId:  string   — workers.id
 *     startsAt:  string   — ISO timestamp
 *     endsAt:    string   — ISO timestamp
 *   }
 *
 * Response (success):
 *   {
 *     success:       true
 *     reservationId: string
 *     expiresAt:     string  (ISO) — when the hold expires if not paid
 *     alreadyDone:   boolean
 *   }
 */

import { createReservation } from "@/server/services/reservation-service";
import { badRequest, logToolCall, parseVapiBody, vapiOk, vapiError } from "../_lib";
import { NextResponse } from "next/server";

type Args = { jobId?: string; workerId?: string; startsAt?: string; endsAt?: string };

export async function POST(req: Request): Promise<NextResponse> {
  const { args, callId, toolCallId } = await parseVapiBody<Args>(req);

  if (!args.jobId || !args.workerId || !args.startsAt || !args.endsAt) {
    return vapiError(toolCallId, "Request body must include jobId, workerId, startsAt, and endsAt.");
  }

  const startsAt = new Date(args.startsAt);
  const endsAt = new Date(args.endsAt);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return vapiError(toolCallId, "startsAt and endsAt must be valid ISO timestamps.");
  }

  if (endsAt <= startsAt) {
    return vapiError(toolCallId, "endsAt must be after startsAt.");
  }

  const t0 = Date.now();
  const result = await createReservation(args.jobId, args.workerId, startsAt, endsAt);
  const durationMs = Date.now() - t0;

  void logToolCall({
    toolName: "hold-slot",
    callId,
    jobId: args.jobId,
    args: args as Record<string, unknown>,
    result: result as Record<string, unknown>,
    success: result.success,
    durationMs,
  });

  if (!result.success) {
    return vapiError(toolCallId, result.message || "Failed to hold slot");
  }

  return vapiOk(toolCallId, {
    success: true,
    reservationId: result.reservation.id,
    expiresAt: result.reservation.expiresAt,
    alreadyDone: result.alreadyDone,
  });
}
