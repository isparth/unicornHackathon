/**
 * Pricing Service
 *
 * Applies configurable pricing rules to a classified job and writes a
 * structured PriceEstimate to jobs.price_estimate (JSONB).
 *
 * Rules are keyed by required_skill × urgency.  A match returns:
 *   - calloutFeePence       — the fixed call-out fee the customer pays upfront
 *   - repairEstimateMinPence — lower bound of the non-guaranteed repair range
 *   - repairEstimateMaxPence — upper bound of the non-guaranteed repair range
 *   - explanation            — customer-facing text that clearly separates the
 *                              fixed fee from the non-guaranteed repair range
 *
 * Fallback: if no rule matches (e.g. a future skill is added before the rules
 * table is updated), the service uses pricingDefaults from app-config rather
 * than failing.
 *
 * Idempotent: if price_estimate is already set on the job the existing value
 * is returned without re-running the rules.
 *
 * After writing the estimate the job is advanced from "qualified" to "priced"
 * — but only if it is currently in "qualified" state; later states are left
 * untouched so replayed events cannot regress the job.
 */

import { appConfig } from "@/config/app-config";
import { createSupabaseServiceClient } from "@/server/supabase/client";
import type { PriceEstimate, Urgency, WorkerSkill } from "@/domain/types";

// ─── Pricing rule definition ──────────────────────────────────────────────────

type PricingRule = {
  calloutFeePence: number;
  repairEstimateMinPence: number;
  repairEstimateMaxPence: number;
};

/**
 * All amounts in pence (GBP).
 *
 * Rules are intentionally hardcoded here for v1 — simple to read and change.
 * A future version can load these from a DB table or environment overrides.
 *
 * Urgency modifiers:
 *   emergency  — higher call-out fee, wider repair range
 *   same_day   — standard call-out fee, standard repair range
 *   scheduled  — lower call-out, tighter range (less risk for both sides)
 */
const PRICING_RULES: Record<WorkerSkill, Record<Urgency, PricingRule>> = {
  heating: {
    emergency: {
      calloutFeePence:        15000,   // £150
      repairEstimateMinPence: 15000,   // £150
      repairEstimateMaxPence: 45000,   // £450
    },
    same_day: {
      calloutFeePence:        8000,    // £80
      repairEstimateMinPence: 10000,   // £100
      repairEstimateMaxPence: 30000,   // £300
    },
    scheduled: {
      calloutFeePence:        6000,    // £60
      repairEstimateMinPence: 8000,    // £80
      repairEstimateMaxPence: 25000,   // £250
    },
  },
  plumbing: {
    emergency: {
      calloutFeePence:        12000,   // £120
      repairEstimateMinPence: 10000,   // £100
      repairEstimateMaxPence: 40000,   // £400
    },
    same_day: {
      calloutFeePence:        8000,    // £80
      repairEstimateMinPence: 8000,    // £80
      repairEstimateMaxPence: 25000,   // £250
    },
    scheduled: {
      calloutFeePence:        6000,    // £60
      repairEstimateMinPence: 6000,    // £60
      repairEstimateMaxPence: 20000,   // £200
    },
  },
  electrical: {
    emergency: {
      calloutFeePence:        15000,   // £150
      repairEstimateMinPence: 12000,   // £120
      repairEstimateMaxPence: 50000,   // £500
    },
    same_day: {
      calloutFeePence:        10000,   // £100
      repairEstimateMinPence: 10000,   // £100
      repairEstimateMaxPence: 35000,   // £350
    },
    scheduled: {
      calloutFeePence:        7500,    // £75
      repairEstimateMinPence: 8000,    // £80
      repairEstimateMaxPence: 30000,   // £300
    },
  },
};

// ─── Explanation builder ──────────────────────────────────────────────────────

/**
 * Generate a clear customer-facing explanation that separates the fixed
 * call-out fee from the non-guaranteed repair estimate.
 */
