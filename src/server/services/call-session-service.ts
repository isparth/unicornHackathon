/**
 * Call Session Service
 *
 * Handles DB operations for call_sessions that are related to the intake
 * form flow: looking up a session by token, marking the form complete, and
 * reading the session with its linked job.
 */

import { appConfig } from "@/config/app-config";
import type { CallSession } from "@/domain/types";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import { generateIntakeToken } from "./intake-token-service";

type RawCallSession = {
  id: string;
  service_business_id: string;
  customer_id: string | null;
  job_id: string | null;
  provider_session_id: string | null;
  transcript: string | null;
  event_history: Record<string, unknown>[];
  summary: string | null;
  extraction_status: string;
  intake_form_token: string | null;
  intake_form_token_expires_at: string | null;
  intake_form_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapCallSession(raw: RawCallSession): CallSession {
  return {
    id: raw.id,
    serviceBusinessId: raw.service_business_id,
    customerId: raw.customer_id,
    jobId: raw.job_id,
    providerSessionId: raw.provider_session_id,
    transcript: raw.transcript,
    eventHistory: raw.event_history,
    summary: raw.summary,
    extractionStatus: raw.extraction_status,
    intakeFormToken: raw.intake_form_token,
    intakeFormTokenExpiresAt: raw.intake_form_token_expires_at,
    intakeFormCompletedAt: raw.intake_form_completed_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Look up a call session by its raw intake form token value.
 * Returns null if not found.
 */
export async function getCallSessionByToken(
  token: string,
): Promise<CallSession | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("call_sessions")
    .select("*")
    .eq("intake_form_token", token)
    .single();

  if (error || !data) return null;
  return mapCallSession(data as RawCallSession);
}

/**
 * Attach a fresh intake form token to a call session.
 * Idempotent: if the session already has an unexpired token, return the
 * existing one rather than issuing a new one.
 *
 * Returns the token string and its expiry date.
 */
export async function issueIntakeFormToken(
  sessionId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const supabase = createSupabaseServiceClient();

  // Check if an unexpired token already exists — idempotency
  const { data: existing } = await supabase
    .from("call_sessions")
    .select("intake_form_token, intake_form_token_expires_at")
    .eq("id", sessionId)
    .single();

  if (existing?.intake_form_token && existing.intake_form_token_expires_at) {
    const existingExpiry = new Date(
      existing.intake_form_token_expires_at as string,
    );
    if (existingExpiry > new Date()) {
      return {
        token: existing.intake_form_token as string,
        expiresAt: existingExpiry,
      };
    }
  }

  // Generate a new token
  const { token, expiresAt } = generateIntakeToken(
    sessionId,
    appConfig.intakeToken.secret,
    appConfig.intakeToken.expiryMinutes,
  );

  const { error } = await supabase
    .from("call_sessions")
    .update({
      intake_form_token: token,
      intake_form_token_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to store intake form token: ${error.message}`);
  }

  return { token, expiresAt };
}

/**
 * Mark the intake form as complete for a given call session.
 * Sets intake_form_completed_at to now.
 */
export async function markIntakeFormComplete(
  sessionId: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("call_sessions")
    .update({
      intake_form_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to mark intake form complete: ${error.message}`);
  }
}
