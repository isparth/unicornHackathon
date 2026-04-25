/**
 * Call Summary Service
 *
 * Generates a clean, concise worker-facing summary of a voice call from the
 * stored transcript, then writes it to jobs.problem_summary.
 *
 * This is the authoritative source of the problem description. It is derived
 * from the actual conversation — not from a text box the customer typed into.
 * It must never be overwritten by intake form submission.
 *
 * Idempotent: if problem_summary is already set on the job, the function
 * returns the existing value without calling OpenAI again.
 */

import OpenAI from "openai";
import { appConfig } from "@/config/app-config";
import { createSupabaseServiceClient } from "@/server/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GenerateSummaryResult =
  | { success: true; summary: string; alreadyDone: boolean }
  | {
      success: false;
      error:
        | "no_transcript"
        | "transcript_too_short"
        | "openai_error"
        | "db_error"
        | "not_found";
      message: string;
    };

// Minimum number of characters we consider a meaningful transcript.
// Shorter strings (e.g. "Hello?") won't produce a useful summary.
export const MIN_TRANSCRIPT_LENGTH = 50;

// Maximum characters of transcript we send to OpenAI.
// Prevents runaway token costs if transcripts are very long.
export const MAX_TRANSCRIPT_LENGTH = 8000;

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a dispatcher assistant for a home-service business (plumbing, heating, electrical).

Your job is to read a raw call transcript between a customer and an AI booking agent, then write a SHORT, FACTUAL summary for the attending worker.

Rules:
- Write 2 to 4 sentences maximum.
- Use plain, direct language — no filler, no fluff.
- Include: what the problem is, any urgency signals, any specific details mentioned (error codes, location within property, how long the issue has been occurring).
- Do NOT include customer name, address, or phone number — those come from the intake form.
- Do NOT speculate or invent details not present in the transcript.
- If the transcript is unclear or too brief to summarise accurately, write exactly: "Insufficient information in transcript to generate summary."`;

function buildUserMessage(transcript: string): string {
  const trimmed = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
  return `Transcript:\n\n${trimmed}\n\nWrite the worker summary now.`;
}

// ─── OpenAI client factory (injectable for testing) ───────────────────────────

export type OpenAIClient = Pick<OpenAI, "chat">;

export function createOpenAIClient(): OpenAIClient {
  const apiKey = appConfig.serviceCredentials.openai.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({ apiKey });
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Generate and persist a call summary for the job linked to a call session.
 *
 * @param sessionId  - The call_sessions.id to summarise.
 * @param openai     - OpenAI client (injected; defaults to real client).
 */
export async function generateCallSummary(
  sessionId: string,
  openai: OpenAIClient = createOpenAIClient(),
): Promise<GenerateSummaryResult> {
  const supabase = createSupabaseServiceClient();

  // 1. Load the call session
  const { data: session, error: sessionError } = await supabase
    .from("call_sessions")
    .select("id, transcript, job_id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return {
      success: false,
      error: "not_found",
      message: `Call session not found: ${sessionId}`,
    };
  }

  const transcript = (session.transcript as string | null) ?? "";
  const jobId = session.job_id as string | null;

  // 2. Guard: must have a meaningful transcript
  if (!transcript.trim()) {
    return {
      success: false,
      error: "no_transcript",
      message: "Call session has no transcript to summarise.",
    };
  }

  if (transcript.trim().length < MIN_TRANSCRIPT_LENGTH) {
    return {
      success: false,
      error: "transcript_too_short",
      message: `Transcript is too short to summarise (${transcript.trim().length} chars, minimum ${MIN_TRANSCRIPT_LENGTH}).`,
    };
  }

  // 3. Idempotency: if the job already has a problem_summary, return it as-is
  if (jobId) {
    const { data: job } = await supabase
      .from("jobs")
      .select("problem_summary")
      .eq("id", jobId)
      .single();

    if (job && (job as { problem_summary: string | null }).problem_summary) {
      const existing = (job as { problem_summary: string }).problem_summary;
      return { success: true, summary: existing, alreadyDone: true };
    }
  }

  // 4. Call OpenAI
  let summary: string;
  try {
    const model = appConfig.serviceCredentials.openai.summaryModel;
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(transcript) },
      ],
      temperature: 0.2, // Low temperature — we want factual, consistent output
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        success: false,
        error: "openai_error",
        message: "OpenAI returned an empty response.",
      };
    }
    summary = content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: "openai_error",
      message: `OpenAI call failed: ${message}`,
    };
  }

  // 5. Persist: write summary to jobs.problem_summary and call_sessions.summary
  if (jobId) {
    const { error: jobError } = await supabase
      .from("jobs")
      .update({
        problem_summary: summary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (jobError) {
      return {
        success: false,
        error: "db_error",
        message: `Failed to write problem_summary to job: ${jobError.message}`,
      };
    }
  }

  // Also store on the call session for quick access / audit
  await supabase
    .from("call_sessions")
    .update({
      summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  return { success: true, summary, alreadyDone: false };
}
