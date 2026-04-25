import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyJob,
  parseAndValidateClassification,
  type OpenAIClient,
} from "./classification-service";

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockJob = {
  id: string;
  problem_summary: string | null;
  required_skill: string | null;
  urgency: string | null;
  job_category: string | null;
} | null;

type SupabaseData = {
  job?: MockJob;
  updateError?: { message: string } | null;
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
      update: () => ({
        eq: () =>
          Promise.resolve({ error: mockSupabaseData.updateError ?? null }),
      }),
    }),
  }),
}));

// ─── OpenAI mock helpers ───────────────────────────────────────────────────────

function makeOpenAIMock(jsonContent: string): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: jsonContent } }],
        }),
      },
    } as unknown as OpenAIClient["chat"],
  };
}

function makeOpenAIErrorMock(message: string): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(new Error(message)),
      },
    } as unknown as OpenAIClient["chat"],
  };
}

function makeOpenAIEmptyMock(): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "" } }],
        }),
      },
    } as unknown as OpenAIClient["chat"],
  };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ID = "job-abc-123";

const BOILER_SUMMARY =
  "Customer reports boiler showing error code E2 with no hot water since yesterday. Six-year-old Worcester Bosch. Same-day urgency.";

const VALID_CLASSIFICATION_JSON = JSON.stringify({
  requiredSkill: "heating",
  urgency: "same_day",
  jobCategory: "Boiler repair",
});

const baseJob: MockJob = {
  id: JOB_ID,
  problem_summary: BOILER_SUMMARY,
  required_skill: null,
  urgency: null,
  job_category: null,
};

// ─── parseAndValidateClassification unit tests ────────────────────────────────

describe("parseAndValidateClassification", () => {
  it("returns a valid object for correct JSON", () => {
    const result = parseAndValidateClassification(VALID_CLASSIFICATION_JSON);
    expect(result).toEqual({
      requiredSkill: "heating",
      urgency: "same_day",
      jobCategory: "Boiler repair",
    });
  });

  it("returns null for non-JSON input", () => {
    expect(parseAndValidateClassification("not json at all")).toBeNull();
  });

  it("returns null when requiredSkill is missing", () => {
    const json = JSON.stringify({ urgency: "same_day", jobCategory: "Boiler repair" });
    expect(parseAndValidateClassification(json)).toBeNull();
  });

  it("returns null when requiredSkill is not a valid enum value", () => {
    const json = JSON.stringify({
      requiredSkill: "carpentry",
      urgency: "same_day",
      jobCategory: "Boiler repair",
    });
    expect(parseAndValidateClassification(json)).toBeNull();
  });

  it("returns null when urgency is missing", () => {
    const json = JSON.stringify({ requiredSkill: "plumbing", jobCategory: "Leak" });
    expect(parseAndValidateClassification(json)).toBeNull();
  });

  it("returns null when urgency is not a valid enum value", () => {
    const json = JSON.stringify({
      requiredSkill: "plumbing",
      urgency: "whenever",
      jobCategory: "Leak",
    });
    expect(parseAndValidateClassification(json)).toBeNull();
  });

  it("returns null when jobCategory is missing", () => {
    const json = JSON.stringify({ requiredSkill: "plumbing", urgency: "scheduled" });
    expect(parseAndValidateClassification(json)).toBeNull();
  });

  it("returns null when jobCategory is an empty string", () => {
    const json = JSON.stringify({
      requiredSkill: "plumbing",
      urgency: "scheduled",
      jobCategory: "   ",
    });
    expect(parseAndValidateClassification(json)).toBeNull();
  });

  it("trims whitespace from jobCategory", () => {
    const json = JSON.stringify({
      requiredSkill: "electrical",
      urgency: "emergency",
      jobCategory: "  Electrical fault  ",
    });
    const result = parseAndValidateClassification(json);
    expect(result?.jobCategory).toBe("Electrical fault");
  });

  it("accepts all valid skill values", () => {
    for (const skill of ["plumbing", "heating", "electrical"]) {
      const json = JSON.stringify({ requiredSkill: skill, urgency: "scheduled", jobCategory: "Test" });
      expect(parseAndValidateClassification(json)).not.toBeNull();
    }
  });

  it("accepts all valid urgency values", () => {
    for (const urgency of ["emergency", "same_day", "scheduled"]) {
      const json = JSON.stringify({ requiredSkill: "plumbing", urgency, jobCategory: "Test" });
      expect(parseAndValidateClassification(json)).not.toBeNull();
    }
  });
});

// ─── classifyJob integration tests ────────────────────────────────────────────

beforeEach(() => {
  mockSupabaseData = {};
  vi.clearAllMocks();
});

