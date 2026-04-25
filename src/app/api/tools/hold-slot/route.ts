/**
 * POST /api/tools/hold-slot
 *
 * Vapi tool: reserve a specific slot for a job.  The agent calls this once
 * the customer has chosen a time.
 *
 * Request body:
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
import { badRequest, parseBody } from "../_lib";
import { NextResponse } from "next/server";

type RequestBody = {
  jobId: string;
  workerId: string;
  startsAt: string;
  endsAt: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);

  if (!body?.jobId || !body?.workerId || !body?.startsAt || !body?.endsAt) {
    return badRequest("Request body must include jobId, workerId, startsAt, and endsAt.");
  }

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return badRequest("startsAt and endsAt must be valid ISO timestamps.");
  }

  if (endsAt <= startsAt) {
    return badRequest("endsAt must be after startsAt.");
  }

  const result = await createReservation(body.jobId, body.workerId, startsAt, endsAt);

  if (!result.success) {
    const status =
      result.error === "job_not_found" || result.error === "worker_not_found" ? 404
      : result.error === "invalid_job_state" || result.error === "worker_inactive" ? 422
      : result.error === "overlap_conflict" ? 409
      : 500;

    return NextResponse.json(
      { success: false, error: result.error, message: result.message },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    reservationId: result.reservation.id,
    expiresAt: result.reservation.expiresAt,
    alreadyDone: result.alreadyDone,
  });
}
