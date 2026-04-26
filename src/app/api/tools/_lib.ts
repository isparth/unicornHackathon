/**
 * Shared helpers for the /api/tools/* Vapi tool-call route handlers.
 *
 * ## Vapi response format (CRITICAL)
 *
 * Vapi server tools expect this exact JSON structure — always HTTP 200:
 *
 *   {
 *     "results": [
 *       {
 *         "toolCallId": "<id from request toolCallList[0].id>",
 *         "result": "<single-line string — JSON.stringify your payload>"
 *       }
 *     ]
 *   }
 *
 * For errors, replace "result" with "error":
 *   { "results": [{ "toolCallId": "...", "error": "Error message string" }] }
 *
 * Do NOT return arbitrary JSON objects directly — Vapi will show
 * "No result returned" and the LLM won't receive the data.
 *
 * Use vapiOk() / vapiError() to produce the correct wrapper automatically.
 *
 * Vapi request body shape (server tool call):
 *   {
 *     message: {
 *       type: "tool-calls",
 *       call: { id: "...", customer: { number: "..." } },
 *       toolCallList: [{
 *         id: "tc_...",          ← this is toolCallId — must echo it back
 *         function: { name: "...", arguments: "{...}" }  ← JSON string or object
 *       }]
 *     }
 *   }
 *
 * parseVapiBody() unwraps this and returns args, callId, phoneNumber, toolCallId.
 */

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/server/supabase/client";

export type ToolErrorCode =
  | "bad_request"
  | "server_error";

// ─── Vapi body shape ─────────────────────────────────────────────────────────

type VapiToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown; // JSON string OR plain object
  };
};

type VapiRawBody = {
  message?: {
    call?: { id?: string; customer?: { number?: string } };
    toolCallList?: VapiToolCall[];
    toolWithToolCallList?: Array<{ name?: string; toolCall?: VapiToolCall }>;
  };
};

export type ParsedVapiBody<T> = {
  /** Unwrapped tool arguments — never null, defaults to {} */
  args: T;
  /** Vapi call ID from server-injected context (message.call.id) */
  callId: string;
  /** Caller's phone number in E.164 format */
  phoneNumber: string;
  /** Tool call ID from the toolCallList entry — must be echoed back in the response */
  toolCallId: string;
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

/**
 * Parse the request body as JSON.  Returns null if parsing fails (no body /
 * content-type mismatch / malformed JSON).
 */
export async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * parseVapiBody — reads and unwraps a Vapi server tool-call request.
 *
 * Vapi wraps the LLM's function arguments inside:
 *   body.message.toolCallList[0].function.arguments
 *
 * This helper extracts:
 *   - args: the tool's own parameters (unwrapped and JSON-parsed)
 *   - callId: from body.message.call.id
 *   - phoneNumber: from body.message.call.customer.number
 *
 * Falls back gracefully so callers can handle missing values themselves.
 */
export async function parseVapiBody<T extends Record<string, unknown>>(
  req: Request,
): Promise<ParsedVapiBody<T>> {
  const raw = await parseBody<VapiRawBody>(req);

  const msg = raw?.message;
  const callId = msg?.call?.id ?? "";
  const phoneNumber = msg?.call?.customer?.number ?? "";

  // Vapi may use toolCallList or toolWithToolCallList
  const toolCalls: VapiToolCall[] =
    msg?.toolCallList ??
    (msg?.toolWithToolCallList?.map((t) => t.toolCall).filter(Boolean) as VapiToolCall[]) ??
    [];

  const firstCall = toolCalls[0];
  const rawArgs = firstCall?.function?.arguments;
  const args = parseArguments(rawArgs) as T;
  // toolCallId must be echoed back in the results array so Vapi can match the response
  const toolCallId = firstCall?.id ?? "";

  return { args, callId, phoneNumber, toolCallId };
}

// ─── Tool call logging ────────────────────────────────────────────────────────

export type LogToolCallParams = {
  toolName: string;
  callId?: string;
  jobId?: string | null;
  sessionId?: string | null;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  success?: boolean;
  durationMs?: number;
};

/**
 * logToolCall — fire-and-forget write to tool_call_logs.
 * Never throws; errors are swallowed so they never affect the Vapi response.
 */
export async function logToolCall(params: LogToolCallParams): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("tool_call_logs").insert({
      tool_name: params.toolName,
      call_id: params.callId ?? null,
      job_id: params.jobId ?? null,
      session_id: params.sessionId ?? null,
      args: params.args ?? {},
      result: params.result ?? null,
      success: params.success ?? null,
      duration_ms: params.durationMs ?? null,
    });
  } catch (err) {
    console.error("[logToolCall] failed:", err);
  }
}

// ─── Vapi response helpers ────────────────────────────────────────────────────

/**
 * vapiOk — wrap a success payload in the format Vapi server tools require.
 *
 * Vapi expects:  { results: [{ toolCallId: "...", result: "<string>" }] }
 * The `result` field must be a single-line string; we JSON.stringify the payload.
 *
 * Always returns HTTP 200 — Vapi ignores non-200 responses entirely.
 */
export function vapiOk(toolCallId: string, payload: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    { results: [{ toolCallId, result: JSON.stringify(payload) }] },
    { status: 200 },
  );
}

/**
 * vapiError — wrap an error message in the Vapi results format.
 *
 * Uses the "error" key per Vapi's spec for tool failures.
 * Always HTTP 200 — Vapi discards non-200.
 */
export function vapiError(toolCallId: string, errorMessage: string): NextResponse {
  return NextResponse.json(
    { results: [{ toolCallId, error: errorMessage }] },
    { status: 200 },
  );
}

// ─── Legacy response helpers (used internally, not by Vapi) ──────────────────

/** Return a 400 JSON response with a clear error. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: "bad_request", message },
    { status: 400 },
  );
}

/** Return a 500 JSON response for unexpected server errors. */
export function serverError(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: "server_error", message },
    { status: 500 },
  );
}

/** Return a 200 JSON success response. */
export function ok(payload: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: true, ...payload }, { status: 200 });
}
