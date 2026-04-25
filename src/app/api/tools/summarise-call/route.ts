/**
 * POST /api/tools/summarise-call
 *
 * Vapi tool: trigger the Call Summary Service for a call session.
 * The agent calls this after the call transcript is available (typically
 * after the call ends or when Vapi delivers a transcript webhook).
 *
 * Request body:
 *   {
 *     sessionId: string   — call_sessions.id
 *   }
 *
 * Response (success):
 *   {
 *     success:     true
 *     summary:     string    — the generated problem_summary
 *     alreadyDone: boolean   — true if the summary already existed
 *   }
 *
 * Response (failure):
 *   {
 *     success: false
 *     error:   "bad_request" | "no_transcript" | "transcript_too_short" | ...
 *     message: string
 *   }
 */

import { generateCallSummary } from "@/server/services/call-summary-service";
import { badRequest, parseBody } from "../_lib";
import { NextResponse } from "next/server";

type RequestBody = {
  sessionId: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);

  if (!body?.sessionId) {
    return badRequest("Request body must include sessionId.");
  }

  const result = await generateCallSummary(body.sessionId);

  if (!result.success) {
    // Map service errors to appropriate HTTP status codes
    const status =
      result.error === "not_found" ? 404
      : result.error === "no_transcript" || result.error === "transcript_too_short" ? 422
      : 500;

    return NextResponse.json(
      { success: false, error: result.error, message: result.message },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    summary: result.summary,
    alreadyDone: result.alreadyDone,
  });
}
