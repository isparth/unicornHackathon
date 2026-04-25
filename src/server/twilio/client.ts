/**
 * Twilio SDK singleton.
 *
 * Returns a configured Twilio client using credentials from appConfig.
 * Throws a clear error at call time (not at module load) if credentials are
 * missing, so tests that mock the SMS service are not affected.
 *
 * Usage:
 *   import { getTwilioClient } from "@/server/twilio/client";
 *   const twilio = getTwilioClient();
 */

import Twilio from "twilio";
import { appConfig } from "@/config/app-config";

let _client: ReturnType<typeof Twilio> | null = null;

export function getTwilioClient(): ReturnType<typeof Twilio> {
  if (_client) return _client;

  const { accountSid, authToken } = appConfig.serviceCredentials.twilio;
  if (!accountSid || !authToken) {
    throw new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set to use the SMS service.",
    );
  }

  _client = Twilio(accountSid, authToken);
  return _client;
}

/** Reset the singleton — only for use in tests. */
export function _resetTwilioClient(): void {
  _client = null;
}
