/**
 * Stripe SDK singleton.
 *
 * Returns a configured Stripe instance using the secret key from appConfig.
 * Throws a clear error at call time (not at module load) if the key is missing
 * so that tests that mock the payment service are not affected.
 *
 * Usage:
 *   import { getStripeClient } from "@/server/stripe/client";
 *   const stripe = getStripeClient();
 */

import Stripe from "stripe";
import { appConfig } from "@/config/app-config";

let _client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (_client) return _client;

  const key = appConfig.serviceCredentials.stripe.secretKey;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local to enable Stripe integration.",
    );
  }

  _client = new Stripe(key, {
    // Pin to the API version bundled with stripe@22.1.0.
    apiVersion: "2026-04-22.dahlia",
    typescript: true,
  });

  return _client;
}
