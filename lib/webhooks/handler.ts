import type Stripe from "stripe";

import {
  disputeChargeId,
  stripeDisputeSchema,
  type DisputeLifecycleStatus,
  type WebhookProcessResult,
  type WebhookStore,
} from "./types";

export const HANDLED_EVENTS = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

type HandledEventType = (typeof HANDLED_EVENTS)[number];

function isHandledEvent(type: string): type is HandledEventType {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

function toIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Processes a signature-verified Stripe event. Idempotent: each Stripe
 * event id is claimed exactly once; retries of failed deliveries are
 * reprocessed, already-processed duplicates are acknowledged and skipped.
 */
export async function processStripeEvent(
  event: Stripe.Event,
  store: WebhookStore
): Promise<WebhookProcessResult> {
  const stripeAccount = "account" in event ? ((event.account as string) ?? null) : null;

  const claim = await store.claimEvent({
    stripeEventId: event.id,
    type: event.type,
    stripeAccount,
    payload: event,
  });
  if (claim === "duplicate") {
    return { outcome: "duplicate" };
  }

  try {
    if (!isHandledEvent(event.type)) {
      await store.markEventProcessed(event.id);
      return { outcome: "ignored", reason: `unhandled event type ${event.type}` };
    }

    if (!stripeAccount) {
      // Dispute events must come from a connected account (Connect webhook).
      await store.markEventProcessed(event.id);
      return { outcome: "ignored", reason: "event has no connected account" };
    }

    const account = await store.findConnectedAccount(stripeAccount);
    if (!account) {
      // Not one of ours (e.g. deauthorized org). Acknowledge so Stripe
      // stops retrying, but record why.
      await store.markEventProcessed(event.id);
      return { outcome: "ignored", reason: `unknown connected account ${stripeAccount}` };
    }

    const dispute = stripeDisputeSchema.parse(event.data.object);
    const dueBy = dispute.evidence_details?.due_by;

    let lifecycleStatus: DisputeLifecycleStatus | null;
    switch (event.type) {
      case "charge.dispute.created":
        lifecycleStatus = "new";
        break;
      case "charge.dispute.updated":
        // Keep our pipeline status; only refresh Stripe-side fields.
        lifecycleStatus = null;
        break;
      case "charge.dispute.closed":
        lifecycleStatus = dispute.status === "won" ? "won" : "lost";
        break;
    }

    await store.upsertDispute({
      orgId: account.orgId,
      connectedAccountId: account.id,
      stripeDisputeId: dispute.id,
      stripeChargeId: disputeChargeId(dispute),
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      stripeStatus: dispute.status,
      evidenceDueBy: dueBy != null ? toIso(dueBy) : null,
      isChargeRefundable: dispute.is_charge_refundable ?? null,
      livemode: dispute.livemode,
      raw: event.data.object,
      stripeCreatedAt: toIso(dispute.created),
      lifecycleStatus,
    });

    if (event.type === "charge.dispute.closed") {
      const won = dispute.status === "won";
      const amountRecovered = won ? dispute.amount : 0;
      // Success-fee billing is calculation-only for now (no collection).
      const feeAmount = won ? Math.round(dispute.amount * account.feeRate) : 0;
      await store.recordOutcome({
        orgId: account.orgId,
        stripeDisputeId: dispute.id,
        result: won ? "won" : "lost",
        amountRecovered,
        feeAmount,
        closedAt: new Date().toISOString(),
      });
    }

    await store.markEventProcessed(event.id);
    return { outcome: "processed", action: event.type };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.markEventFailed(event.id, message);
    throw err;
  }
}
