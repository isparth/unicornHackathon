/**
 * POST /api/tools/generate-intake-token
 *
 * Vapi tool: (re-)issue a signed intake form token for an existing call
 * session.  Useful if the customer loses the SMS or needs a fresh link.
 *
 * Request body:
 *   {
 *     sessionId: string   — call_sessions.id
 *   }
 *
 * Response (success):
 *   {
 *     success:        true
 *     token:          string   — the raw signed token
 *     intakeFormUrl:  string   — full URL to send by SMS
 *     expiresAt:      string   — ISO timestamp
 *   }
 */

import { issueIntakeFormToken } from "@/server/services/call-session-service";
import { badRequest, parseBody, serverError } from "../_lib";
import { NextResponse } from "next/server";

type RequestBody = {
  sessionId: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);

  if (!body?.sessionId) {
    return badRequest("Request body must include sessionId.");
  }

  let tokenResult: { token: string; expiresAt: Date };
  try {
    tokenResult = await issueIntakeFormToken(body.sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return serverError(`Failed to issue intake form token: ${message}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const intakeFormUrl = `${baseUrl}/intake/${tokenResult.token}`;

  return NextResponse.json({
    success: true,
    token: tokenResult.token,
    intakeFormUrl,
    expiresAt: tokenResult.expiresAt.toISOString(),
  });
}
