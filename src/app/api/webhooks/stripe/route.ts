/**
 * POST /api/webhooks/stripe
 *
 * Receives and processes Stripe webhook events.
 *
 * Security:
 *   - Every request is verified using the Stripe-Signature header and the
 *     STRIPE_WEBHOOK_SECRET env var. Requests with invalid or missing
 *     signatures are rejected with 400.
 *   - The raw request body (not parsed JSON) is used for verification —
 *     Next.js must not parse it before we read it.
 *
 * Idempotency:
 *   - The webhook service functions are all idempotent. Stripe guarantees
 *     at-least-once delivery so duplicate events are expected and handled
 *     gracefully (alreadyProcessed: true).
 *
 * Events handled:
 *   checkout.session.completed    → payment succeeded → job confirmed
 *   checkout.session.expired      → session timed out → job back to slot_held
 *   payment_intent.payment_failed → card declined     → job back to slot_held
 *
 * All other events return 200 immediately (Stripe requires a 2xx to stop
 * retrying — returning 4xx/5xx for unknown events would cause infinite retries).
 *
 * Next.js config note:
 *   We disable body parsing for this route so we can read the raw bytes
 *   needed for Stripe signature verification. See the exported `config` below.
 */

import { NextResponse } from "next/server";
import { getStripeClient } from "@/server/stripe/client";
import { appConfig } from "@/config/app-config";
import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
  handlePaymentIntentFailed,
} from "@/server/services/webhook-service";
import type Stripe from "stripe";

// Tell Next.js not to parse the body — Stripe needs the raw bytes to verify
// the signature.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Read raw body
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const webhookSecret = appConfig.serviceCredentials.stripe.webhookSecret;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // 2. Verify signature
  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] Signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  console.log(`[stripe-webhook] Received event: ${event.type} (${event.id})`);

  // 3. Route to the correct handler
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only handle payment-mode sessions (not subscription)
        if (session.mode !== "payment") break;

        const result = await handleCheckoutSessionCompleted(
          session.id,
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
        );

        if (!result.success && result.error !== "payment_not_found") {
          console.error(`[stripe-webhook] checkout.session.completed failed:`, result.message);
          return NextResponse.json({ error: result.message }, { status: 500 });
        }

        console.log(
          `[stripe-webhook] checkout.session.completed → ${result.success ? (result.alreadyProcessed ? "already processed" : "confirmed") : result.error}`,
        );
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;

        const result = await handleCheckoutSessionExpired(session.id);

        if (!result.success && result.error !== "payment_not_found") {
          console.error(`[stripe-webhook] checkout.session.expired failed:`, result.message);
          return NextResponse.json({ error: result.message }, { status: 500 });
        }

        console.log(
          `[stripe-webhook] checkout.session.expired → ${result.success ? (result.alreadyProcessed ? "already processed" : "marked failed") : result.error}`,
        );
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;

        const result = await handlePaymentIntentFailed(intent.id);

        if (!result.success && result.error !== "payment_not_found") {
          console.error(`[stripe-webhook] payment_intent.payment_failed failed:`, result.message);
          return NextResponse.json({ error: result.message }, { status: 500 });
        }

        console.log(
          `[stripe-webhook] payment_intent.payment_failed → ${result.success ? (result.alreadyProcessed ? "already processed" : "marked failed") : result.error}`,
        );
        break;
      }

      default:
        // Unknown event type — acknowledge so Stripe stops retrying
        console.log(`[stripe-webhook] Unhandled event type: ${event.type} — acknowledged`);
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Unhandled error processing ${event.type}:`, message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Always return 200 to Stripe so it doesn't retry
  return NextResponse.json({ received: true });
}
