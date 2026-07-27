import { SUBMITTABLE_EVIDENCE_FIELDS } from "@/lib/ai/schemas";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SubmissionEntry {
  field: string;
  value: string;
}

/**
 * Builds the Stripe dispute-evidence object from a stored submission
 * mapping, admitting only known evidence fields with non-empty values.
 */
export function buildStripeEvidence(
  submission: SubmissionEntry[]
): Record<string, string> {
  const allowed = new Set<string>(SUBMITTABLE_EVIDENCE_FIELDS);
  const evidence: Record<string, string> = {};
  for (const entry of submission) {
    if (!allowed.has(entry.field)) continue;
    const value = entry.value.trim();
    if (value === "") continue;
    evidence[entry.field] = value;
  }
  return evidence;
}

export interface SubmitResult {
  ok: boolean;
  stripeDisputeId?: string;
  error?: string;
}

/**
 * Submits a dispute's stored response to Stripe's dispute evidence API on
 * the connected account and advances the lifecycle to 'submitted'.
 *
 * Callers are responsible for authorization: the dashboard action verifies
 * org membership; the auto-submit path runs org-scoped from the engine.
 */
export async function submitDisputeEvidence(input: {
  disputeId: string;
  orgId: string;
  submittedBy: string | null;
}): Promise<SubmitResult> {
  const db = createAdminClient();

  const { data: dispute, error: disputeError } = await db
    .from("disputes")
    .select(
      "id, org_id, status, stripe_dispute_id, connected_accounts(stripe_account_id), responses(id, narrative, evidence_mapping, submitted_at)"
    )
    .eq("id", input.disputeId)
    .eq("org_id", input.orgId)
    .single();
  if (disputeError || !dispute) {
    return { ok: false, error: `dispute not found: ${disputeError?.message ?? "no row"}` };
  }
  if (dispute.status === "submitted" || dispute.status === "won" || dispute.status === "lost") {
    return { ok: false, error: `dispute is already ${dispute.status}` };
  }

  const account = Array.isArray(dispute.connected_accounts)
    ? dispute.connected_accounts[0]
    : dispute.connected_accounts;
  const stripeAccountId = (account as { stripe_account_id: string } | null)?.stripe_account_id;
  if (!stripeAccountId) {
    return { ok: false, error: "connected account missing" };
  }

  const response = Array.isArray(dispute.responses) ? dispute.responses[0] : dispute.responses;
  if (!response) {
    return { ok: false, error: "no response drafted for this dispute" };
  }

  const mapping = (response.evidence_mapping ?? {}) as {
    submission?: SubmissionEntry[];
  };
  const evidence = buildStripeEvidence(mapping.submission ?? []);
  // The narrative rides in uncategorized_text unless the draft set it.
  if (!evidence.uncategorized_text && response.narrative) {
    evidence.uncategorized_text = response.narrative;
  }
  if (Object.keys(evidence).length === 0) {
    return { ok: false, error: "response has no submittable evidence" };
  }

  try {
    await stripe().disputes.update(
      dispute.stripe_dispute_id,
      { evidence, submit: true },
      { stripeAccount: stripeAccountId }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Stripe rejected the submission: ${message}` };
  }

  const now = new Date().toISOString();
  const { error: responseError } = await db
    .from("responses")
    .update({ submitted_at: now, submitted_by: input.submittedBy })
    .eq("id", response.id);
  if (responseError) {
    return { ok: false, error: `submitted to Stripe but recording failed: ${responseError.message}` };
  }

  const { error: statusError } = await db
    .from("disputes")
    .update({ status: "submitted" })
    .eq("id", dispute.id)
    .in("status", ["new", "evidence_gathering", "drafted"]);
  if (statusError) {
    return { ok: false, error: `submitted to Stripe but status update failed: ${statusError.message}` };
  }

  return { ok: true, stripeDisputeId: dispute.stripe_dispute_id };
}
