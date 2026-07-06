import Stripe from "stripe";

import { serverEnv } from "@/lib/env";

let cached: Stripe | null = null;

/** Platform Stripe client (our secret key, not the connected account's). */
export function stripe(): Stripe {
  if (cached) return cached;
  cached = new Stripe(serverEnv().STRIPE_SECRET_KEY, {
    appInfo: { name: "RecoveryEngine", version: "0.1.0" },
  });
  return cached;
}

/**
 * Verifies we can read disputes on a connected account. Returns the number
 * of disputes seen in the first page, or throws if access is denied.
 */
export async function verifyDisputeReadAccess(stripeAccountId: string) {
  const disputes = await stripe().disputes.list(
    { limit: 5 },
    { stripeAccount: stripeAccountId }
  );
  return disputes.data.length;
}
