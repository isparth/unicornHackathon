/**
 * POST /api/tools/create-call-session
 *
 * Vapi HTTP tool called at the very start of an inbound call.
 *
 * Vapi sends a `message` wrapper containing the raw call object alongside the
 * LLM-provided tool arguments.  We extract `vapiCallId` and `phoneNumber`
 * directly from the call context so the LLM never has to hallucinate or
 * pass placeholder values.
 *
 * Expected Vapi request shape:
 *   {
 *     message: {
 *       call: { id: "<real-call-id>", customer: { number: "<e164>" } }
 *       toolCallList: [{ function: { arguments: { serviceBusinessId: "..." } } }]
 *     }
 *   }
 *
 * Also accepts a flat body for internal tests / backwards-compat:
 *   { vapiCallId, serviceBusinessId, phoneNumber }
 *
 * Response (success):
 *   {
 *     success:        true
 *     sessionId:      string
 *     jobId:          string | null
 *     intakeFormUrl:  string
 *     tokenExpiresAt: string   (ISO)
 *   }
 */

import { createCallSessionFromVapi } from "@/server/services/vapi-call-session";
import { badRequest, parseBody } from "../_lib";
import { appConfig } from "@/config/app-config";
import { NextResponse } from "next/server";

type VapiBody = {
  message?: {
    call?: { id?: string; customer?: { number?: string } };
    toolCallList?: Array<{ function?: { arguments?: Record<string, unknown> } }>;
  };
  // flat fallback fields (tests / direct calls)
  vapiCallId?: string;
  serviceBusinessId?: string;
  phoneNumber?: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<VapiBody>(req);

  // Pull context from Vapi's nested `message.call` when present; fall back to
  // flat fields so existing tests and direct callers still work.
  const msg = body?.message;

  const vapiCallId =
    msg?.call?.id ??
    body?.vapiCallId ??
    "";

  const phoneNumber =
    msg?.call?.customer?.number ??
    body?.phoneNumber ??
    "";

  // serviceBusinessId: try LLM arg first, then flat body, then env default.
  const serviceBusinessId =
    (msg?.toolCallList?.[0]?.function?.arguments?.serviceBusinessId as string | undefined) ??
    body?.serviceBusinessId ??
    appConfig.defaultBusinessId ??
    "";

  if (!vapiCallId || !phoneNumber) {
    return badRequest(
      `Missing required call context. vapiCallId="${vapiCallId}" phoneNumber="${phoneNumber}"`,
    );
  }

  if (!serviceBusinessId) {
    return badRequest("Missing serviceBusinessId and no default configured.");
  }

  const result = await createCallSessionFromVapi({
    vapiCallId,
    serviceBusinessId,
    phoneNumber,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
