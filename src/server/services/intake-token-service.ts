/**
 * Intake Form Token Service
 *
 * Produces and verifies short-lived HMAC-SHA256-signed tokens for the
 * customer intake form.  A token encodes the call session ID and an expiry
 * timestamp so it can be validated server-side without a database lookup.
 *
 * Token format (URL-safe base64, dot-separated):
 *   <payload_b64>.<signature_b64>
 *
 * Payload (JSON, base64url-encoded):
 *   { sessionId: string; expiresAt: number }   // expiresAt = Unix ms
 */

import { createHmac, timingSafeEqual } from "crypto";

export type IntakeTokenPayload = {
  sessionId: string;
  expiresAt: number; // Unix timestamp in milliseconds
};

export type VerifyTokenResult =
  | { valid: true; payload: IntakeTokenPayload }
  | { valid: false; reason: "expired" | "invalid" };

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function fromBase64Url(value: string): string {
  // Restore padding and standard chars before decoding
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padding), "base64").toString("utf8");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Generate a signed intake token for a given call session.
 *
 * @param sessionId - The call_sessions.id this token is tied to.
 * @param secret    - The HMAC signing secret (from INTAKE_TOKEN_SECRET env var).
 * @param expiryMinutes - How long the token should be valid for.
 * @returns An opaque URL-safe token string.
 */
export function generateIntakeToken(
  sessionId: string,
  secret: string,
  expiryMinutes: number,
): { token: string; expiresAt: Date } {
  if (!secret) {
    throw new Error("INTAKE_TOKEN_SECRET is not configured.");
  }

  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  const payload: IntakeTokenPayload = {
    sessionId,
    expiresAt: expiresAt.getTime(),
  };

  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadB64, secret);
  const token = `${payloadB64}.${signature}`;

  return { token, expiresAt };
}

/**
 * Verify a token and return its payload.  Never throws — returns a
 * typed result instead so the caller can handle each failure mode.
 *
 * @param token  - The raw token string from the URL.
 * @param secret - The HMAC signing secret.
 */
export function verifyIntakeToken(
  token: string,
  secret: string,
): VerifyTokenResult {
  if (!secret || !token) {
    return { valid: false, reason: "invalid" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "invalid" };
  }

  const [payloadB64, receivedSig] = parts as [string, string];

  // Constant-time comparison to prevent timing attacks
  const expectedSig = sign(payloadB64, secret);
  let sigOk: boolean;
  try {
    sigOk = timingSafeEqual(
      Buffer.from(receivedSig, "base64url"),
      Buffer.from(expectedSig, "base64url"),
    );
  } catch {
    return { valid: false, reason: "invalid" };
  }

  if (!sigOk) {
    return { valid: false, reason: "invalid" };
  }

  let payload: IntakeTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64)) as IntakeTokenPayload;
  } catch {
    return { valid: false, reason: "invalid" };
  }

  if (
    typeof payload.sessionId !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    return { valid: false, reason: "invalid" };
  }

  if (Date.now() > payload.expiresAt) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
