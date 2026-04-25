/**
 * Tests for the /api/tools/* route handlers.
 *
 * Each route handler is imported directly and called with a synthetic Request
 * object — no HTTP server is spun up.  We mock the underlying services and
 * Supabase client to keep tests fast and isolated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Service mocks ────────────────────────────────────────────────────────────

const mockIssueIntakeFormToken = vi.fn();
const mockGenerateCallSummary = vi.fn();
const mockClassifyJob = vi.fn();
const mockPriceJob = vi.fn();

vi.mock("@/server/services/call-session-service", () => ({
  issueIntakeFormToken: (...args: unknown[]) => mockIssueIntakeFormToken(...args),
}));

vi.mock("@/server/services/call-summary-service", () => ({
  generateCallSummary: (...args: unknown[]) => mockGenerateCallSummary(...args),
}));

vi.mock("@/server/services/classification-service", () => ({
  classifyJob: (...args: unknown[]) => mockClassifyJob(...args),
}));

vi.mock("@/server/services/pricing-service", () => ({
  priceJob: (...args: unknown[]) => mockPriceJob(...args),
}));

// ─── Supabase mock ────────────────────────────────────────────────────────────

type SupabaseMockRow = Record<string, unknown> | null;

let mockSupabaseRows: Record<string, SupabaseMockRow> = {};
let capturedInserts: Record<string, unknown[]> = {};

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          single: async () => {
            const row = mockSupabaseRows[`${table}:${val}`] ?? null;
            return row === null
              ? { data: null, error: { message: "not found" } }
              : { data: row, error: null };
          },
          maybeSingle: async () => {
            const row = mockSupabaseRows[`${table}:${val}`] ?? null;
            return { data: row, error: null };
          },
          order: () => ({
            limit: () => ({
              maybeSingle: async () => {
                const row = mockSupabaseRows[`${table}:${val}`] ?? null;
                return { data: row, error: null };
              },
            }),
          }),
        }),
      }),
      insert: (data: unknown) => {
        if (!capturedInserts[table]) capturedInserts[table] = [];
        capturedInserts[table].push(data as Record<string, unknown>);
        // Return the first word of the table as a fake id
        const fakeId = `fake-${table}-id`;
        return {
          select: () => ({
            single: async () => ({ data: { id: fakeId }, error: null }),
          }),
        };
      },
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

// ─── Helper to build a Request ────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/tools/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emptyRequest(): Request {
  return new Request("http://localhost/api/tools/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "",
  });
}

// ─── Route imports (after mocks are set up) ───────────────────────────────────

const { POST: generateIntakeTokenPOST } = await import(
  "./generate-intake-token/route"
);
const { POST: checkFormStatusPOST } = await import(
  "./check-form-status/route"
);
const { POST: summariseCallPOST } = await import("./summarise-call/route");
const { POST: classifyJobPOST } = await import("./classify-job/route");
const { POST: priceJobPOST } = await import("./price-job/route");

// ─── Resets ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSupabaseRows = {};
  capturedInserts = {};
  vi.clearAllMocks();
});

// ─── /api/tools/generate-intake-token ────────────────────────────────────────

describe("POST /api/tools/generate-intake-token", () => {
  it("returns 400 when sessionId is missing", async () => {
    const res = await generateIntakeTokenPOST(emptyRequest());
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("bad_request");
  });

  it("returns 500 when issueIntakeFormToken throws", async () => {
    mockIssueIntakeFormToken.mockRejectedValue(new Error("token store failed"));

    const res = await generateIntakeTokenPOST(makeRequest({ sessionId: "sess-abc" }));
    expect(res.status).toBe(500);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("server_error");
  });

  it("returns the intake form URL on success", async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    mockIssueIntakeFormToken.mockResolvedValue({ token: "tok123", expiresAt });

    const res = await generateIntakeTokenPOST(makeRequest({ sessionId: "sess-abc" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; intakeFormUrl: string; token: string };
    expect(body.success).toBe(true);
    expect(body.token).toBe("tok123");
    expect(body.intakeFormUrl).toContain("tok123");
  });
});

// ─── /api/tools/check-form-status ────────────────────────────────────────────

describe("POST /api/tools/check-form-status", () => {
  it("returns 400 when neither sessionId nor jobId provided", async () => {
    const res = await checkFormStatusPOST(emptyRequest());
    expect(res.status).toBe(400);
  });

  it("returns completed: false when intake_form_completed_at is null", async () => {
    mockSupabaseRows["call_sessions:sess-001"] = {
      intake_form_completed_at: null,
      job_id: "job-001",
    };
    mockSupabaseRows["jobs:job-001"] = { status: "intake" };

    const res = await checkFormStatusPOST(makeRequest({ sessionId: "sess-001" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { completed: boolean; jobStatus: string };
    expect(body.completed).toBe(false);
    expect(body.jobStatus).toBe("intake");
  });

  it("returns completed: true when intake_form_completed_at is set", async () => {
    mockSupabaseRows["call_sessions:sess-002"] = {
      intake_form_completed_at: "2024-01-01T10:00:00Z",
      job_id: "job-002",
    };
    mockSupabaseRows["jobs:job-002"] = { status: "qualified" };

    const res = await checkFormStatusPOST(makeRequest({ sessionId: "sess-002" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { completed: boolean; completedAt: string; jobStatus: string };
    expect(body.completed).toBe(true);
    expect(body.completedAt).toBe("2024-01-01T10:00:00Z");
    expect(body.jobStatus).toBe("qualified");
  });

  it("accepts jobId instead of sessionId", async () => {
    mockSupabaseRows["call_sessions:job-003"] = {
      intake_form_completed_at: "2024-01-01T11:00:00Z",
      job_id: "job-003",
    };
    mockSupabaseRows["jobs:job-003"] = { status: "priced" };

    const res = await checkFormStatusPOST(makeRequest({ jobId: "job-003" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { completed: boolean };
    expect(body.completed).toBe(true);
  });
});

// ─── /api/tools/summarise-call ───────────────────────────────────────────────

describe("POST /api/tools/summarise-call", () => {
  it("returns 400 when sessionId is missing", async () => {
    const res = await summariseCallPOST(emptyRequest());
    expect(res.status).toBe(400);
  });

  it("returns 404 when session not found", async () => {
    mockGenerateCallSummary.mockResolvedValue({
      success: false,
      error: "not_found",
      message: "not found",
    });

    const res = await summariseCallPOST(makeRequest({ sessionId: "missing" }));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns 422 when transcript is too short", async () => {
    mockGenerateCallSummary.mockResolvedValue({
      success: false,
      error: "transcript_too_short",
      message: "too short",
    });

    const res = await summariseCallPOST(makeRequest({ sessionId: "sess-short" }));
    expect(res.status).toBe(422);
  });

  it("returns summary on success", async () => {
    mockGenerateCallSummary.mockResolvedValue({
      success: true,
      summary: "Boiler not heating. Error E12. Customer says it started yesterday.",
      alreadyDone: false,
    });

    const res = await summariseCallPOST(makeRequest({ sessionId: "sess-ok" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: string; alreadyDone: boolean };
    expect(body.summary).toContain("Boiler");
    expect(body.alreadyDone).toBe(false);
  });

  it("returns alreadyDone: true for idempotent call", async () => {
    mockGenerateCallSummary.mockResolvedValue({
      success: true,
      summary: "Existing summary.",
      alreadyDone: true,
    });

    const res = await summariseCallPOST(makeRequest({ sessionId: "sess-ok2" }));
    const body = await res.json() as { alreadyDone: boolean };
    expect(body.alreadyDone).toBe(true);
  });
});

// ─── /api/tools/classify-job ─────────────────────────────────────────────────

describe("POST /api/tools/classify-job", () => {
  it("returns 400 when neither jobId nor sessionId provided", async () => {
    const res = await classifyJobPOST(emptyRequest());
    expect(res.status).toBe(400);
  });

  it("resolves jobId from sessionId", async () => {
    mockSupabaseRows["call_sessions:sess-x"] = { job_id: "job-x" };
    mockClassifyJob.mockResolvedValue({
      success: true,
      classification: { requiredSkill: "heating", urgency: "same_day", jobCategory: "Boiler repair" },
      alreadyDone: false,
    });

    const res = await classifyJobPOST(makeRequest({ sessionId: "sess-x" }));
    expect(res.status).toBe(200);
    expect(mockClassifyJob).toHaveBeenCalledWith("job-x");
  });

  it("returns 422 when no_summary error", async () => {
    mockClassifyJob.mockResolvedValue({
      success: false,
      error: "no_summary",
      message: "no summary",
    });

    const res = await classifyJobPOST(makeRequest({ jobId: "job-no-sum" }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("no_summary");
  });

  it("returns classification fields on success", async () => {
    mockClassifyJob.mockResolvedValue({
      success: true,
      classification: {
        requiredSkill: "plumbing",
        urgency: "emergency",
        jobCategory: "Burst pipe",
      },
      alreadyDone: false,
    });

    const res = await classifyJobPOST(makeRequest({ jobId: "job-ok" }));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      requiredSkill: string;
      urgency: string;
      jobCategory: string;
    };
    expect(body.requiredSkill).toBe("plumbing");
    expect(body.urgency).toBe("emergency");
    expect(body.jobCategory).toBe("Burst pipe");
  });

  it("returns 422 when session has no linked job", async () => {
    mockSupabaseRows["call_sessions:sess-nojob"] = { job_id: null };

    const res = await classifyJobPOST(makeRequest({ sessionId: "sess-nojob" }));
    expect(res.status).toBe(422);
  });

  it("returns 404 when session not found", async () => {
    // No entry in mockSupabaseRows for this session — single() returns error
    const res = await classifyJobPOST(makeRequest({ sessionId: "sess-missing" }));
    expect(res.status).toBe(404);
  });
});

// ─── /api/tools/price-job ────────────────────────────────────────────────────

describe("POST /api/tools/price-job", () => {
  it("returns 400 when neither jobId nor sessionId provided", async () => {
    const res = await priceJobPOST(emptyRequest());
    expect(res.status).toBe(400);
  });

  it("resolves jobId from sessionId", async () => {
    mockSupabaseRows["call_sessions:sess-y"] = { job_id: "job-y" };
    mockPriceJob.mockResolvedValue({
      success: true,
      estimate: {
        calloutFeePence: 8000,
        repairEstimateMinPence: 10000,
        repairEstimateMaxPence: 30000,
        currency: "gbp",
        explanation: "The call-out fee is £80...",
      },
      alreadyDone: false,
    });

    const res = await priceJobPOST(makeRequest({ sessionId: "sess-y" }));
    expect(res.status).toBe(200);
    expect(mockPriceJob).toHaveBeenCalledWith("job-y");
  });

  it("returns 422 when job is not classified yet", async () => {
    mockPriceJob.mockResolvedValue({
      success: false,
      error: "not_classified",
      message: "not classified",
    });

    const res = await priceJobPOST(makeRequest({ jobId: "job-unclassified" }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("not_classified");
  });

  it("returns price estimate fields on success", async () => {
    mockPriceJob.mockResolvedValue({
      success: true,
      estimate: {
        calloutFeePence: 15000,
        repairEstimateMinPence: 15000,
        repairEstimateMaxPence: 45000,
        currency: "gbp",
        explanation: "The call-out fee is £150...",
      },
      alreadyDone: false,
    });

    const res = await priceJobPOST(makeRequest({ jobId: "job-priced" }));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      calloutFeePence: number;
      explanation: string;
      alreadyDone: boolean;
    };
    expect(body.calloutFeePence).toBe(15000);
    expect(body.explanation).toContain("£150");
    expect(body.alreadyDone).toBe(false);
  });

  it("returns alreadyDone: true for idempotent call", async () => {
    mockPriceJob.mockResolvedValue({
      success: true,
      estimate: {
        calloutFeePence: 8000,
        repairEstimateMinPence: 10000,
        repairEstimateMaxPence: 30000,
        currency: "gbp",
        explanation: "Previously priced.",
      },
      alreadyDone: true,
    });

    const res = await priceJobPOST(makeRequest({ jobId: "job-already-priced" }));
    const body = await res.json() as { alreadyDone: boolean };
    expect(body.alreadyDone).toBe(true);
  });
});
