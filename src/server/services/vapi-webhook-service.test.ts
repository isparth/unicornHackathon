/**
 * Vapi Webhook Service tests
 *
 * Tests all event handlers plus the top-level router.  The Supabase client,
 * Call Summary Service, and Image Analysis Service are all mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTranscriptText,
  handleCallStarted,
  handleCallEnded,
  handleEndOfCallReport,
  handleConversationUpdate,
  handleToolCalls,
  handleVapiMessage,
  type VapiStatusUpdateMessage,
  type VapiEndOfCallReportMessage,
  type VapiConversationUpdateMessage,
  type VapiToolCallsMessage,
} from "./vapi-webhook-service";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const {
  mockGenerateCallSummary,
  mockAnalyseJobImages,
  mockCreateCallSessionFromVapi,
} = vi.hoisted(() => ({
  mockGenerateCallSummary: vi.fn(),
  mockAnalyseJobImages: vi.fn(),
  mockCreateCallSessionFromVapi: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("./call-summary-service", () => ({
  generateCallSummary: mockGenerateCallSummary,
}));

vi.mock("./image-analysis-service", () => ({
  analyseJobImages: mockAnalyseJobImages,
}));

vi.mock("./vapi-call-session", () => ({
  createCallSessionFromVapi: mockCreateCallSessionFromVapi,
}));

// ─── Supabase mock ─────────────────────────────────────────────────────────────
//
// We configure per-test what maybeSingle() returns for call_sessions queries.

type MockSession = { id: string; job_id: string | null; transcript: string | null } | null;
type MockDB = {
  session: MockSession;
  updateCalls: Array<{ table: string; data: Record<string, unknown> }>;
  eventHistoryData: { event_history?: unknown[] } | null;
};

let mockDB: MockDB = {
  session: null,
  updateCalls: [],
  eventHistoryData: null,
};

vi.mock("@/server/supabase/client", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({ data: mockDB.session, error: null }),
          single: () => {
            // For event_history read inside appendEventHistory
            if (table === "call_sessions") {
              return Promise.resolve({ data: mockDB.eventHistoryData, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (data: Record<string, unknown>) => ({
        eq: (_col: string, _val: unknown) => {
          mockDB.updateCalls.push({ table, data });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const VAPI_CALL_ID = "vapi-call-abc";
const SESSION_ID = "session-xyz-123";
const JOB_ID = "job-456";

function makeSession(overrides: Partial<MockSession & object> = {}): NonNullable<MockSession> {
  return { id: SESSION_ID, job_id: JOB_ID, transcript: null, ...overrides };
}

// ─── buildTranscriptText ──────────────────────────────────────────────────────

describe("buildTranscriptText", () => {
  it("formats assistant and user messages correctly", () => {
    const messages = [
      { role: "assistant", message: "Hello, how can I help?" },
      { role: "user", message: "My boiler is broken." },
    ];
    const result = buildTranscriptText(messages);
    expect(result).toBe("Agent: Hello, how can I help?\nCustomer: My boiler is broken.");
  });

  it("uses content field when message is absent", () => {
    const messages = [{ role: "assistant", content: "How can I help?" }];
    const result = buildTranscriptText(messages);
    expect(result).toBe("Agent: How can I help?");
  });

  it("filters out messages with no text", () => {
    const messages = [
      { role: "assistant", message: "" },
      { role: "user", message: "Hi" },
    ];
    const result = buildTranscriptText(messages);
    expect(result).toBe("Customer: Hi");
  });

  it("returns empty string for an empty messages array", () => {
    expect(buildTranscriptText([])).toBe("");
  });

  it("trims whitespace from message text", () => {
    const messages = [{ role: "user", message: "  hello  " }];
    expect(buildTranscriptText(messages)).toBe("Customer: hello");
  });
});

// ─── handleCallStarted ────────────────────────────────────────────────────────

describe("handleCallStarted", () => {
  const event: VapiStatusUpdateMessage = {
    type: "status-update",
    status: "in-progress",
    call: { id: VAPI_CALL_ID },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = { session: null, updateCalls: [], eventHistoryData: null };
  });

  it("returns no_session_yet when no session exists for the call", async () => {
    mockDB.session = null;
    const result = await handleCallStarted(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("no_session_yet");
  });

  it("returns call_started and records the event when session exists", async () => {
    mockDB.session = makeSession();
    const result = await handleCallStarted(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("call_started");
  });

  it("returns error when call.id is missing", async () => {
    const badEvent = { type: "status-update" as const, status: "in-progress" as const };
    const result = await handleCallStarted(badEvent);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_call_id");
  });
});

// ─── handleCallEnded ──────────────────────────────────────────────────────────

describe("handleCallEnded", () => {
  const event: VapiStatusUpdateMessage = {
    type: "status-update",
    status: "ended",
    call: { id: VAPI_CALL_ID },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = { session: null, updateCalls: [], eventHistoryData: null };
    mockAnalyseJobImages.mockResolvedValue({ analysed: 0, skipped: 0, failed: 0, outcomes: [], jobStatus: "done" });
  });

  it("returns call_ended when session exists", async () => {
    mockDB.session = makeSession();
    const result = await handleCallEnded(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("call_ended");
  });

  it("returns no_session when no session exists", async () => {
    mockDB.session = null;
    const result = await handleCallEnded(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("no_session");
  });

  it("kicks off image analysis when session has a job_id", async () => {
    mockDB.session = makeSession({ job_id: JOB_ID });
    await handleCallEnded(event);
    // Image analysis is fire-and-forget — give it a tick to register
    await new Promise((r) => setTimeout(r, 0));
    expect(mockAnalyseJobImages).toHaveBeenCalledWith(JOB_ID);
  });

  it("does not call analyseJobImages when session has no job_id", async () => {
    mockDB.session = makeSession({ job_id: null });
    await handleCallEnded(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockAnalyseJobImages).not.toHaveBeenCalled();
  });

  it("returns error when call.id is missing", async () => {
    const badEvent = { type: "status-update" as const, status: "ended" as const };
    const result = await handleCallEnded(badEvent);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("missing_call_id");
  });
});

// ─── handleEndOfCallReport ────────────────────────────────────────────────────

describe("handleEndOfCallReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = { session: makeSession(), updateCalls: [], eventHistoryData: null };
    mockGenerateCallSummary.mockResolvedValue({ success: true, summary: "Boiler broken.", alreadyDone: false });
  });

  const baseEvent: VapiEndOfCallReportMessage = {
    type: "end-of-call-report",
    call: { id: VAPI_CALL_ID },
    endedReason: "hangup",
    artifact: {
      messages: [
        { role: "assistant", message: "Hello, how can I help?" },
        { role: "user", message: "My boiler stopped working." },
      ],
    },
  };

  it("returns summary_generated on success", async () => {
    const result = await handleEndOfCallReport(baseEvent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("summary_generated");
  });

  it("calls generateCallSummary with the session id", async () => {
    await handleEndOfCallReport(baseEvent);
    expect(mockGenerateCallSummary).toHaveBeenCalledWith(SESSION_ID);
  });

  it("writes the transcript built from messages to the DB", async () => {
    await handleEndOfCallReport(baseEvent);
    const transcriptWrite = mockDB.updateCalls.find(
      (c) => c.table === "call_sessions" && typeof c.data.transcript === "string",
    );
    expect(transcriptWrite).toBeDefined();
    expect(transcriptWrite?.data.transcript).toContain("Agent: Hello");
    expect(transcriptWrite?.data.transcript).toContain("Customer: My boiler stopped working.");
  });

  it("returns summary_already_done when summary already existed", async () => {
    mockGenerateCallSummary.mockResolvedValue({ success: true, summary: "existing", alreadyDone: true });
    const result = await handleEndOfCallReport(baseEvent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("summary_already_done");
  });

  it("falls back to artifact.transcript when messages array is absent", async () => {
    const fallbackEvent: VapiEndOfCallReportMessage = {
      ...baseEvent,
      artifact: { transcript: "Agent: Hi\nCustomer: Water leak." },
    };
    await handleEndOfCallReport(fallbackEvent);
    const transcriptWrite = mockDB.updateCalls.find(
      (c) => c.table === "call_sessions" && typeof c.data.transcript === "string",
    );
    expect(transcriptWrite?.data.transcript).toBe("Agent: Hi\nCustomer: Water leak.");
  });

  it("still returns success when generateCallSummary fails", async () => {
    mockGenerateCallSummary.mockResolvedValue({ success: false, error: "transcript_too_short", message: "too short" });
    const result = await handleEndOfCallReport(baseEvent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("transcript_written_summary_skipped");
  });

  it("returns no_session when no session exists", async () => {
    mockDB.session = null;
    const result = await handleEndOfCallReport(baseEvent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("no_session");
  });
});

// ─── handleConversationUpdate ─────────────────────────────────────────────────

describe("handleConversationUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = { session: makeSession(), updateCalls: [], eventHistoryData: null };
  });

  const event: VapiConversationUpdateMessage = {
    type: "conversation-update",
    call: { id: VAPI_CALL_ID },
    messages: [
      { role: "assistant", message: "How can I help?" },
      { role: "user", message: "Radiator leaking." },
    ],
  };

  it("writes the transcript to the DB", async () => {
    const result = await handleConversationUpdate(event);
    expect(result.success).toBe(true);
    const transcriptWrite = mockDB.updateCalls.find(
      (c) => c.table === "call_sessions" && typeof c.data.transcript === "string",
    );
    expect(transcriptWrite?.data.transcript).toContain("Customer: Radiator leaking.");
  });

  it("returns no_session_yet when no session exists", async () => {
    mockDB.session = null;
    const result = await handleConversationUpdate(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("no_session_yet");
  });

  it("returns no_messages when messages array is empty", async () => {
    const result = await handleConversationUpdate({ ...event, messages: [] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("no_messages");
  });

  it("returns empty_transcript when all messages have no text", async () => {
    const result = await handleConversationUpdate({
      ...event,
      messages: [{ role: "user", message: "  " }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.action).toBe("empty_transcript");
  });
});

// ─── handleToolCalls ──────────────────────────────────────────────────────────

describe("handleToolCalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = { session: makeSession(), updateCalls: [], eventHistoryData: null };
    mockCreateCallSessionFromVapi.mockResolvedValue({
      success: true,
      sessionId: SESSION_ID,
      intakeFormUrl: "http://localhost:3000/intake/token123",
      tokenExpiresAt: new Date().toISOString(),
    });
  });

  const baseEvent: VapiToolCallsMessage = {
    type: "tool-calls",
    call: { id: VAPI_CALL_ID, customer: { number: "+447000000000" } },
  };

  it("returns a results array with one entry per tool call", async () => {
    const event: VapiToolCallsMessage = {
      ...baseEvent,
      toolCallList: [
        {
          id: "tc-1",
          name: "create-call-session",
          parameters: {
            vapiCallId: VAPI_CALL_ID,
            serviceBusinessId: "biz-1",
            phoneNumber: "+447000000000",
          },
        },
      ],
    };
    const result = await handleToolCalls(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].toolCallId).toBe("tc-1");
  });

  it("uses toolWithToolCallList when toolCallList is absent", async () => {
    const event: VapiToolCallsMessage = {
      ...baseEvent,
      toolWithToolCallList: [
        {
          name: "create-call-session",
          toolCall: {
            id: "tc-2",
            parameters: { vapiCallId: VAPI_CALL_ID, serviceBusinessId: "biz-1", phoneNumber: "+447000000000" },
          },
        },
      ],
    };
    const result = await handleToolCalls(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.results[0].toolCallId).toBe("tc-2");
  });

  it("includes success payload in result string for create-call-session", async () => {
    const event: VapiToolCallsMessage = {
      ...baseEvent,
      toolCallList: [
        {
          id: "tc-3",
          name: "createCallSession",
          parameters: { vapiCallId: VAPI_CALL_ID, serviceBusinessId: "biz-1", phoneNumber: "+447000000000" },
        },
      ],
    };
    const result = await handleToolCalls(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const parsed = JSON.parse(result.results[0].result) as { success: boolean; sessionId: string };
    expect(parsed.success).toBe(true);
    expect(parsed.sessionId).toBe(SESSION_ID);
  });

  it("returns unknown_tool error for unrecognised tool names", async () => {
    const event: VapiToolCallsMessage = {
      ...baseEvent,
      toolCallList: [{ id: "tc-4", name: "nonExistentTool", parameters: {} }],
    };
    const result = await handleToolCalls(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const parsed = JSON.parse(result.results[0].result) as { error: string };
    expect(parsed.error).toBe("unknown_tool");
  });

  it("returns error result when createCallSessionFromVapi fails (does not throw)", async () => {
    mockCreateCallSessionFromVapi.mockResolvedValue({ success: false, error: "db_error", message: "DB down" });
    const event: VapiToolCallsMessage = {
      ...baseEvent,
      toolCallList: [
        {
          id: "tc-5",
          name: "create-call-session",
          parameters: { vapiCallId: VAPI_CALL_ID, serviceBusinessId: "biz-1", phoneNumber: "+447000000000" },
        },
      ],
    };
    const result = await handleToolCalls(event);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const parsed = JSON.parse(result.results[0].result) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("db_error");
  });

  it("returns no_tool_calls error when toolCallList is empty", async () => {
    const result = await handleToolCalls({ ...baseEvent, toolCallList: [], toolWithToolCallList: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no_tool_calls");
  });
});

// ─── handleVapiMessage (top-level router) ─────────────────────────────────────

describe("handleVapiMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB = { session: makeSession(), updateCalls: [], eventHistoryData: null };
    mockGenerateCallSummary.mockResolvedValue({ success: true, summary: "summary", alreadyDone: false });
    mockAnalyseJobImages.mockResolvedValue({ analysed: 0, skipped: 0, failed: 0, outcomes: [], jobStatus: "done" });
  });

  it("routes status-update in-progress to an event result", async () => {
    const msg: VapiStatusUpdateMessage = { type: "status-update", status: "in-progress", call: { id: VAPI_CALL_ID } };
    const outcome = await handleVapiMessage(msg);
    expect(outcome.type).toBe("event");
  });

  it("routes status-update ended to an event result", async () => {
    const msg: VapiStatusUpdateMessage = { type: "status-update", status: "ended", call: { id: VAPI_CALL_ID } };
    const outcome = await handleVapiMessage(msg);
    expect(outcome.type).toBe("event");
  });

  it("routes end-of-call-report to an event result", async () => {
    const msg: VapiEndOfCallReportMessage = {
      type: "end-of-call-report",
      call: { id: VAPI_CALL_ID },
      artifact: { messages: [{ role: "user", message: "Broken pipe." }] },
    };
    const outcome = await handleVapiMessage(msg);
    expect(outcome.type).toBe("event");
  });

  it("routes conversation-update to an event result", async () => {
    const msg: VapiConversationUpdateMessage = {
      type: "conversation-update",
      call: { id: VAPI_CALL_ID },
      messages: [{ role: "user", message: "Hi." }],
    };
    const outcome = await handleVapiMessage(msg);
    expect(outcome.type).toBe("event");
  });

  it("routes tool-calls to a tool-calls result", async () => {
    mockCreateCallSessionFromVapi.mockResolvedValue({ success: true, sessionId: "s1", intakeFormUrl: "http://x", tokenExpiresAt: "" });
    const msg: VapiToolCallsMessage = {
      type: "tool-calls",
      call: { id: VAPI_CALL_ID },
      toolCallList: [{ id: "tc-1", name: "create-call-session", parameters: { vapiCallId: VAPI_CALL_ID, serviceBusinessId: "b1", phoneNumber: "+447000000000" } }],
    };
    const outcome = await handleVapiMessage(msg);
    expect(outcome.type).toBe("tool-calls");
  });

  it("returns ignored for unhandled event types", async () => {
    const msg = { type: "speech-update", call: { id: VAPI_CALL_ID } };
    const outcome = await handleVapiMessage(msg);
    expect(outcome.type).toBe("ignored");
    if (outcome.type !== "ignored") return;
    expect(outcome.eventType).toBe("speech-update");
  });

  it("acknowledges non-ended status variants without error", async () => {
    for (const status of ["scheduled", "queued", "ringing", "forwarding"] as const) {
      const msg: VapiStatusUpdateMessage = { type: "status-update", status, call: { id: VAPI_CALL_ID } };
      const outcome = await handleVapiMessage(msg);
      expect(outcome.type).toBe("event");
    }
  });
});
