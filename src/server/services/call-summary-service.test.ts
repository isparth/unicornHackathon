import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateCallSummary,
  MIN_TRANSCRIPT_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  type OpenAIClient,
} from "./call-summary-service";

// ─── Supabase mock ─────────────────────────────────────────────────────────────
//
// We mock the Supabase client factory so tests never hit the network.
// Each test configures what the mock DB returns via mockSupabaseData.

type SupabaseData = {
  session?: {
    id: string;
    transcript: string | null;
    job_id: string | null;
  } | null;
  job?: { problem_summary: string | null } | null;
  updateError?: { message: string } | null;
};

let mockSupabaseData: SupabaseData = {};

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === "call_sessions") {
              if (mockSupabaseData.session === null) {
                return { data: null, error: { message: "not found" } };
              }
              return { data: mockSupabaseData.session, error: null };
            }
            if (table === "jobs") {
              return { data: mockSupabaseData.job ?? null, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: () => ({
        eq: () =>
          Promise.resolve({
            error: mockSupabaseData.updateError ?? null,
          }),
      }),
    }),
  }),
}));

// ─── OpenAI mock helpers ───────────────────────────────────────────────────────

function makeOpenAIMock(returnText: string): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: returnText } }],
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

const GOOD_TRANSCRIPT = `
Agent: Hello, thanks for calling. What seems to be the problem today?
Customer: Hi, my boiler has stopped working. The display is showing error code E2 and there's been no hot water since yesterday morning.
Agent: How long have you had the boiler?
Customer: About six years. It's a Worcester Bosch.
Agent: Is this an emergency for you or can it wait until tomorrow?
Customer: It's not an emergency, but I'd like it sorted as soon as possible.
Agent: Got it, same-day or next morning works. I'll send you a quick form now.
`.trim();

const SESSION_ID = "session-abc-123";
const JOB_ID = "job-xyz-456";

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSupabaseData = {};
  vi.clearAllMocks();
});

describe("generateCallSummary", () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns a summary and writes it to the job when transcript is valid", async () => {
    const expectedSummary =
      "Customer reports boiler showing error code E2 with no hot water since yesterday morning. Six-year-old Worcester Bosch. Same-day urgency.";

    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const openai = makeOpenAIMock(expectedSummary);
    const result = await generateCallSummary(SESSION_ID, openai);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toBe(expectedSummary);
    expect(result.alreadyDone).toBe(false);
  });

  it("calls OpenAI exactly once per new summary", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const openai = makeOpenAIMock("Some summary.");
    await generateCallSummary(SESSION_ID, openai);

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("trims whitespace from the returned summary", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const openai = makeOpenAIMock("  Summary with padding.  ");
    const result = await generateCallSummary(SESSION_ID, openai);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toBe("Summary with padding.");
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it("returns the existing summary without calling OpenAI if already set", async () => {
    const existingSummary = "Boiler fault, error E2, no hot water.";
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: existingSummary },
    };

    const openai = makeOpenAIMock("Should not be called.");
    const result = await generateCallSummary(SESSION_ID, openai);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toBe(existingSummary);
    expect(result.alreadyDone).toBe(true);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  // ── Missing / short transcript ────────────────────────────────────────────

  it("returns no_transcript error when transcript is null", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: null, job_id: JOB_ID },
    };

    const result = await generateCallSummary(SESSION_ID, makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no_transcript");
  });

  it("returns no_transcript error when transcript is empty string", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: "   ", job_id: JOB_ID },
    };

    const result = await generateCallSummary(SESSION_ID, makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no_transcript");
  });

  it("returns transcript_too_short when transcript is below the minimum length", async () => {
    const shortTranscript = "Hello?".padEnd(MIN_TRANSCRIPT_LENGTH - 1, "x");
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: shortTranscript, job_id: JOB_ID },
    };

    const result = await generateCallSummary(SESSION_ID, makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("transcript_too_short");
  });

  it("accepts a transcript exactly at the minimum length", async () => {
    const exactTranscript = "A".repeat(MIN_TRANSCRIPT_LENGTH);
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: exactTranscript, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const result = await generateCallSummary(SESSION_ID, makeOpenAIMock("Summary."));
    expect(result.success).toBe(true);
  });

  // ── Transcript truncation ─────────────────────────────────────────────────

  it("truncates the transcript to MAX_TRANSCRIPT_LENGTH before sending to OpenAI", async () => {
    const longTranscript = "A".repeat(MAX_TRANSCRIPT_LENGTH + 500);
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: longTranscript, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const openai = makeOpenAIMock("Summary.");
    await generateCallSummary(SESSION_ID, openai);

    const callArgs = (openai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user").content as string;
    // The transcript portion should be at most MAX_TRANSCRIPT_LENGTH chars
    expect(userMessage.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_LENGTH + 200); // +200 for prompt text
  });

  // ── Session not found ─────────────────────────────────────────────────────

  it("returns not_found when the session does not exist", async () => {
    mockSupabaseData = { session: null };

    const result = await generateCallSummary("nonexistent-id", makeOpenAIMock("x"));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("not_found");
  });

  // ── OpenAI failures ───────────────────────────────────────────────────────

  it("returns openai_error when the OpenAI call throws", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const result = await generateCallSummary(
      SESSION_ID,
      makeOpenAIErrorMock("Rate limit exceeded"),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("openai_error");
    expect(result.message).toContain("Rate limit exceeded");
  });

  it("returns openai_error when OpenAI returns an empty content string", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: null },
    };

    const result = await generateCallSummary(SESSION_ID, makeOpenAIEmptyMock());

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("openai_error");
  });

  // ── DB write failure ──────────────────────────────────────────────────────

  it("returns db_error when writing problem_summary to the job fails", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: JOB_ID },
      job: { problem_summary: null },
      updateError: { message: "constraint violation" },
    };

    const result = await generateCallSummary(SESSION_ID, makeOpenAIMock("A good summary."));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("db_error");
  });

  // ── No job linked ─────────────────────────────────────────────────────────

  it("still returns success if the session has no linked job (skips DB write)", async () => {
    mockSupabaseData = {
      session: { id: SESSION_ID, transcript: GOOD_TRANSCRIPT, job_id: null },
    };

    const openai = makeOpenAIMock("Summary without a job.");
    const result = await generateCallSummary(SESSION_ID, openai);

    // OpenAI was still called, summary returned, but no job write attempted
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toBe("Summary without a job.");
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});
