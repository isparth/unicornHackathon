/**
 * POST /api/tools/summarise-call
 *
 * Vapi tool: trigger the Call Summary Service for a call session.
 * The agent calls this after the call transcript is available (typically
 * after the call ends or when Vapi delivers a transcript webhook).
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
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
import { badRequest, logToolCall, parseVapiBody } from "../_lib";
import { NextResponse } from "next/server";

type Args = { sessionId?: string };

export async function POST(req: Request): Promise<NextResponse> {
  const { args, callId } = await parseVapiBody<Args>(req);

  if (!args.sessionId) {
    return badRequest("Request body must include sessionId.");
  }

  const t0 = Date.now();
  const result = await generateCallSummary(args.sessionId);
  const durationMs = Date.now() - t0;

  void logToolCall({
    toolName: "summarise-call",
    callId,
    sessionId: args.sessionId,
    args: { sessionId: args.sessionId },
    result: result as Record<string, unknown>,
    success: result.success,
    durationMs,
  });

  if (!result.success) {
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
