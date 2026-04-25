/**
 * POST /api/webhooks/vapi
 *
 * Receives all server-side events from Vapi and routes them to the appropriate
 * business logic handler.
 *
 * Security:
 *   Vapi can be configured to send an Authorization header using the Bearer
 *   Token credential type (or the legacy X-Vapi-Secret header).  We validate
 *   against VAPI_WEBHOOK_SECRET.  Requests with an invalid or missing token
 *   are rejected with 401.
 *
 *   If VAPI_WEBHOOK_SECRET is not set (e.g. local dev without auth), we skip
 *   the check and log a warning.  This matches how Stripe's webhook middleware
 *   handles missing secrets in test environments.
 *
 * Events handled (all others are acknowledged with 200 and ignored):
 *   status-update         → call lifecycle (in-progress, ended, etc.)
 *   end-of-call-report    → transcript + call summary generation
 *   conversation-update   → live transcript updates
 *   tool-calls            → synchronous tool dispatch (returns results array)
 *
 * Response contract:
 *   - All informational events: 200 { received: true }
 *   - Tool-calls:               200 { results: [...] }   (Vapi reads this)
 *   - Auth failure:             401 { error: "..." }
 *   - Malformed body:           400 { error: "..." }
 *
 * Vapi requires a 2xx response for all events (even unknown ones) to prevent
 * retries.  We always return 200 unless auth fails.
 */

import { NextResponse } from "next/server";
import { appConfig } from "@/config/app-config";
import {
  handleVapiMessage,
  type VapiWebhookBody,
  type VapiMessage,
} from "@/server/services/vapi-webhook-service";

export const dynamic = "force-dynamic";

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Validate the incoming request against VAPI_WEBHOOK_SECRET.
 *
 * Vapi supports two header conventions:
 *   1. Authorization: Bearer <secret>   (credential-based, recommended)
 *   2. X-Vapi-Secret: <secret>          (legacy inline secret)
 *
 * We accept both.  Returns true if auth passes (or if secret is not set).
 */
function isAuthorized(req: Request): boolean {
  const secret = appConfig.serviceCredentials.vapi.webhookSecret;

  if (!secret) {
    // No secret configured — allow through but warn so it's visible in logs
    console.warn("[vapi-webhook] VAPI_WEBHOOK_SECRET is not set — accepting request without auth");
    return true;
  }

  // Check Authorization: Bearer <secret>
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token === secret) return true;
  }

  // Check X-Vapi-Secret: <secret>  (legacy)
  const vapiSecretHeader = req.headers.get("x-vapi-secret") ?? "";
  if (vapiSecretHeader === secret) return true;

  return false;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Auth check
  if (!isAuthorized(req)) {
    console.warn("[vapi-webhook] Unauthorised request rejected");
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // 2. Parse body
  let body: VapiWebhookBody;
  try {
    const text = await req.text();
    if (!text) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }
    body = JSON.parse(text) as VapiWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body?.message as VapiMessage | undefined;
  if (!message?.type) {
    return NextResponse.json({ error: "Missing message.type" }, { status: 400 });
  }

  console.log(`[vapi-webhook] Received event: ${message.type}`);

  // 3. Dispatch to service layer
  try {
    const outcome = await handleVapiMessage(message);

    switch (outcome.type) {
      case "tool-calls": {
        // Vapi expects { results: [...] } for tool-calls
        const { result } = outcome;
        if (!result.success) {
          console.error("[vapi-webhook] tool-calls dispatch error:", result.message);
          // Still return a results array (with error payload) so Vapi doesn't stall
          return NextResponse.json({ results: [] }, { status: 200 });
        }
        return NextResponse.json({ results: result.results }, { status: 200 });
      }

      case "event": {
        if (!outcome.result.success) {
          console.warn("[vapi-webhook] event handler issue:", outcome.result.message);
          // Non-fatal: still return 200 so Vapi doesn't retry
        }
        return NextResponse.json({ received: true }, { status: 200 });
      }

      case "ignored":
      default:
        return NextResponse.json({ received: true }, { status: 200 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[vapi-webhook] Unhandled error:", message);
    // Still 200 — Vapi must not retry
    return NextResponse.json({ received: true }, { status: 200 });
  }
}
