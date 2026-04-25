/**
 * Image Analysis Service
 *
 * Uses OpenAI's vision API to analyse photos uploaded by a customer during the
 * intake flow, then writes structured findings back to the database.
 *
 * Per-asset state machine (uploaded_assets.analysis_status):
 *   pending  → processing  → done
 *                          → failed
 *
 * Job-level roll-up (jobs.image_analysis_status / jobs.image_analysis_context):
 *   The job's image_analysis_status reflects the worst-case state of all its
 *   assets once the batch is done.  image_analysis_context is a JSON object
 *   written ONLY to that dedicated column — it never touches problem_summary
 *   or any other form field.
 *
 * Idempotency rules:
 *   - Assets already at "done" are skipped entirely.
 *   - Assets at "processing" are re-attempted (guards against crashed mid-run).
 *   - Assets at "failed" are re-attempted (caller may retry after transient error).
 *   - If every asset for a job is already "done", analyseJobImages() short-circuits.
 *
 * Non-blocking contract:
 *   - OpenAI or storage errors are caught, written as "failed" to the asset row,
 *     and never re-thrown.  analyseJobImages() resolves (not rejects) in all cases.
 *   - Callers should treat the return value as advisory — the booking flow must
 *     NOT gate on image analysis.
 */

import OpenAI from "openai";
import { appConfig } from "@/config/app-config";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import type { ImageAnalysisStatus } from "@/domain/types";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Per-asset outcome returned from the batch run. */
export type AssetAnalysisOutcome =
  | { assetId: string; status: "done"; findings: ImageFindings }
  | { assetId: string; status: "skipped" }
  | { assetId: string; status: "failed"; reason: string };

/** Structured findings that OpenAI returns for a single image. */
export type ImageFindings = {
  /** One-sentence description of what the image shows. */
  description: string;
  /** Visible defects / damage details, or null if none observed. */
  defectsObserved: string | null;
  /** Estimated severity: low | medium | high | null (unknown). */
  severity: "low" | "medium" | "high" | null;
  /** Raw model output preserved for audit. */
  rawModelOutput: string;
};

/** Overall result of analysing all images for a job. */
export type AnalyseJobImagesResult = {
  /** How many assets were newly analysed. */
  analysed: number;
  /** How many assets were skipped (already done). */
  skipped: number;
  /** How many assets failed analysis. */
  failed: number;
  /** Per-asset detail. */
  outcomes: AssetAnalysisOutcome[];
  /** Final job-level image_analysis_status written to the DB. */
  jobStatus: ImageAnalysisStatus;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Signed URL expiry for Supabase Storage (seconds). Only needs to last the API call. */
const SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes

/** OpenAI model to use for image analysis. Overridable via env. */
export const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";

// ─── Prompt ───────────────────────────────────────────────────────────────────

const VISION_SYSTEM_PROMPT = `You are an assistant for a UK home-service company (plumbing, heating, electrical).

A customer has submitted a photo taken at their property as part of a job report.

Analyse the image and respond with a JSON object that has exactly these fields:

{
  "description": "<One sentence. What does the image show? Be factual and specific.>",
  "defectsObserved": "<String describing any visible damage, leaks, corrosion, burnt marks, etc. If none, set to null.>",
  "severity": "<'low' | 'medium' | 'high' | null — your estimate of how serious the issue looks. null means you cannot tell.>"
}

Rules:
- Return ONLY the JSON object — no markdown, no extra text.
- If the image does not show a home service issue (e.g. it is blank or unrelated), still return the JSON with description set to what you see, defectsObserved: null, severity: null.
- Do not speculate beyond what is visually present.`;

// ─── OpenAI client factory (injectable for testing) ───────────────────────────

export type OpenAIClient = Pick<OpenAI, "chat">;

export function createOpenAIClient(): OpenAIClient {
  const apiKey = appConfig.serviceCredentials.openai.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({ apiKey });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type RawFindings = {
  description?: unknown;
  defectsObserved?: unknown;
  severity?: unknown;
};

const ALLOWED_SEVERITIES = ["low", "medium", "high", null] as const;

/**
 * Parse and validate the JSON blob returned by the vision model.
 * Returns null if output is malformed — caller must treat this as a failure.
 */
export function parseImageFindings(
  raw: string,
): Omit<ImageFindings, "rawModelOutput"> | null {
  let parsed: RawFindings;
  try {
    parsed = JSON.parse(raw) as RawFindings;
  } catch {
    return null;
  }

  const { description, defectsObserved, severity } = parsed;

  if (typeof description !== "string" || !description.trim()) return null;

  if (defectsObserved !== null && typeof defectsObserved !== "string") return null;

  if (!(ALLOWED_SEVERITIES as readonly unknown[]).includes(severity)) return null;

  return {
    description: description.trim(),
    defectsObserved:
      typeof defectsObserved === "string" ? defectsObserved.trim() || null : null,
    severity: severity as ImageFindings["severity"],
  };
}

// ─── Single-asset analysis ────────────────────────────────────────────────────

/**
 * Analyse one uploaded asset using OpenAI vision.
 *
 * Steps:
 *  1. Mark asset as "processing".
 *  2. Generate a signed URL from Supabase Storage.
 *  3. Send image to OpenAI vision.
 *  4. Parse and validate response.
 *  5. Write findings to uploaded_assets.analysis_result and set status "done".
 *
 * On any error, sets status "failed" and returns a failed outcome (never throws).
 */
async function analyseAsset(
  assetId: string,
  storagePath: string,
  openai: OpenAIClient,
): Promise<AssetAnalysisOutcome> {
  const supabase = createSupabaseServiceClient();
  const now = () => new Date().toISOString();

  // Step 1: Mark as processing
  await supabase
    .from("uploaded_assets")
    .update({ analysis_status: "processing", updated_at: now() })
    .eq("id", assetId);

  // Step 2: Generate signed URL
  let imageUrl: string;
  try {
    const { data, error } = await supabase.storage
      .from("job-photos")
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "No signed URL returned");
    }
    imageUrl = data.signedUrl;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await supabase
      .from("uploaded_assets")
      .update({ analysis_status: "failed", updated_at: now() })
      .eq("id", assetId);
    return { assetId, status: "failed", reason: `Storage signed URL failed: ${reason}` };
  }

  // Step 3: Call OpenAI vision
  let rawContent: string;
  try {
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "low" },
            },
            {
              type: "text",
              text: "Analyse this image and return the JSON object as instructed.",
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 256,
      response_format: { type: "json_object" },
    });

    rawContent = response.choices[0]?.message?.content?.trim() ?? "";
    if (!rawContent) {
      throw new Error("OpenAI returned an empty response.");
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await supabase
      .from("uploaded_assets")
      .update({ analysis_status: "failed", updated_at: now() })
      .eq("id", assetId);
    return { assetId, status: "failed", reason: `OpenAI vision call failed: ${reason}` };
  }

  // Step 4: Parse and validate
  const parsed = parseImageFindings(rawContent);
  if (!parsed) {
    await supabase
      .from("uploaded_assets")
      .update({ analysis_status: "failed", updated_at: now() })
      .eq("id", assetId);
    return {
      assetId,
      status: "failed",
      reason: `OpenAI returned unrecognisable JSON: ${rawContent.slice(0, 200)}`,
    };
  }

  const findings: ImageFindings = { ...parsed, rawModelOutput: rawContent };

  // Step 5: Persist findings
  await supabase
    .from("uploaded_assets")
    .update({
      analysis_status: "done",
      analysis_result: findings as unknown as Record<string, unknown>,
      updated_at: now(),
    })
    .eq("id", assetId);

  return { assetId, status: "done", findings };
}

