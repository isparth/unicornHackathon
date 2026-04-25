import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateIntakeToken,
  verifyIntakeToken,
} from "./intake-token-service";

const SECRET = "test-secret-at-least-32-chars-long!!";
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

describe("generateIntakeToken", () => {
  it("returns a token string and an expiry date", () => {
    const { token, expiresAt } = generateIntakeToken(SESSION_ID, SECRET, 30);
    expect(typeof token).toBe("string");
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(expiresAt).toBeInstanceOf(Date);
  });

  it("sets expiry approximately expiryMinutes from now", () => {
    const before = Date.now();
    const { expiresAt } = generateIntakeToken(SESSION_ID, SECRET, 30);
    const after = Date.now();
    const expiryMs = expiresAt.getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + 30 * 60 * 1000 + 100);
  });

  it("throws when secret is empty", () => {
    expect(() => generateIntakeToken(SESSION_ID, "", 30)).toThrow();
  });

  it("produces different tokens for different session IDs", () => {
    const { token: t1 } = generateIntakeToken("session-a", SECRET, 30);
    const { token: t2 } = generateIntakeToken("session-b", SECRET, 30);
    expect(t1).not.toBe(t2);
  });
});

describe("verifyIntakeToken", () => {
  it("returns valid=true with correct payload for a fresh token", () => {
    const { token } = generateIntakeToken(SESSION_ID, SECRET, 30);
    const result = verifyIntakeToken(token, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sessionId).toBe(SESSION_ID);
      expect(typeof result.payload.expiresAt).toBe("number");
    }
  });

  it("returns valid=false reason=invalid for a tampered token", () => {
    const { token } = generateIntakeToken(SESSION_ID, SECRET, 30);
    const tampered = token.slice(0, -4) + "XXXX";
    const result = verifyIntakeToken(tampered, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("invalid");
  });

  it("returns valid=false reason=invalid when signed with wrong secret", () => {
    const { token } = generateIntakeToken(SESSION_ID, SECRET, 30);
    const result = verifyIntakeToken(token, "wrong-secret");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("invalid");
  });

  it("returns valid=false reason=expired for a token past its expiry", () => {
    const { token } = generateIntakeToken(SESSION_ID, SECRET, 30);

    // Advance time by 31 minutes
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);

    const result = verifyIntakeToken(token, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");

    vi.useRealTimers();
  });

  it("returns valid=false reason=invalid for an empty token", () => {
    const result = verifyIntakeToken("", SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("invalid");
  });

  it("returns valid=false reason=invalid for a completely malformed string", () => {
    const result = verifyIntakeToken("not.a.valid.token.format", SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("invalid");
  });
});

afterEach(() => {
  vi.useRealTimers();
});
