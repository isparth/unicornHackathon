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

  // Look up the session → customer to get the phone number
  // call_sessions has no phone_number column; it's on customers
  const supabase = createSupabaseServiceClient();
  const { data: session } = await supabase
    .from("call_sessions")
    .select("job_id, customer_id, customers(phone_number)")
    .eq("id", args.sessionId)
    .single();

  type SessionRow = { job_id: string | null; customer_id: string | null; customers: { phone_number: string } | null };
  const sessionRow = session as SessionRow | null;
  const phoneNumber = sessionRow?.customers?.phone_number ?? null;

  // Resend the WhatsApp with the fresh link (fire-and-forget, never throws)
  let smsSent = false;
  if (phoneNumber) {
    const smsResult = await smsService.sendIntakeFormLink({
      to: phoneNumber,
      callSessionId: args.sessionId,
      jobId: sessionRow?.job_id ?? null,
      customerName: null,
      intakeFormUrl,
    });
    smsSent = smsResult.success;
    if (!smsResult.success) {
      console.error("[generate-intake-token] WhatsApp resend failed:", smsResult.error);
    }
  } else {
    console.warn("[generate-intake-token] No phone_number found for session, skipping WhatsApp resend");
  }

  return NextResponse.json({
    success: true,
    intakeFormUrl,
    expiresAt: tokenResult.expiresAt.toISOString(),
    smsSent,
  });
}