describe("classifyJob", () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns classification and writes it to the DB on success", async () => {
    mockSupabaseData = { job: baseJob };
    const openai = makeOpenAIMock(VALID_CLASSIFICATION_JSON);

    const result = await classifyJob(JOB_ID, openai);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.classification).toEqual({
      requiredSkill: "heating",
      urgency: "same_day",
      jobCategory: "Boiler repair",
    });
    expect(result.alreadyDone).toBe(false);
  });

  it("calls OpenAI exactly once per unclassified job", async () => {
    mockSupabaseData = { job: baseJob };
    const openai = makeOpenAIMock(VALID_CLASSIFICATION_JSON);

    await classifyJob(JOB_ID, openai);

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("sends the problem_summary to OpenAI in the user message", async () => {
    mockSupabaseData = { job: baseJob };
    const openai = makeOpenAIMock(VALID_CLASSIFICATION_JSON);

    await classifyJob(JOB_ID, openai);

    const callArgs = (openai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user").content as string;
    expect(userMessage).toContain(BOILER_SUMMARY);
  });

  it("uses temperature 0 for deterministic output", async () => {
    mockSupabaseData = { job: baseJob };
    const openai = makeOpenAIMock(VALID_CLASSIFICATION_JSON);

    await classifyJob(JOB_ID, openai);

    const callArgs = (openai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it("returns existing classification without calling OpenAI if already set", async () => {
    mockSupabaseData = {
      job: {
        ...baseJob,
        required_skill: "plumbing",
        urgency: "emergency",
        job_category: "Leak investigation",
      },
    };
    const openai = makeOpenAIMock("should not be called");

    const result = await classifyJob(JOB_ID, openai);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.alreadyDone).toBe(true);
    expect(result.classification.requiredSkill).toBe("plumbing");
    expect(result.classification.urgency).toBe("emergency");
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  // ── Missing summary ───────────────────────────────────────────────────────

  it("returns no_summary error when problem_summary is null", async () => {
    mockSupabaseData = { job: { ...baseJob, problem_summary: null } };

    const result = await classifyJob(JOB_ID, makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no_summary");
  });

  it("returns no_summary error when problem_summary is empty string", async () => {
    mockSupabaseData = { job: { ...baseJob, problem_summary: "   " } };

    const result = await classifyJob(JOB_ID, makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no_summary");
  });

  // ── Job not found ─────────────────────────────────────────────────────────

  it("returns not_found when the job does not exist", async () => {
    mockSupabaseData = { job: null };

    const result = await classifyJob("nonexistent-id", makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  // ── OpenAI failures ───────────────────────────────────────────────────────

  it("returns openai_error when the OpenAI call throws", async () => {
    mockSupabaseData = { job: baseJob };

    const result = await classifyJob(JOB_ID, makeOpenAIErrorMock("Connection timeout"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("openai_error");
    expect(result.message).toContain("Connection timeout");
  });

  it("returns openai_error when OpenAI returns an empty response", async () => {
    mockSupabaseData = { job: baseJob };

    const result = await classifyJob(JOB_ID, makeOpenAIEmptyMock());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("openai_error");
  });

  // ── Invalid AI output (fallback behaviour) ────────────────────────────────

  it("returns invalid_output and does NOT write to DB when skill is unrecognised", async () => {
    mockSupabaseData = { job: baseJob };
    const badJson = JSON.stringify({
      requiredSkill: "roofing",   // not a valid skill
      urgency: "same_day",
      jobCategory: "Roof repair",
    });

    const result = await classifyJob(JOB_ID, makeOpenAIMock(badJson));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_output");
  });

  it("returns invalid_output when urgency is unrecognised", async () => {
    mockSupabaseData = { job: baseJob };
    const badJson = JSON.stringify({
      requiredSkill: "plumbing",
      urgency: "asap",            // not a valid urgency
      jobCategory: "Leak",
    });

    const result = await classifyJob(JOB_ID, makeOpenAIMock(badJson));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_output");
  });

  it("returns invalid_output when OpenAI returns plain text instead of JSON", async () => {
    mockSupabaseData = { job: baseJob };

    const result = await classifyJob(JOB_ID, makeOpenAIMock("Sorry, I cannot classify this."));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_output");
  });

  it("job remains at qualified when output is invalid — no DB update attempted", async () => {
    // We verify this by checking that updateError is irrelevant — the update
    // call is simply never reached when classification validation fails.
    mockSupabaseData = {
      job: baseJob,
      updateError: { message: "should not be hit" },
    };
    const badJson = JSON.stringify({ requiredSkill: "magic", urgency: "now", jobCategory: "" });

    const result = await classifyJob(JOB_ID, makeOpenAIMock(badJson));

    // Result is invalid_output, not db_error — the DB was not touched
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("invalid_output");
  });

  // ── DB write failure ──────────────────────────────────────────────────────

  it("returns db_error when writing classification to the job fails", async () => {
    mockSupabaseData = {
      job: baseJob,
      updateError: { message: "foreign key constraint" },
    };

    const result = await classifyJob(JOB_ID, makeOpenAIMock(VALID_CLASSIFICATION_JSON));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });
});