export function buildExplanation(
  rule: PricingRule,
  currency: string,
  jobCategory: string,
): string {
  const symbol = currency.toUpperCase() === "GBP" ? "£" : currency.toUpperCase();
  const callout = (rule.calloutFeePence / 100).toFixed(0);
  const min = (rule.repairEstimateMinPence / 100).toFixed(0);
  const max = (rule.repairEstimateMaxPence / 100).toFixed(0);
  const label = jobCategory || "the repair";

  return (
    `The call-out fee is ${symbol}${callout} — this covers the visit and initial diagnosis. ` +
    `If work is required, the estimated cost for ${label.toLowerCase()} is ` +
    `${symbol}${min}–${symbol}${max}. ` +
    `The repair estimate is not a fixed quote and may vary once our engineer has inspected the problem.`
  );
}

// ─── Rule lookup ──────────────────────────────────────────────────────────────

/**
 * Look up a pricing rule for the given skill and urgency.
 * Falls back to pricingDefaults if the combination is not in the table.
 */
export function lookupRule(skill: WorkerSkill, urgency: Urgency): PricingRule {
  return (
    PRICING_RULES[skill]?.[urgency] ?? {
      calloutFeePence: appConfig.pricingDefaults.calloutFeePence,
      repairEstimateMinPence: appConfig.pricingDefaults.repairEstimateMinPence,
      repairEstimateMaxPence: appConfig.pricingDefaults.repairEstimateMaxPence,
    }
  );
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type PriceJobResult =
  | { success: true; estimate: PriceEstimate; alreadyDone: boolean }
  | {
      success: false;
      error: "not_found" | "not_classified" | "db_error";
      message: string;
    };

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Price a job by looking up its classification and applying the matching rule.
 *
 * @param jobId - The jobs.id to price.
 */
export async function priceJob(jobId: string): Promise<PriceJobResult> {
  const supabase = createSupabaseServiceClient();

  // 1. Load the job
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status, required_skill, urgency, job_category, price_estimate")
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
    status,
    required_skill: requiredSkill,
    urgency,
    job_category: jobCategory,
    price_estimate: existingEstimate,
  } = job as {
    status: string;
    required_skill: WorkerSkill | null;
    urgency: Urgency | null;
    job_category: string | null;
    price_estimate: PriceEstimate | null;
  };

  // 2. Guard: must be classified before pricing
  if (!requiredSkill || !urgency) {
    return {
      success: false,
      error: "not_classified",
      message: "Job must have required_skill and urgency set before pricing. Run the Classification Service first.",
    };
  }

  // 3. Idempotency: if already priced, return existing estimate
  if (existingEstimate) {
    return { success: true, estimate: existingEstimate, alreadyDone: true };
  }

  // 4. Look up the pricing rule
  const rule = lookupRule(requiredSkill, urgency);
  const currency = appConfig.pricingDefaults.currency;

  // 5. Build the structured estimate with customer-facing explanation
  const estimate: PriceEstimate = {
    calloutFeePence: rule.calloutFeePence,
    repairEstimateMinPence: rule.repairEstimateMinPence,
    repairEstimateMaxPence: rule.repairEstimateMaxPence,
    currency,
    explanation: buildExplanation(rule, currency, jobCategory ?? ""),
  };

  // 6. Persist: write price_estimate and advance to "priced" if currently "qualified"
  const updates: Record<string, unknown> = {
    price_estimate: estimate,
    updated_at: new Date().toISOString(),
  };

  // Only advance the status from qualified → priced.  Later states are left alone.
  if (status === "qualified") {
    updates.status = "priced";
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update(updates)
    .eq("id", jobId);

  if (updateError) {
    return {
      success: false,
      error: "db_error",
      message: `Failed to write price estimate to job: ${updateError.message}`,
    };
  }

  return { success: true, estimate, alreadyDone: false };
}
