/**
 * Shared helpers for the /api/tools/* Vapi tool-call route handlers.
 *
 * All tool routes follow the same pattern:
 *   - Accept POST with JSON body
 *   - Validate required fields
 *   - Call the relevant service function
 *   - Return JSON { success, ...payload } or { success: false, error, message }
 *
 * Vapi expects the response body to be JSON that the assistant can read and
 * incorporate into its next turn.  A non-2xx status signals a hard failure.
 */

import { NextResponse } from "next/server";

export type ToolErrorCode =
  | "bad_request"
  | "server_error";

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
