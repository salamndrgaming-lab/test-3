import { handleStripeWebhookRequest } from "@/lib/webhooks/http";
import { SupabaseWebhookStore } from "@/lib/webhooks/supabase-store";

// Stripe needs the raw body for signature verification.
export const dynamic = "force-dynamic";

/**
 * Stripe Connect webhook endpoint.
 * Handles charge.dispute.created / updated / closed with signature
 * verification and per-event idempotency.
 */
export async function POST(request: Request) {
  return handleStripeWebhookRequest(request, new SupabaseWebhookStore());
}
