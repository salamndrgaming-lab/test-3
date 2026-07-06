import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { processStripeEvent } from "./handler";
import type { WebhookStore } from "./types";

/**
 * Verifies the Stripe signature on a webhook request and processes the
 * event. Separated from the route file so integration tests can inject a
 * store while still exercising real signature verification.
 */
export async function handleStripeWebhookRequest(
  request: Request,
  store: WebhookStore
): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing stripe-signature header" },
      { status: 400 }
    );
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      body,
      signature,
      serverEnv().STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(event, store);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    // Processing failed after the event was claimed: return 500 so Stripe
    // retries; the claim ledger marks it 'failed' and allows reprocessing.
    console.error(`Webhook processing failed for ${event.id}`, err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
