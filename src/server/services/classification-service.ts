/**
 * Classification Service
 *
 * Takes the AI-generated problem_summary from a job and uses OpenAI to
 * classify the job into three structured fields:
 *
 *   - required_skill  (workerSkill enum: plumbing | heating | electrical)
 *   - urgency         (urgency enum:     emergency | same_day | scheduled)
 *   - job_category    (free text label:  e.g. "Boiler repair", "Leak investigation")
 *
 * All three values are validated against allowed enum values before anything
 * is written to the database.  If OpenAI returns an invalid or unrecognisable
 * value the job is left at "qualified" and a typed error is returned — the
 * service never silently writes bad data.
 *
 * Idempotent: if the job already has both required_skill and urgency set,
 * the existing values are returned without calling OpenAI again.
 */

import OpenAI from "openai";
import { appConfig } from "@/config/app-config";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import { urgencyLevels, workerSkills } from "@/domain/enums";
import type { Urgency, WorkerSkill } from "@/domain/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClassificationOutput = {
  requiredSkill: WorkerSkill;
  urgency: Urgency;
  jobCategory: string;
};

export type ClassifyJobResult =
  | { success: true; classification: ClassificationOutput; alreadyDone: boolean }
  | {
      success: false;
      error:
        | "no_summary"
        | "not_found"
        | "openai_error"
        | "invalid_output"
        | "db_error";
      message: string;
    };

// ─── Allowed values (derived from enums so they stay in sync) ─────────────────

const ALLOWED_SKILLS = workerSkills as readonly string[];
const ALLOWED_URGENCIES = urgencyLevels as readonly string[];

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a dispatcher assistant for a UK home-service business that handles plumbing, heating, and electrical jobs.

Given a brief summary of a customer's reported problem, classify the job by returning a JSON object with exactly these three fields:

{
  "requiredSkill": "<one of: plumbing, heating, electrical>",
  "urgency": "<one of: emergency, same_day, scheduled>",
  "jobCategory": "<short human-readable label, 2–5 words, e.g. Boiler repair, Leak investigation, Electrical fault>"
}

Rules:
- requiredSkill MUST be exactly one of: plumbing, heating, electrical
- urgency MUST be exactly one of: emergency, same_day, scheduled
  - emergency = immediate risk to safety or major ongoing damage
  - same_day = urgent but not dangerous, customer wants it fixed today
  - scheduled = can be booked in advance with no urgency
- jobCategory should be short and clear — a worker should understand it at a glance
- Return ONLY the JSON object — no explanation, no markdown, no extra text`;

function buildUserMessage(summary: string): string {
  return `Problem summary:\n\n${summary}\n\nClassify this job now.`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

type RawClassification = {
  requiredSkill?: unknown;
  urgency?: unknown;
  jobCategory?: unknown;
};

/**
 * Parse the raw JSON string from OpenAI and validate all three fields.
 * Returns null if anything is missing or invalid — caller must treat this
 * as a classification failure and leave the job at "qualified".
 */
export function parseAndValidateClassification(
  raw: string,
): ClassificationOutput | null {
  let parsed: RawClassification;
  try {
    parsed = JSON.parse(raw) as RawClassification;
  } catch {
    return null;
  }

  const { requiredSkill, urgency, jobCategory } = parsed;

  if (typeof requiredSkill !== "string" || !ALLOWED_SKILLS.includes(requiredSkill)) {
    return null;
  }

  if (typeof urgency !== "string" || !ALLOWED_URGENCIES.includes(urgency)) {
    return null;
  }

  if (typeof jobCategory !== "string" || !jobCategory.trim()) {
    return null;
  }

  return {
    requiredSkill: requiredSkill as WorkerSkill,
    urgency: urgency as Urgency,
    jobCategory: jobCategory.trim(),
  };
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
 * Classify a job using its problem_summary.
 *
 * @param jobId  - The jobs.id to classify.
 * @param openai - OpenAI client (injected; defaults to real client).
 */
export async function classifyJob(
  jobId: string,
  openai: OpenAIClient = createOpenAIClient(),
  inlineProblemDescription?: string,
): Promise<ClassifyJobResult> {
  const supabase = createSupabaseServiceClient();

  // 0. If an inline description was passed (e.g. from the voice agent before a
  //    call summary exists), write it as the problem_summary so classification
  //    can proceed without a prior summarise-call step.
  if (inlineProblemDescription?.trim()) {
    await supabase
      .from("jobs")
      .update({ problem_summary: inlineProblemDescription.trim(), updated_at: new Date().toISOString() })
      .eq("id", jobId);
  }

  // 1. Load the job
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status, problem_summary, required_skill, urgency, job_category")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return {
      success: false,
      error: "not_found",
      message: `Job not found: ${jobId}`,
    };
  }

  const {
    status: currentStatus,
    problem_summary: problemSummary,
    required_skill: existingSkill,
    urgency: existingUrgency,
  } = job as {
    status: string;
    problem_summary: string | null;
    required_skill: WorkerSkill | null;
    urgency: Urgency | null;
    job_category: string | null;
  };

  // 2. Guard: must have a problem_summary to classify from
  if (!problemSummary?.trim()) {
    return {
      success: false,
      error: "no_summary",
      message: "Job has no problem_summary. Pass problemDescription in the tool call so classification can proceed without a prior summarise-call.",
    };
  }

  // 3. Idempotency: if already classified, return existing values
  if (existingSkill && existingUrgency) {
    const existingCategory = (job as { job_category: string | null }).job_category ?? "";
    return {
      success: true,
      alreadyDone: true,
      classification: {
        requiredSkill: existingSkill,
        urgency: existingUrgency,
        jobCategory: existingCategory,
      },
    };
  }

  // 4. Call OpenAI
  let rawContent: string;
  try {
    const model = appConfig.serviceCredentials.openai.summaryModel;
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(problemSummary) },
      ],
      temperature: 0,       // Zero temperature — deterministic classification
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    rawContent = response.choices[0]?.message?.content?.trim() ?? "";
    if (!rawContent) {
      return {
        success: false,
        error: "openai_error",
        message: "OpenAI returned an empty response.",
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: "openai_error",
      message: `OpenAI call failed: ${message}`,
    };
  }

  // 5. Parse and validate — reject anything that doesn't match our enums
  const classification = parseAndValidateClassification(rawContent);
  if (!classification) {
    return {
      success: false,
      error: "invalid_output",
      message: `OpenAI returned an unrecognisable classification: ${rawContent}`,
    };
  }

  // 6. Persist to the job record
  // Advance status intake → qualified (later states are left untouched).
  const classifyUpdates: Record<string, unknown> = {
    required_skill: classification.requiredSkill,
    urgency: classification.urgency,
    job_category: classification.jobCategory,
    updated_at: new Date().toISOString(),
  };
  if (currentStatus === "intake") {
    classifyUpdates.status = "qualified";
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update(classifyUpdates)
    .eq("id", jobId);

  if (updateError) {
    return {
      success: false,
      error: "db_error",
      message: `Failed to write classification to job: ${updateError.message}`,
    };
  }

  return { success: true, classification, alreadyDone: false };
}
