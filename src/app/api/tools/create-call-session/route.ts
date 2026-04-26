/**
 * POST /api/tools/create-call-session
 *
 * Vapi HTTP tool called at the very start of an inbound call.
 *
 * Vapi wraps the real call object alongside the LLM-provided tool arguments.
 * We always read vapiCallId and phoneNumber from `message.call` (server-injected
 * call context) so the LLM never has to supply or guess them.
 *
 * Vapi sends `function.arguments` as a JSON *string* in tool-call server
 * requests, so we parse it defensively.
 *
 * Expected body shape (Vapi server tool call):
 *   {
 *     message: {
 *       type: "tool-calls",
 *       call: { id: "<call-id>", customer: { number: "<e164>" } },
 *       toolCallList: [{
 *         id: "tc_...",
 *         function: {
 *           name: "create-call-session",
 *           arguments: "{\"serviceBusinessId\":\"...\"}"   ← JSON string
 *         }
 *       }]
 *     }
 *   }
 *
 * Response (success):
 *   { success: true, sessionId, jobId, intakeFormUrl, tokenExpiresAt }
 */

import { createCallSessionFromVapi } from "@/server/services/vapi-call-session";
import { badRequest, parseBody } from "../_lib";
import { appConfig } from "@/config/app-config";
import { NextResponse } from "next/server";

type VapiToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown; // string (JSON) or object
  };
};

type VapiBody = {
  message?: {
    call?: { id?: string; customer?: { number?: string } };
    toolCallList?: VapiToolCall[];
    // some Vapi versions use toolWithToolCallList
    toolWithToolCallList?: Array<{ name?: string; toolCall?: VapiToolCall }>;
  };
  // flat fallback fields (tests / direct calls)
  vapiCallId?: string;
  serviceBusinessId?: string;
  phoneNumber?: string;
};

/** Parse function.arguments whether it arrives as a JSON string or plain object. */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<VapiBody>(req);

  // Log the raw body so we can inspect it in Vercel logs during debugging
  console.log("[create-call-session] raw body:", JSON.stringify(body));

  const msg = body?.message;

  // vapiCallId and phoneNumber come from the server-injected call object — never from the LLM
  const vapiCallId = msg?.call?.id ?? body?.vapiCallId ?? "";
  const phoneNumber = msg?.call?.customer?.number ?? body?.phoneNumber ?? "";

  // Parse LLM-supplied arguments (may be a JSON string)
  const toolCalls = msg?.toolCallList ?? msg?.toolWithToolCallList?.map((t) => t.toolCall) ?? [];
  const args = parseArguments(toolCalls[0]?.function?.arguments);

  // serviceBusinessId falls back to the configured default — never blocks the call
  const serviceBusinessId =
    (args.serviceBusinessId as string | undefined) ??
    body?.serviceBusinessId ??
    appConfig.defaultBusinessId;

  console.log("[create-call-session] extracted:", { vapiCallId, phoneNumber, serviceBusinessId });

  if (!vapiCallId || !phoneNumber) {
    console.error("[create-call-session] missing call context — vapiCallId or phoneNumber empty");
    return badRequest(
      `Missing call context from Vapi. vapiCallId="${vapiCallId}" phoneNumber="${phoneNumber}"`,
    );
  }

  const result = await createCallSessionFromVapi({
    vapiCallId,
    serviceBusinessId,
    phoneNumber,
  });

  console.log("[create-call-session] result:", JSON.stringify(result));

  if (!result.success) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
