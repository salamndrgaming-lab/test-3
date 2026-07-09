import { after } from "next/server";

import { generateResponseForDispute } from "@/lib/ai/engine";
import { gatherEvidenceForDispute } from "@/lib/evidence/service";
import { handleStripeWebhookRequest } from "@/lib/webhooks/http";
import { SupabaseWebhookStore } from "@/lib/webhooks/supabase-store";

// Stripe needs the raw body for signature verification.
export const dynamic = "force-dynamic";
// Evidence gathering + two AI passes run post-response via after().
export const maxDuration = 300;

/**
 * Stripe Connect webhook endpoint.
 * Handles charge.dispute.created / updated / closed with signature
 * verification and per-event idempotency. For new disputes, evidence
 * gathering and the two-pass AI response run post-response via after()
 * so Stripe gets a fast ack; the daily sweep cron retries stragglers.
 */
export async function POST(request: Request) {
  return handleStripeWebhookRequest(request, new SupabaseWebhookStore(), (disputeId) => {
    after(async () => {
      const gathered = await gatherEvidenceForDispute(disputeId);
      if (!gathered.ok) {
        console.error(`Post-webhook evidence gathering failed: ${gathered.error}`);
        return;
      }
      const drafted = await generateResponseForDispute(disputeId);
      if (!drafted.ok) {
        console.error(
          `Post-webhook response generation for ${disputeId}: ${drafted.skipped ?? drafted.error}`
        );
      }
    });
  });
}