// ─── Job-level batch ──────────────────────────────────────────────────────────

/**
 * Analyse all pending/failed images for a job.
 *
 * @param jobId  - The jobs.id whose uploaded_assets should be analysed.
 * @param openai - OpenAI client (injected; defaults to real client).
 *
 * Never throws.  All errors are captured per-asset and reflected in the return value.
 */
export async function analyseJobImages(
  jobId: string,
  openai: OpenAIClient = createOpenAIClient(),
): Promise<AnalyseJobImagesResult> {
  const supabase = createSupabaseServiceClient();
  const now = () => new Date().toISOString();

  // Load all image assets for this job
  const { data: assets, error: assetsError } = await supabase
    .from("uploaded_assets")
    .select("id, storage_path, analysis_status")
    .eq("job_id", jobId)
    .eq("type", "image");

  if (assetsError || !assets) {
    // DB error — treat the whole job as failed without touching asset rows
    await supabase
      .from("jobs")
      .update({ image_analysis_status: "failed", updated_at: now() })
      .eq("id", jobId);

    return {
      analysed: 0,
      skipped: 0,
      failed: 0,
      outcomes: [],
      jobStatus: "failed",
    };
  }

  if (assets.length === 0) {
    // No images — nothing to do; leave job status untouched
    return {
      analysed: 0,
      skipped: 0,
      failed: 0,
      outcomes: [],
      jobStatus: "pending",
    };
  }

  // Set job to "processing" while we work through the assets
  await supabase
    .from("jobs")
    .update({ image_analysis_status: "processing", updated_at: now() })
    .eq("id", jobId);

  const outcomes: AssetAnalysisOutcome[] = [];

  for (const asset of assets as {
    id: string;
    storage_path: string;
    analysis_status: ImageAnalysisStatus | null;
  }[]) {
    if (asset.analysis_status === "done") {
      // Already analysed — skip idempotently
      outcomes.push({ assetId: asset.id, status: "skipped" });
      continue;
    }

    const outcome = await analyseAsset(asset.id, asset.storage_path, openai);
    outcomes.push(outcome);
  }

  // Tally results
  const analysed = outcomes.filter((o) => o.status === "done").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;

  // Determine final job-level status:
  //   - Any failure → "failed"
  //   - All done (or mixed done+skipped, no failures) → "done"
  const jobStatus: ImageAnalysisStatus = failed > 0 ? "failed" : "done";

  // Build the image_analysis_context summary from successful findings
  const successfulFindings = outcomes
    .filter((o): o is Extract<AssetAnalysisOutcome, { status: "done" }> => o.status === "done")
    .map((o) => ({
      assetId: o.assetId,
      description: o.findings.description,
      defectsObserved: o.findings.defectsObserved,
      severity: o.findings.severity,
    }));

  const imageAnalysisContext: Record<string, unknown> = {
    analysedAt: now(),
    assetCount: assets.length,
    successCount: analysed,
    failureCount: failed,
    findings: successfulFindings,
  };

  // Write final job-level status — never touch problem_summary or other form data
  await supabase
    .from("jobs")
    .update({
      image_analysis_status: jobStatus,
      image_analysis_context: imageAnalysisContext,
      updated_at: now(),
    })
    .eq("id", jobId);

  return { analysed, skipped, failed, outcomes, jobStatus };
}
