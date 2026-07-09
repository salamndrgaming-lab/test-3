import { createAdminClient } from "@/lib/supabase/admin";
import { collectEvidence } from "./collector";

export interface GatherEvidenceResult {
  ok: boolean;
  stripeDisputeId: string;
  gaps?: number;
  error?: string;
}

/**
 * Gathers evidence for a dispute row and persists it:
 * - one `bundle` evidence item (the normalized, validated JSON bundle)
 * - raw `charge` / `customer` / `invoice` / `prior_charges` items for audit
 * - advances lifecycle new → evidence_gathering
 *
 * Runs with the service role (webhook/cron context); tenancy comes from the
 * dispute row itself. Idempotent: re-running refreshes the same items.
 */
export async function gatherEvidenceForDispute(
  stripeDisputeId: string
): Promise<GatherEvidenceResult> {
  const db = createAdminClient();

  const { data: dispute, error: disputeError } = await db
    .from("disputes")
    .select(
      "id, org_id, stripe_dispute_id, stripe_charge_id, amount, currency, reason, stripe_status, evidence_due_by, stripe_created_at, status, connected_accounts(stripe_account_id)"
    )
    .eq("stripe_dispute_id", stripeDisputeId)
    .single();

  if (disputeError || !dispute) {
    return {
      ok: false,
      stripeDisputeId,
      error: `dispute not found: ${disputeError?.message ?? "no row"}`,
    };
  }

  const account = Array.isArray(dispute.connected_accounts)
    ? dispute.connected_accounts[0]
    : dispute.connected_accounts;
  const stripeAccountId = (account as { stripe_account_id: string } | null)
    ?.stripe_account_id;
  if (!stripeAccountId) {
    return { ok: false, stripeDisputeId, error: "connected account missing" };
  }

  try {
    const { bundle, raw } = await collectEvidence({
      stripeAccountId,
      stripeDisputeId: dispute.stripe_dispute_id,
      stripeChargeId: dispute.stripe_charge_id,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      stripeStatus: dispute.stripe_status,
      evidenceDueBy: dispute.evidence_due_by,
      disputeCreatedUnix: dispute.stripe_created_at
        ? Math.floor(new Date(dispute.stripe_created_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
    });

    const items = [
      { kind: "bundle", source: "recoveryengine/normalizer", payload: bundle },
      { kind: "charge", source: "stripe/charges.retrieve", payload: raw.charge },
      ...(raw.customer
        ? [{ kind: "customer", source: "stripe/customers.retrieve", payload: raw.customer }]
        : []),
      ...(raw.invoice
        ? [{ kind: "invoice", source: "stripe/invoices.retrieve", payload: raw.invoice }]
        : []),
      ...(raw.priorCharges
        ? [
            {
              kind: "prior_charges",
              source: "stripe/charges.list",
              payload: { charges: raw.priorCharges },
            },
          ]
        : []),
    ].map((item) => ({
      org_id: dispute.org_id,
      dispute_id: dispute.id,
      ...item,
    }));

    const { error: upsertError } = await db
      .from("evidence_items")
      .upsert(items, { onConflict: "dispute_id,kind" });
    if (upsertError) {
      return { ok: false, stripeDisputeId, error: `store failed: ${upsertError.message}` };
    }

    // Advance lifecycle, but never regress a dispute that moved further.
    if (dispute.status === "new") {
      const { error: statusError } = await db
        .from("disputes")
        .update({ status: "evidence_gathering" })
        .eq("id", dispute.id)
        .eq("status", "new");
      if (statusError) {
        return {
          ok: false,
          stripeDisputeId,
          error: `status update failed: ${statusError.message}`,
        };
      }
    }

    return { ok: true, stripeDisputeId, gaps: bundle.gaps.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Evidence gathering failed for ${stripeDisputeId}`, err);
    return { ok: false, stripeDisputeId, error: message };
  }
}
