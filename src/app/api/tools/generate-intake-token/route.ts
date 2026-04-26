/**
 * POST /api/tools/generate-intake-token
 *
 * Vapi tool: (re-)issue a signed intake form token for an existing call
 * session and resend the WhatsApp link to the customer.
 * Useful if the customer loses the message or needs a fresh link.
 *
 * Request body (Vapi server tool call — arguments unwrapped from message.toolCallList):
 *   {
 *     sessionId: string   — call_sessions.id
 *   }
 *
 * Response (success):
 *   {
 *     success:        true
 *     intakeFormUrl:  string   — full URL sent to customer
 *     expiresAt:      string   — ISO timestamp
 *     smsSent:        boolean  — whether the WhatsApp resend succeeded
 *   }
 */

import { issueIntakeFormToken } from "@/server/services/call-session-service";
import { smsService } from "@/server/services/sms-service";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import { badRequest, parseVapiBody, serverError } from "../_lib";
import { NextResponse } from "next/server";

type Args = { sessionId?: string };

export async function POST(req: Request): Promise<NextResponse> {
  const { args } = await parseVapiBody<Args>(req);

  if (!args.sessionId) {
    return badRequest("Request body must include sessionId.");
  }

  // Issue a fresh token
  let tokenResult: { token: string; expiresAt: Date };
  try {
    tokenResult = await issueIntakeFormToken(args.sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return serverError(`Failed to issue intake form token: ${message}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const intakeFormUrl = `${baseUrl}/intake/${tokenResult.token}`;

  // Look up the session to get the customer's phone number
  const supabase = createSupabaseServiceClient();
  const { data: session } = await supabase
    .from("call_sessions")
    .select("phone_number, job_id")
    .eq("id", args.sessionId)
    .single();

  // Resend the WhatsApp with the fresh link (fire-and-forget, never throws)
  let smsSent = false;
  if (session?.phone_number) {
    const smsResult = await smsService.sendIntakeFormLink({
      to: session.phone_number,
      callSessionId: args.sessionId,
      jobId: (session as { job_id?: string | null }).job_id ?? null,
      customerName: null,
      intakeFormUrl,
    });
    smsSent = smsResult.success;
    if (!smsResult.success) {
      console.error("[generate-intake-token] WhatsApp resend failed:", smsResult.error);
    }
  } else {
    console.warn("[generate-intake-token] No phone_number on session, skipping WhatsApp resend");
  }

  return NextResponse.json({
    success: true,
    intakeFormUrl,
    expiresAt: tokenResult.expiresAt.toISOString(),
    smsSent,
  });
}
