import { z } from "zod";

/**
 * Structured-output schemas for the two-pass response engine.
 * Kept structured-outputs-compatible: no records with arbitrary keys,
 * no numeric range constraints in the wire schema (validated in code).
 */

/** Evidence fields the model is allowed to map (Stripe dispute evidence object). */
export const SUBMITTABLE_EVIDENCE_FIELDS = [
  "customer_name",
  "customer_email_address",
  "customer_purchase_ip",
  "billing_address",
  "receipt",
  "shipping_address",
  "shipping_carrier",
  "shipping_date",
  "shipping_tracking_number",
  "service_date",
  "product_description",
  "duplicate_charge_id",
  "duplicate_charge_explanation",
  "refund_refusal_explanation",
  "cancellation_rebuttal",
  "uncategorized_text",
] as const;

export type SubmittableEvidenceField = (typeof SUBMITTABLE_EVIDENCE_FIELDS)[number];

export const draftOutputSchema = z.object({
  /** The persuasive representment narrative for the card-network reviewer. */
  narrative: z.string(),
  /**
   * Mapping of Stripe evidence fields to the exact values to submit.
   * Every value must be sourced from the evidence bundle.
   */
  evidenceSubmission: z.array(
    z.object({
      field: z.enum(SUBMITTABLE_EVIDENCE_FIELDS),
      value: z.string(),
      /** JSON-ish path in the bundle the value came from, e.g. "shipping.trackingNumber". */
      sourcePath: z.string(),
    })
  ),
  /** Evidence gaps acknowledged and how the narrative works around them. */
  gapHandling: z.array(
    z.object({
      missingField: z.string(),
      workaround: z.string(),
    })
  ),
  /** Model's own confidence that this response wins, 0-1. */
  confidence: z.number(),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;

export const qaOutputSchema = z.object({
  /** pass = strong enough to submit without human review. */
  verdict: z.enum(["pass", "fail"]),
  /** Win-likelihood score 0-1 from the adversarial reviewer's perspective. */
  score: z.number(),
  critiques: z.array(
    z.object({
      severity: z.enum(["blocking", "major", "minor"]),
      issue: z.string(),
      recommendation: z.string(),
    })
  ),
  /** Evidence the reviewer would expect for this reason code but did not see. */
  missingEvidence: z.array(z.string()),
  /** Any claims in the draft not supported by the evidence bundle. */
  unsupportedClaims: z.array(z.string()),
});

export type QAOutput = z.infer<typeof qaOutputSchema>;
