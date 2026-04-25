import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyseJobImages,
  parseImageFindings,
  VISION_MODEL,
  type OpenAIClient,
  type ImageFindings,
} from "./image-analysis-service";

// ─── Supabase mock ─────────────────────────────────────────────────────────────
//
// A flexible mock that lets each test configure:
//   - Which assets the DB returns for the job
//   - Whether the signed URL call succeeds
//   - A spy to inspect update() calls
//
// The mock simulates a minimal Supabase client shape. We keep it simple:
// select() → returns assets, update() → records calls for assertions.

type MockAsset = {
  id: string;
  storage_path: string;
  analysis_status: string | null;
};

type MockDB = {
  assets: MockAsset[];
  assetsError?: { message: string } | null;
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
  updateCalls: Array<{ table: string; data: Record<string, unknown>; filter: string }>;
};

let mockDB: MockDB = { assets: [], updateCalls: [] };

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col1: string, _val1: unknown) => ({
          eq: (_col2: string, _val2: unknown) => ({
            // uploaded_assets select — resolves with configured assets
            then: undefined as unknown,
            // Make the chain awaitable
            [Symbol.asyncIterator]: undefined,
          }),
          // jobs update chain
          [Symbol.asyncIterator]: undefined,
          then: undefined as unknown,
        }),
        single: () => Promise.resolve({ data: null, error: null }),
      }),
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          mockDB.updateCalls.push({ table, data, filter: `${col}=${String(val)}` });
          return Promise.resolve({ error: null });
        },
      }),
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "new" }, error: null }) }),
      }),
    }),
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (_path: string, _expiry: number) => {
          if (mockDB.signedUrlError) {
            return Promise.resolve({ data: null, error: mockDB.signedUrlError });
          }
          return Promise.resolve({
            data: { signedUrl: mockDB.signedUrl ?? "https://example.com/photo.jpg" },
            error: null,
          });
        },
      }),
    },
  }),
}));

// Override the from().select().eq().eq() chain for uploaded_assets queries.
// We use a separate targeted mock because the nested eq chain is more complex.

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () =>
    buildSupabaseMock(),
}));

function buildSupabaseMock() {
  return {
    from: (table: string) => {
      if (table === "uploaded_assets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: mockDB.assetsError ? null : mockDB.assets,
                  error: mockDB.assetsError ?? null,
                }),
            }),
          }),
          update: (data: Record<string, unknown>) => ({
            eq: (col: string, val: unknown) => {
              mockDB.updateCalls.push({ table, data, filter: `${col}=${String(val)}` });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "jobs") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          update: (data: Record<string, unknown>) => ({
            eq: (col: string, val: unknown) => {
              mockDB.updateCalls.push({ table, data, filter: `${col}=${String(val)}` });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        update: (data: Record<string, unknown>) => ({
          eq: (col: string, val: unknown) => {
            mockDB.updateCalls.push({ table, data, filter: `${col}=${String(val)}` });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (_path: string, _expiry: number) => {
          if (mockDB.signedUrlError) {
            return Promise.resolve({ data: null, error: mockDB.signedUrlError });
          }
          return Promise.resolve({
            data: { signedUrl: mockDB.signedUrl ?? "https://example.com/photo.jpg" },
            error: null,
          });
        },
      }),
    },
  };
}

// ─── OpenAI mock helpers ───────────────────────────────────────────────────────

function makeVisionMock(returnJson: object): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(returnJson) } }],
        }),
      },
    } as unknown as OpenAIClient["chat"],
  };
}

function makeVisionErrorMock(message: string): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(new Error(message)),
      },
    } as unknown as OpenAIClient["chat"],
  };
}

