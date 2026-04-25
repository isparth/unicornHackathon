import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  priceJob,
  lookupRule,
  buildExplanation,
} from "./pricing-service";
import type { PriceEstimate } from "@/domain/types";

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockJob = {
  id: string;
  status: string;
  required_skill: string | null;
  urgency: string | null;
  job_category: string | null;
  price_estimate: PriceEstimate | null;
} | null;

type SupabaseData = {
  job?: MockJob;
  updateError?: { message: string } | null;
  capturedUpdate?: Record<string, unknown>;
};

let mockSupabaseData: SupabaseData = {};

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (mockSupabaseData.job === null) {
              return { data: null, error: { message: "not found" } };
            }
            return { data: mockSupabaseData.job, error: null };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        mockSupabaseData.capturedUpdate = payload;
        return {
          eq: () =>
            Promise.resolve({ error: mockSupabaseData.updateError ?? null }),
        };
      },
    }),
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID = "job-price-test-001";

const qualifiedHeatingJob: MockJob = {
  id: JOB_ID,
  status: "qualified",
  required_skill: "heating",
  urgency: "same_day",
  job_category: "Boiler repair",
  price_estimate: null,
};

// ─── buildExplanation unit tests ──────────────────────────────────────────────

describe("buildExplanation", () => {
  const rule = {
    calloutFeePence: 8000,
    repairEstimateMinPence: 10000,
    repairEstimateMaxPence: 30000,
  };

  it("includes the callout fee in the explanation", () => {
    const text = buildExplanation(rule, "gbp", "Boiler repair");
    expect(text).toContain("£80");
  });

  it("includes the repair range in the explanation", () => {
    const text = buildExplanation(rule, "gbp", "Boiler repair");
    expect(text).toContain("£100");
    expect(text).toContain("£300");
  });

  it("includes the job category in the explanation", () => {
    const text = buildExplanation(rule, "gbp", "Boiler repair");
    expect(text.toLowerCase()).toContain("boiler repair");
  });

  it("uses a generic label when jobCategory is empty", () => {
    const text = buildExplanation(rule, "gbp", "");
    expect(text).toContain("the repair");
  });

  it("clearly separates the fixed fee from the non-guaranteed range", () => {
    const text = buildExplanation(rule, "gbp", "Leak investigation");
    expect(text).toContain("not a fixed quote");
  });

  it("uses the correct currency symbol for GBP", () => {
    const text = buildExplanation(rule, "gbp", "Test");
    expect(text).toContain("£");
  });

  it("handles uppercase GBP string", () => {
    const text = buildExplanation(rule, "GBP", "Test");
    expect(text).toContain("£");
  });
});

// ─── lookupRule unit tests ────────────────────────────────────────────────────

describe("lookupRule", () => {
  it("returns heating same_day rule", () => {
    const rule = lookupRule("heating", "same_day");
    expect(rule.calloutFeePence).toBe(8000);
    expect(rule.repairEstimateMinPence).toBe(10000);
    expect(rule.repairEstimateMaxPence).toBe(30000);
  });

  it("returns heating emergency rule with higher callout than same_day", () => {
    const emergency = lookupRule("heating", "emergency");
    const sameDay = lookupRule("heating", "same_day");
    expect(emergency.calloutFeePence).toBeGreaterThan(sameDay.calloutFeePence);
  });

  it("returns scheduled rule with lower callout than same_day", () => {
    const scheduled = lookupRule("plumbing", "scheduled");
    const sameDay = lookupRule("plumbing", "same_day");
    expect(scheduled.calloutFeePence).toBeLessThan(sameDay.calloutFeePence);
  });

  it("returns plumbing emergency rule", () => {
    const rule = lookupRule("plumbing", "emergency");
    expect(rule.calloutFeePence).toBeGreaterThan(0);
    expect(rule.repairEstimateMaxPence).toBeGreaterThan(rule.repairEstimateMinPence);
  });

  it("returns electrical same_day rule", () => {
    const rule = lookupRule("electrical", "same_day");
    expect(rule.calloutFeePence).toBe(10000);
  });

  it("all rules have repairEstimateMax greater than repairEstimateMin", () => {
    const skills = ["heating", "plumbing", "electrical"] as const;
    const urgencies = ["emergency", "same_day", "scheduled"] as const;
    for (const skill of skills) {
      for (const urgency of urgencies) {
        const rule = lookupRule(skill, urgency);
        expect(
          rule.repairEstimateMaxPence,
          `${skill}/${urgency} repairMax should exceed repairMin`,
        ).toBeGreaterThan(rule.repairEstimateMinPence);
      }
    }
  });

  it("all rules have positive callout fees", () => {
    const skills = ["heating", "plumbing", "electrical"] as const;
    const urgencies = ["emergency", "same_day", "scheduled"] as const;
    for (const skill of skills) {
      for (const urgency of urgencies) {
        expect(lookupRule(skill, urgency).calloutFeePence).toBeGreaterThan(0);
      }
    }
  });
});

