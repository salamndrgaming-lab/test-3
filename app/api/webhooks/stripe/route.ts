import { after } from "next/server";

import { gatherEvidenceForDispute } from "@/lib/evidence/service";
import { handleStripeWebhookRequest } from "@/lib/webhooks/http";
import { SupabaseWebhookStore } from "@/lib/webhooks/supabase-store";

// Stripe needs the raw body for signature verification.
export const dynamic = "force-dynamic";

/**
 * Stripe Connect webhook endpoint.
 * Handles charge.dispute.created / updated / closed with signature
 * verification and per-event idempotency. Evidence gathering for new
 * disputes runs post-response via after() so Stripe gets a fast ack;
 * the daily sweep cron retries any dispute stuck in 'new'.
 */
export async function POST(request: Request) {
  return handleStripeWebhookRequest(request, new SupabaseWebhookStore(), (disputeId) => {
    after(async () => {
      const result = await gatherEvidenceForDispute(disputeId);
      if (!result.ok) {
        console.error(`Post-webhook evidence gathering failed: ${result.error}`);
      }
    });
  });
}
