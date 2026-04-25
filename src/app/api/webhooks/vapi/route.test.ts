/**
 * Vapi Webhook Route tests
 *
 * Tests the HTTP layer: auth, body parsing, event routing, status codes, and
 * response shapes.  The service layer is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock functions ───────────────────────────────────────────────────

const { mockHandleVapiMessage } = vi.hoisted(() => ({
  mockHandleVapiMessage: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/config/app-config", () => ({
  appConfig: {
    serviceCredentials: {
      vapi: { apiKey: "vapi_key", webhookSecret: "test-secret-123" },
    },
    appUrl: "http://localhost:3000",
  },
}));

vi.mock("@/server/services/vapi-webhook-service", () => ({
  handleVapiMessage: mockHandleVapiMessage,
}));

import { POST } from "./route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  body: unknown,
  opts: { authorization?: string; xVapiSecret?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.authorization !== undefined) headers["authorization"] = opts.authorization;
  if (opts.xVapiSecret !== undefined) headers["x-vapi-secret"] = opts.xVapiSecret;

  return new Request("http://localhost:3000/api/webhooks/vapi", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function vapiBody(type: string, extra: Record<string, unknown> = {}) {
  return { message: { type, call: { id: "call-abc" }, ...extra } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleVapiMessage.mockResolvedValue({ type: "ignored", eventType: "unknown" });
});

// ─── Auth ──────────────────────────────────────────────────────────────────────

describe("Auth", () => {
  it("returns 401 when no auth header is provided", async () => {
    const req = makeRequest(vapiBody("status-update"));
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/unauthorised/i);
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const req = makeRequest(vapiBody("status-update"), { authorization: "Bearer wrong-secret" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 when Authorization: Bearer token matches secret", async () => {
    const req = makeRequest(vapiBody("status-update"), {
      authorization: "Bearer test-secret-123",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns 200 when X-Vapi-Secret header matches secret (legacy)", async () => {
    const req = makeRequest(vapiBody("status-update"), { xVapiSecret: "test-secret-123" });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns 401 when X-Vapi-Secret is wrong", async () => {
    const req = makeRequest(vapiBody("status-update"), { xVapiSecret: "bad-secret" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// Helper to make an authorised request throughout the remaining tests
function authedRequest(body: unknown) {
  return makeRequest(body, { authorization: "Bearer test-secret-123" });
}

// ─── Body parsing ──────────────────────────────────────────────────────────────

describe("Body parsing", () => {
  it("returns 400 for an empty body", async () => {
    const req = new Request("http://localhost:3000/api/webhooks/vapi", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-secret-123" },
      body: "",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const req = new Request("http://localhost:3000/api/webhooks/vapi", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-secret-123" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when message.type is missing", async () => {
    const req = authedRequest({ message: {} });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/message\.type/i);
  });

  it("returns 400 when message field itself is absent", async () => {
    const req = authedRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Event routing ─────────────────────────────────────────────────────────────

describe("Event routing", () => {
  it("passes the parsed message to handleVapiMessage", async () => {
    const req = authedRequest(vapiBody("status-update", { status: "ended" }));
    await POST(req);
    expect(mockHandleVapiMessage).toHaveBeenCalledOnce();
    const [msg] = mockHandleVapiMessage.mock.calls[0] as [{ type: string; status: string }];
    expect(msg.type).toBe("status-update");
    expect(msg.status).toBe("ended");
  });

  it("returns 200 { received: true } for informational events", async () => {
    mockHandleVapiMessage.mockResolvedValue({
      type: "event",
      result: { success: true, action: "call_started" },
    });
    const req = authedRequest(vapiBody("status-update", { status: "in-progress" }));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it("returns 200 { received: true } for ignored event types", async () => {
    mockHandleVapiMessage.mockResolvedValue({ type: "ignored", eventType: "speech-update" });
    const req = authedRequest(vapiBody("speech-update"));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it("returns 200 { received: true } even when event handler reports an error", async () => {
    mockHandleVapiMessage.mockResolvedValue({
      type: "event",
      result: { success: false, error: "missing_call_id", message: "No call.id" },
    });
    const req = authedRequest(vapiBody("status-update", { status: "ended" }));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});

// ─── Tool-calls response ───────────────────────────────────────────────────────

describe("Tool-calls response", () => {
  it("returns results array for tool-calls events", async () => {
    const results = [
      { toolCallId: "tc-1", result: JSON.stringify({ success: true, sessionId: "s-1" }) },
    ];
    mockHandleVapiMessage.mockResolvedValue({ type: "tool-calls", result: { success: true, results } });

    const req = authedRequest(vapiBody("tool-calls", { toolCallList: [{ id: "tc-1", name: "create-call-session", parameters: {} }] }));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toEqual(results);
    expect(json.received).toBeUndefined();
  });

  it("returns empty results array when tool dispatch reports failure", async () => {
    mockHandleVapiMessage.mockResolvedValue({
      type: "tool-calls",
      result: { success: false, error: "no_tool_calls", message: "empty" },
    });

    const req = authedRequest(vapiBody("tool-calls"));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toEqual([]);
  });
});

// ─── Unhandled errors ─────────────────────────────────────────────────────────

describe("Unhandled errors", () => {
  it("returns 200 even when handleVapiMessage throws", async () => {
    mockHandleVapiMessage.mockRejectedValue(new Error("Unexpected crash"));
    const req = authedRequest(vapiBody("status-update"));
    const res = await POST(req);
    // Must return 200 so Vapi doesn't retry
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});
