import { evidenceBundleSchema, type EvidenceBundle } from "@/lib/evidence/bundle";
import { submitDisputeEvidence } from "@/lib/submission";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropicConfigured, runDraftPass, runQAPass } from "./passes";
import type { DraftOutput, QAOutput } from "./schemas";
import { validateDraftAgainstBundle, type ValidationResult } from "./validator";

export interface ResponseEngineDeps {
  draft: (bundle: EvidenceBundle) => Promise<DraftOutput>;
  qa: (bundle: EvidenceBundle, draft: DraftOutput) => Promise<QAOutput>;
}

export interface GenerateResponseResult {
  ok: boolean;
  stripeDisputeId: string;
  qaPassed?: boolean;
  needsHumanReview?: boolean;
  validation?: ValidationResult;
  skipped?: string;
  error?: string;
}

/**
 * Pure decision core of the two-pass engine, separated for testability:
 * draft → programmatic no-fabrication validation → adversarial QA.
 * Auto-advance only when validation AND QA both pass; anything weaker is
 * flagged for human review.
 */
export async function runTwoPassEngine(
  bundle: EvidenceBundle,
  deps: ResponseEngineDeps
): Promise<{
  draft: DraftOutput;
  validation: ValidationResult;
  qa: QAOutput | null;
  qaPassed: boolean;
  needsHumanReview: boolean;
}> {
  const draft = await deps.draft(bundle);
  const validation = validateDraftAgainstBundle(draft, bundle);

  // A draft that fails programmatic validation never auto-advances, but we
  // still run QA so the human reviewer sees both signals.
  const qa = await deps.qa(bundle, draft);
  const qaScoreValid = qa.score >= 0 && qa.score <= 1;
  const qaPassed =
    validation.ok && qaScoreValid && qa.verdict === "pass" && qa.unsupportedClaims.length === 0;

  return {
    draft,
    validation,
    qa,
    qaPassed,
    needsHumanReview: !qaPassed,
  };
}

/**
 * Generates (or regenerates) the AI response for a dispute: loads the
 * stored evidence bundle, runs the two-pass engine, persists the response
 * row, and advances lifecycle evidence_gathering → drafted only when QA
 * passed. Requires ANTHROPIC_API_KEY; skips gracefully when absent so the
 * sweep cron can retry later.
 */
export async function generateResponseForDispute(
  stripeDisputeId: string,
  deps: ResponseEngineDeps = { draft: runDraftPass, qa: runQAPass }
): Promise<GenerateResponseResult> {
  if (deps.draft === runDraftPass && !anthropicConfigured()) {
    return {
      ok: false,
      stripeDisputeId,
      skipped: "ANTHROPIC_API_KEY not configured; dispute left in evidence_gathering",
    };
  }

  const db = createAdminClient();

  const { data: dispute, error: disputeError } = await db
    .from("disputes")
    .select("id, org_id, status, reason, organizations(auto_submit_reasons)")
    .eq("stripe_dispute_id", stripeDisputeId)
    .single();
  if (disputeError || !dispute) {
    return { ok: false, stripeDisputeId, error: `dispute not found: ${disputeError?.message}` };
  }

  const { data: bundleItem, error: bundleError } = await db
    .from("evidence_items")
    .select("payload")
    .eq("dispute_id", dispute.id)
    .eq("kind", "bundle")
    .single();
  if (bundleError || !bundleItem) {
    return { ok: false, stripeDisputeId, error: "evidence bundle not found; gather evidence first" };
  }

  const parsedBundle = evidenceBundleSchema.safeParse(bundleItem.payload);
  if (!parsedBundle.success) {
    return { ok: false, stripeDisputeId, error: `stored bundle is invalid: ${parsedBundle.error.message}` };
  }

  try {
    const result = await runTwoPassEngine(parsedBundle.data, deps);

    const { error: upsertError } = await db.from("responses").upsert(
      {
        org_id: dispute.org_id,
        dispute_id: dispute.id,
        narrative: result.draft.narrative,
        evidence_mapping: {
          submission: result.draft.evidenceSubmission,
          gapHandling: result.draft.gapHandling,
        },
        qa_review: {
          qa: result.qa,
          validation: result.validation,
        },
        qa_passed: result.qaPassed,
        confidence: Math.min(1, Math.max(0, result.draft.confidence)),
        needs_human_review: result.needsHumanReview,
      },
      { onConflict: "dispute_id" }
    );
    if (upsertError) {
      return { ok: false, stripeDisputeId, error: `store failed: ${upsertError.message}` };
    }

    // Auto-advance only when QA passed; never regress a further-along dispute.
    if (result.qaPassed && dispute.status === "evidence_gathering") {
      const { error: statusError } = await db
        .from("disputes")
        .update({ status: "drafted" })
        .eq("id", dispute.id)
        .eq("status", "evidence_gathering");
      if (statusError) {
        return { ok: false, stripeDisputeId, error: `status update failed: ${statusError.message}` };
      }
    }

    // Per-reason auto-submit: only ever from a QA-passed draft.
    if (result.qaPassed) {
      const org = Array.isArray(dispute.organizations)
        ? dispute.organizations[0]
        : dispute.organizations;
      const autoReasons =
        (org as { auto_submit_reasons: string[] } | null)?.auto_submit_reasons ?? [];
      if (autoReasons.includes(dispute.reason)) {
        const submitted = await submitDisputeEvidence({
          disputeId: dispute.id,
          orgId: dispute.org_id,
          submittedBy: null,
        });
        if (!submitted.ok) {
          console.error(`Auto-submit failed for ${stripeDisputeId}: ${submitted.error}`);
        }
      }
    }

    return {
      ok: true,
      stripeDisputeId,
      qaPassed: result.qaPassed,
      needsHumanReview: result.needsHumanReview,
      validation: result.validation,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Response generation failed for ${stripeDisputeId}`, err);
    return { ok: false, stripeDisputeId, error: message };
  }
}
