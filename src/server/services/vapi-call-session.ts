/**
 * Vapi Call Session Helper
 *
 * Extracted from the /api/tools/create-call-session route so the same logic
 * can be called:
 *   a) directly from the tool-call dispatcher inside the Vapi webhook handler
 *      (avoids an internal HTTP round-trip)
 *   b) from the existing route handler (unchanged)
 *
 * Creates — or reuses — a call session for a given Vapi call ID, creates the
 * customer stub and job record if needed, and issues an intake form token.
 *
 * Returns a JSON-serialisable result object (success/failure + payload).
 */

import { createSupabaseServiceClient } from "@/server/supabase/client";
import { issueIntakeFormToken } from "./call-session-service";
import { appConfig } from "@/config/app-config";

export type CreateCallSessionParams = {
  vapiCallId: string;
  serviceBusinessId: string;
  phoneNumber: string;
};

export type CreateCallSessionSuccess = {
  success: true;
  sessionId: string;
  intakeFormUrl: string;
  tokenExpiresAt: string;
};

export type CreateCallSessionFailure = {
  success: false;
  error: string;
  message: string;
};

export type CreateCallSessionResult = CreateCallSessionSuccess | CreateCallSessionFailure;

/**
 * Create or reuse a call session for the given Vapi call.
 *
 * Idempotent: if a session already exists for vapiCallId, return the existing
 * session's token (re-issuing a fresh one if the old one has expired).
 */
export async function createCallSessionFromVapi(
  params: CreateCallSessionParams,
): Promise<CreateCallSessionResult> {
  const { vapiCallId, serviceBusinessId, phoneNumber } = params;
  const supabase = createSupabaseServiceClient();

  // 1. Idempotency — reuse existing session if present
  const { data: existing } = await supabase
    .from("call_sessions")
    .select("id")
    .eq("provider_session_id", vapiCallId)
    .maybeSingle();

  let sessionId: string;

  if (existing) {
    sessionId = (existing as { id: string }).id;
  } else {
    // 2a. Create customer stub
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .insert({ service_business_id: serviceBusinessId, phone_number: phoneNumber })
      .select("id")
      .single();

    if (customerError || !customerData) {
      return {
        success: false,
        error: "db_error",
        message: `Failed to create customer: ${customerError?.message ?? "unknown"}`,
      };
    }

    const customerId = (customerData as { id: string }).id;

    // 2b. Create job in intake state
    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .insert({ service_business_id: serviceBusinessId, customer_id: customerId, status: "intake" })
      .select("id")
      .single();

    if (jobError || !jobData) {
      return {
        success: false,
        error: "db_error",
        message: `Failed to create job: ${jobError?.message ?? "unknown"}`,
      };
    }

    const jobId = (jobData as { id: string }).id;

    // 2c. Create call session
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
      return {
        success: false,
        error: "db_error",
        message: `Failed to create call session: ${sessionError?.message ?? "unknown"}`,
      };
    }

    sessionId = (sessionData as { id: string }).id;
  }

  // 3. Issue (or reuse) intake form token
  let tokenResult: { token: string; expiresAt: Date };
  try {
    tokenResult = await issueIntakeFormToken(sessionId);
  } catch (err) {
    return {
      success: false,
      error: "token_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const baseUrl = appConfig.appUrl;
  const intakeFormUrl = `${baseUrl}/intake/${tokenResult.token}`;

  return {
    success: true,
    sessionId,
    intakeFormUrl,
    tokenExpiresAt: tokenResult.expiresAt.toISOString(),
  };
}
