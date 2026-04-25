/**
 * POST /api/tools/create-call-session
 *
 * Vapi tool: called at the very start of an inbound call to create a call
 * session record, issue an intake form token, and return the signed form URL.
 *
 * Request body:
 *   {
 *     vapiCallId:        string   — Vapi's unique call identifier
 *     serviceBusinessId: string   — which business is receiving the call
 *     phoneNumber:       string   — caller's phone number (E.164)
 *   }
 *
 * Response (success):
 *   {
 *     success:         true
 *     sessionId:       string   — internal call_sessions.id
 *     intakeFormUrl:   string   — full URL the customer should receive by SMS
 *     tokenExpiresAt:  string   — ISO timestamp
 *   }
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { issueIntakeFormToken } from "@/server/services/call-session-service";
import { badRequest, parseBody, serverError } from "../_lib";
import { NextResponse } from "next/server";

type RequestBody = {
  vapiCallId: string;
  serviceBusinessId: string;
  phoneNumber: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const body = await parseBody<RequestBody>(req);

  if (!body?.vapiCallId || !body?.serviceBusinessId || !body?.phoneNumber) {
    return badRequest(
      "Request body must include vapiCallId, serviceBusinessId, and phoneNumber.",
    );
  }

  const { vapiCallId, serviceBusinessId, phoneNumber } = body;
  const supabase = createSupabaseServiceClient();

  // Idempotent: if a session already exists for this vapiCallId, reuse it
  const { data: existing } = await supabase
    .from("call_sessions")
    .select("id, intake_form_token, intake_form_token_expires_at")
    .eq("provider_session_id", vapiCallId)
    .maybeSingle();

  let sessionId: string;

  if (existing) {
    sessionId = (existing as { id: string }).id;
  } else {
    // Upsert a customer stub from the phone number so we have a customer_id
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .insert({
        service_business_id: serviceBusinessId,
        phone_number: phoneNumber,
      })
      .select("id")
      .single();

    if (customerError || !customerData) {
      return serverError(`Failed to create customer record: ${customerError?.message ?? "unknown error"}`);
    }

    const customerId = (customerData as { id: string }).id;

    // Create the job in intake state
    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .insert({
        service_business_id: serviceBusinessId,
        customer_id: customerId,
        status: "intake",
      })
      .select("id")
      .single();

    if (jobError || !jobData) {
      return serverError(`Failed to create job record: ${jobError?.message ?? "unknown error"}`);
    }

    const jobId = (jobData as { id: string }).id;

    // Create the call session linking all three
    const { data: sessionData, error: sessionError } = await supabase
      .from("call_sessions")
      .insert({
        service_business_id: serviceBusinessId,
        customer_id: customerId,
        job_id: jobId,
        provider_session_id: vapiCallId,
        extraction_status: "pending",
      })
      .select("id")
      .single();

    if (sessionError || !sessionData) {
      return serverError(`Failed to create call session: ${sessionError?.message ?? "unknown error"}`);
    }

    sessionId = (sessionData as { id: string }).id;
  }

  // Issue (or retrieve existing) intake form token
  let tokenResult: { token: string; expiresAt: Date };
  try {
    tokenResult = await issueIntakeFormToken(sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return serverError(`Failed to issue intake form token: ${message}`);
  }

  // Build the full intake form URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const intakeFormUrl = `${baseUrl}/intake/${tokenResult.token}`;

  return NextResponse.json({
    success: true,
    sessionId,
    intakeFormUrl,
    tokenExpiresAt: tokenResult.expiresAt.toISOString(),
  });
}