function makeVisionEmptyMock(): OpenAIClient {
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

const JOB_ID = "job-test-111";

const GOOD_FINDINGS_JSON = {
  description: "A boiler with visible corrosion on the heat exchanger.",
  defectsObserved: "Heavy rust and calcium deposits on the heat exchanger.",
  severity: "high",
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDB = {
    assets: [],
    assetsError: null,
    signedUrl: "https://example.com/photo.jpg",
    signedUrlError: null,
    updateCalls: [],
  };
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// parseImageFindings
// ────────────────────────────────────────────────────────────────────────────

describe("parseImageFindings", () => {
  it("parses a valid findings object", () => {
    const raw = JSON.stringify(GOOD_FINDINGS_JSON);
    const result = parseImageFindings(raw);
    expect(result).not.toBeNull();
    expect(result?.description).toBe(GOOD_FINDINGS_JSON.description);
    expect(result?.severity).toBe("high");
  });

  it("accepts null for defectsObserved and severity", () => {
    const raw = JSON.stringify({
      description: "Radiator valve in good condition.",
      defectsObserved: null,
      severity: null,
    });
    const result = parseImageFindings(raw);
    expect(result).not.toBeNull();
    expect(result?.defectsObserved).toBeNull();
    expect(result?.severity).toBeNull();
  });

  it("trims description and defectsObserved whitespace", () => {
    const raw = JSON.stringify({
      description: "  Leaking pipe.  ",
      defectsObserved: "  Water staining.  ",
      severity: "medium",
    });
    const result = parseImageFindings(raw);
    expect(result?.description).toBe("Leaking pipe.");
    expect(result?.defectsObserved).toBe("Water staining.");
  });

  it("normalises empty-string defectsObserved to null", () => {
    const raw = JSON.stringify({
      description: "Pipe joint.",
      defectsObserved: "  ",
      severity: null,
    });
    const result = parseImageFindings(raw);
    expect(result?.defectsObserved).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseImageFindings("not json")).toBeNull();
  });

  it("returns null when description is missing", () => {
    const raw = JSON.stringify({ defectsObserved: null, severity: null });
    expect(parseImageFindings(raw)).toBeNull();
  });

  it("returns null when description is empty string", () => {
    const raw = JSON.stringify({ description: "", defectsObserved: null, severity: null });
    expect(parseImageFindings(raw)).toBeNull();
  });

  it("returns null when severity is an invalid value", () => {
    const raw = JSON.stringify({
      description: "Something.",
      defectsObserved: null,
      severity: "critical",
    });
    expect(parseImageFindings(raw)).toBeNull();
  });

  it("accepts all valid severity values", () => {
    for (const sev of ["low", "medium", "high", null]) {
      const raw = JSON.stringify({ description: "X.", defectsObserved: null, severity: sev });
      const result = parseImageFindings(raw);
      expect(result?.severity).toBe(sev);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// analyseJobImages — no images
// ────────────────────────────────────────────────────────────────────────────

describe("analyseJobImages — no images", () => {
  it("returns zeroed counts when there are no assets", async () => {
    mockDB.assets = [];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.analysed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.outcomes).toHaveLength(0);
  });

  it("does not call OpenAI when there are no assets", async () => {
    mockDB.assets = [];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// analyseJobImages — happy path (single asset)
// ────────────────────────────────────────────────────────────────────────────

describe("analyseJobImages — happy path", () => {
  const asset = { id: "asset-1", storage_path: "session-abc/photo.jpg", analysis_status: "pending" };

  beforeEach(() => {
    mockDB.assets = [asset];
  });

  it("returns analysed=1 and jobStatus=done on success", async () => {
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.analysed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.jobStatus).toBe("done");
  });

  it("returns the correct findings in the outcome", async () => {
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    const outcome = result.outcomes[0];
    expect(outcome.status).toBe("done");
    if (outcome.status !== "done") return;
    expect(outcome.findings.description).toBe(GOOD_FINDINGS_JSON.description);
    expect(outcome.findings.severity).toBe("high");
    expect(outcome.findings.rawModelOutput).toBeTruthy();
  });

  it("marks the asset as 'processing' then 'done' in the DB", async () => {
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    const assetUpdates = mockDB.updateCalls.filter((c) => c.table === "uploaded_assets");
    const statuses = assetUpdates.map((c) => c.data.analysis_status as string);
    expect(statuses).toContain("processing");
    expect(statuses).toContain("done");
  });

  it("writes image_analysis_context to the job record", async () => {
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    const jobUpdate = mockDB.updateCalls.find(
      (c) => c.table === "jobs" && c.data.image_analysis_status === "done",
    );
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate?.data.image_analysis_context).toBeDefined();
    const ctx = jobUpdate?.data.image_analysis_context as Record<string, unknown>;
    expect(ctx.successCount).toBe(1);
    expect(Array.isArray(ctx.findings)).toBe(true);
  });

  it("calls OpenAI exactly once per pending asset", async () => {
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("passes the vision model from VISION_MODEL constant", async () => {
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    expect(openai.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: VISION_MODEL }),
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// analyseJobImages — idempotency
// ────────────────────────────────────────────────────────────────────────────

describe("analyseJobImages — idempotency", () => {
  it("skips assets that are already 'done'", async () => {
    mockDB.assets = [
      { id: "asset-1", storage_path: "path/photo1.jpg", analysis_status: "done" },
    ];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.skipped).toBe(1);
    expect(result.analysed).toBe(0);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it("re-attempts assets that are 'failed'", async () => {
    mockDB.assets = [
      { id: "asset-1", storage_path: "path/photo1.jpg", analysis_status: "failed" },
    ];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.analysed).toBe(1);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("re-attempts assets that are 'processing' (crashed mid-run)", async () => {
    mockDB.assets = [
      { id: "asset-1", storage_path: "path/photo1.jpg", analysis_status: "processing" },
    ];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.analysed).toBe(1);
  });

  it("mixed: skips done assets but processes pending ones", async () => {
    mockDB.assets = [
      { id: "asset-done", storage_path: "path/done.jpg", analysis_status: "done" },
      { id: "asset-pending", storage_path: "path/pending.jpg", analysis_status: "pending" },
    ];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.skipped).toBe(1);
    expect(result.analysed).toBe(1);
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// analyseJobImages — failure paths (non-blocking contract)
// ────────────────────────────────────────────────────────────────────────────

describe("analyseJobImages — failure paths", () => {
  const pendingAsset = {
    id: "asset-1",
    storage_path: "session/photo.jpg",
    analysis_status: "pending",
  };

  it("returns failed outcome when OpenAI throws — does not re-throw", async () => {
    mockDB.assets = [pendingAsset];
    const openai = makeVisionErrorMock("Rate limit exceeded");
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.failed).toBe(1);
    expect(result.jobStatus).toBe("failed");
    const outcome = result.outcomes[0];
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("Rate limit exceeded");
  });

  it("marks the asset as 'failed' in the DB when OpenAI throws", async () => {
    mockDB.assets = [pendingAsset];
    const openai = makeVisionErrorMock("Network error");
    await analyseJobImages(JOB_ID, openai);

    const assetUpdates = mockDB.updateCalls.filter((c) => c.table === "uploaded_assets");
    expect(assetUpdates.some((c) => c.data.analysis_status === "failed")).toBe(true);
  });

  it("returns failed outcome when OpenAI returns empty content", async () => {
    mockDB.assets = [pendingAsset];
    const openai = makeVisionEmptyMock();
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.failed).toBe(1);
    expect(result.jobStatus).toBe("failed");
  });

  it("returns failed outcome when OpenAI returns invalid JSON shape", async () => {
    mockDB.assets = [pendingAsset];
    const openai = makeVisionMock({ wrong_field: "oops" });
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.failed).toBe(1);
    expect(result.jobStatus).toBe("failed");
  });

  it("returns failed outcome when storage signed URL fails", async () => {
    mockDB.assets = [pendingAsset];
    mockDB.signedUrlError = { message: "Permission denied" };
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.failed).toBe(1);
    expect(result.jobStatus).toBe("failed");
    const outcome = result.outcomes[0];
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("Permission denied");
  });

  it("never throws even when OpenAI fails for every asset", async () => {
    mockDB.assets = [
      { id: "a1", storage_path: "p1.jpg", analysis_status: "pending" },
      { id: "a2", storage_path: "p2.jpg", analysis_status: "pending" },
    ];
    const openai = makeVisionErrorMock("Timeout");

    await expect(analyseJobImages(JOB_ID, openai)).resolves.toBeDefined();
  });

  it("handles DB asset query error gracefully (never throws)", async () => {
    mockDB.assetsError = { message: "DB connection lost" };
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);

    const result = await analyseJobImages(JOB_ID, openai);
    expect(result.jobStatus).toBe("failed");
    expect(result.outcomes).toHaveLength(0);
  });

  it("sets jobStatus to 'failed' when some assets fail and some succeed", async () => {
    mockDB.assets = [
      { id: "a1", storage_path: "ok.jpg", analysis_status: "pending" },
      { id: "a2", storage_path: "bad.jpg", analysis_status: "pending" },
    ];

    let callCount = 0;
    const mixedOpenAI: OpenAIClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 2) {
              return Promise.reject(new Error("Vision failed"));
            }
            return Promise.resolve({
              choices: [{ message: { content: JSON.stringify(GOOD_FINDINGS_JSON) } }],
            });
          }),
        },
      } as unknown as OpenAIClient["chat"],
    };

    const result = await analyseJobImages(JOB_ID, mixedOpenAI);
    expect(result.analysed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.jobStatus).toBe("failed");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// analyseJobImages — multiple assets, all succeed
// ────────────────────────────────────────────────────────────────────────────

describe("analyseJobImages — multiple assets", () => {
  it("analyses all pending assets and aggregates findings", async () => {
    mockDB.assets = [
      { id: "a1", storage_path: "photo1.jpg", analysis_status: "pending" },
      { id: "a2", storage_path: "photo2.jpg", analysis_status: "pending" },
      { id: "a3", storage_path: "photo3.jpg", analysis_status: "pending" },
    ];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    const result = await analyseJobImages(JOB_ID, openai);

    expect(result.analysed).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.jobStatus).toBe("done");
    expect(result.outcomes).toHaveLength(3);
  });

  it("includes all successful findings in image_analysis_context", async () => {
    mockDB.assets = [
      { id: "a1", storage_path: "photo1.jpg", analysis_status: "pending" },
      { id: "a2", storage_path: "photo2.jpg", analysis_status: "pending" },
    ];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    const jobDoneUpdate = mockDB.updateCalls.find(
      (c) => c.table === "jobs" && c.data.image_analysis_status === "done",
    );
    expect(jobDoneUpdate).toBeDefined();
    const ctx = jobDoneUpdate?.data.image_analysis_context as Record<string, unknown>;
    expect(ctx.successCount).toBe(2);
    expect((ctx.findings as unknown[]).length).toBe(2);
  });

  it("does not overwrite any job fields other than image_analysis_status and image_analysis_context", async () => {
    mockDB.assets = [{ id: "a1", storage_path: "photo1.jpg", analysis_status: "pending" }];
    const openai = makeVisionMock(GOOD_FINDINGS_JSON);
    await analyseJobImages(JOB_ID, openai);

    const jobUpdates = mockDB.updateCalls.filter((c) => c.table === "jobs");
    for (const u of jobUpdates) {
      expect(Object.keys(u.data)).not.toContain("problem_summary");
      expect(Object.keys(u.data)).not.toContain("status");
      expect(Object.keys(u.data)).not.toContain("required_skill");
      expect(Object.keys(u.data)).not.toContain("urgency");
    }
  });
});