// ─── priceJob integration tests ───────────────────────────────────────────────

beforeEach(() => {
  mockSupabaseData = {};
  vi.clearAllMocks();
});

describe("priceJob", () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns a price estimate on success", async () => {
    mockSupabaseData = { job: qualifiedHeatingJob };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.estimate.calloutFeePence).toBeGreaterThan(0);
    expect(result.estimate.repairEstimateMinPence).toBeGreaterThan(0);
    expect(result.estimate.repairEstimateMaxPence).toBeGreaterThan(
      result.estimate.repairEstimateMinPence,
    );
    expect(result.estimate.explanation).toBeTruthy();
    expect(result.alreadyDone).toBe(false);
  });

  it("writes the correct values for heating same_day", async () => {
    mockSupabaseData = { job: qualifiedHeatingJob };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.estimate.calloutFeePence).toBe(8000);
    expect(result.estimate.repairEstimateMinPence).toBe(10000);
    expect(result.estimate.repairEstimateMaxPence).toBe(30000);
  });

  it("stores price_estimate and advances status to priced in the DB update", async () => {
    mockSupabaseData = { job: qualifiedHeatingJob };

    await priceJob(JOB_ID);

    expect(mockSupabaseData.capturedUpdate).toMatchObject({
      status: "priced",
      price_estimate: expect.objectContaining({
        calloutFeePence: 8000,
      }),
    });
  });

  it("includes currency in the stored estimate", async () => {
    mockSupabaseData = { job: qualifiedHeatingJob };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.estimate.currency).toBeTruthy();
  });

  it("includes a customer-facing explanation containing the callout fee", async () => {
    mockSupabaseData = { job: qualifiedHeatingJob };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.estimate.explanation).toContain("£80"); // 8000 pence
    expect(result.estimate.explanation).toContain("not a fixed quote");
  });

  it("applies the emergency uplift for emergency jobs", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, urgency: "emergency" },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Emergency heating callout is £150 vs £80 for same_day
    expect(result.estimate.calloutFeePence).toBe(15000);
  });

  it("applies scheduled discount for scheduled jobs", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, urgency: "scheduled" },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Scheduled heating callout is £60 vs £80 for same_day
    expect(result.estimate.calloutFeePence).toBe(6000);
  });

  it("applies correct rule for plumbing same_day", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, required_skill: "plumbing", job_category: "Leak investigation" },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.estimate.calloutFeePence).toBe(8000);
  });

  it("applies correct rule for electrical same_day", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, required_skill: "electrical", job_category: "Electrical fault" },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.estimate.calloutFeePence).toBe(10000);
  });

  // ── Status advancement ────────────────────────────────────────────────────

  it("does NOT change status when job is already past qualified", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, status: "priced", price_estimate: null },
    };

    await priceJob(JOB_ID);

    expect(mockSupabaseData.capturedUpdate?.status).toBeUndefined();
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it("returns existing estimate without re-running rules if already priced", async () => {
    const existing: PriceEstimate = {
      calloutFeePence: 9999,
      repairEstimateMinPence: 11111,
      repairEstimateMaxPence: 33333,
      currency: "gbp",
      explanation: "Already priced.",
    };
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, price_estimate: existing },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyDone).toBe(true);
    expect(result.estimate).toEqual(existing);
    // No DB write should have happened
    expect(mockSupabaseData.capturedUpdate).toBeUndefined();
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  it("returns not_found when the job does not exist", async () => {
    mockSupabaseData = { job: null };

    const result = await priceJob("nonexistent-id");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  it("returns not_classified when required_skill is null", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, required_skill: null },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_classified");
  });

  it("returns not_classified when urgency is null", async () => {
    mockSupabaseData = {
      job: { ...qualifiedHeatingJob, urgency: null },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_classified");
  });

  // ── DB failure ────────────────────────────────────────────────────────────

  it("returns db_error when the DB update fails", async () => {
    mockSupabaseData = {
      job: qualifiedHeatingJob,
      updateError: { message: "constraint violation" },
    };

    const result = await priceJob(JOB_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });
});
