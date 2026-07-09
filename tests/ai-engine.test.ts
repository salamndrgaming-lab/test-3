import { describe, expect, it } from "vitest";

import { runTwoPassEngine } from "@/lib/ai/engine";
import type { DraftOutput, QAOutput } from "@/lib/ai/schemas";
import {
  extractArtifacts,
  validateDraftAgainstBundle,
} from "@/lib/ai/validator";
import { buildEvidenceBundle, type EvidenceBundle } from "@/lib/evidence/bundle";
import type Stripe from "stripe";

const NOW_UNIX = 1751846400;

function testBundle(): EvidenceBundle {
  const charge = {
    id: "ch_9xy",
    object: "charge",
    amount: 12900,
    currency: "usd",
    created: NOW_UNIX - 20 * 86400,
    description: "Pro plan subscription",
    status: "succeeded",
    paid: true,
    receipt_url: "https://pay.stripe.com/receipts/rcpt_abc123",
    receipt_number: "1234-5678",
    receipt_email: "jane@example.com",
    calculated_statement_descriptor: "ACME PRO",
    billing_details: {
      name: "Jane Doe",
      email: "jane@example.com",
      phone: null,
      address: {
        line1: "1 Main St",
        line2: null,
        city: "Springfield",
        state: "IL",
        postal_code: "62701",
        country: "US",
      },
    },
    payment_method_details: {
      type: "card",
      card: {
        brand: "visa",
        last4: "4242",
        funding: "credit",
        country: "US",
        fingerprint: "fp_abc",
        checks: {
          address_line1_check: "pass",
          address_postal_code_check: "pass",
          cvc_check: "pass",
        },
        three_d_secure: null,
      },
    },
    outcome: null,
    shipping: null,
    metadata: { tracking_number: "1Z999AA10123456784", carrier: "UPS" },
    customer: null,
  } as unknown as Stripe.Charge;

  return buildEvidenceBundle({
    dispute: {
      stripeDisputeId: "dp_9xy",
      amount: 12900,
      currency: "usd",
      reason: "fraudulent",
      stripeStatus: "needs_response",
      evidenceDueBy: null,
      createdUnix: NOW_UNIX,
    },
    charge,
    customer: null,
    invoice: null,
    priorCharges: null,
  });
}

function validDraft(): DraftOutput {
  return {
    narrative:
      "The cardholder Jane Doe authorized this $129.00 purchase. The card ending 4242 passed AVS (line1: pass, postal: pass) and CVC checks, and the order shipped via UPS with tracking 1Z999AA10123456784 to the AVS-verified billing address at 1 Main St, Springfield.",
    evidenceSubmission: [
      {
        field: "customer_email_address",
        value: "jane@example.com",
        sourcePath: "charge.billing.email",
      },
      {
        field: "shipping_tracking_number",
        value: "1Z999AA10123456784",
        sourcePath: "shipping.trackingNumber",
      },
      { field: "receipt", value: "https://pay.stripe.com/receipts/rcpt_abc123", sourcePath: "charge.receiptUrl" },
    ],
    gapHandling: [
      {
        missingField: "customer_purchase_ip",
        workaround: "Lean on AVS/CVC pass results and delivery to billing address instead.",
      },
    ],
    confidence: 0.7,
  };
}

function passingQA(): QAOutput {
  return {
    verdict: "pass",
    score: 0.75,
    critiques: [
      { severity: "minor", issue: "No 3DS data", recommendation: "Note the card was not enrolled." },
    ],
    missingEvidence: ["customer_purchase_ip"],
    unsupportedClaims: [],
  };
}

describe("no-fabrication validator", () => {
  it("accepts a draft fully grounded in the bundle", () => {
    const result = validateDraftAgainstBundle(validDraft(), testBundle());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a fabricated tracking number in the evidence mapping", () => {
    const draft = validDraft();
    draft.evidenceSubmission[1].value = "1Z000FAKE0000000000";
    const result = validateDraftAgainstBundle(draft, testBundle());
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "value_not_in_bundle", field: "shipping_tracking_number" })
    );
  });

  it("rejects mapping a field the bundle lists as a gap", () => {
    const draft = validDraft();
    draft.evidenceSubmission.push({
      field: "customer_purchase_ip",
      value: "203.0.113.7",
      sourcePath: "invented",
    });
    const result = validateDraftAgainstBundle(draft, testBundle());
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "field_not_in_bundle", field: "customer_purchase_ip" })
    );
  });

  it("rejects fabricated identifiers inside the narrative", () => {
    const draft = validDraft();
    draft.narrative += " A refund of $500.00 was issued under reference RF77821.";
    const result = validateDraftAgainstBundle(draft, testBundle());
    expect(result.ok).toBe(false);
    const details = result.violations.map((v) => v.detail).join(" ");
    expect(details).toContain("RF77821");
    expect(details).toContain("500.00");
  });

  it("rejects fabricated artifacts inside free-text fields", () => {
    const draft = validDraft();
    draft.evidenceSubmission.push({
      field: "uncategorized_text",
      value: "Customer also confirmed by phone from +1-555-0100 on order ORD88412.",
      sourcePath: "composed",
    });
    const result = validateDraftAgainstBundle(draft, testBundle());
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "value_not_in_bundle", field: "uncategorized_text" })
    );
  });

  it("rejects empty evidence values and out-of-range confidence", () => {
    const draft = validDraft();
    draft.evidenceSubmission[0].value = "  ";
    draft.confidence = 1.4;
    const result = validateDraftAgainstBundle(draft, testBundle());
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "empty_value", field: "customer_email_address" })
    );
    expect(result.violations).toContainEqual(
      expect.objectContaining({ type: "confidence_out_of_range" })
    );
  });

  it("extracts emails, urls, amounts and identifier tokens from prose", () => {
    const artifacts = extractArtifacts(
      "Shipped 1Z999AA10123456784 to jane@example.com, receipt https://pay.stripe.com/r/1 for $129.00"
    );
    expect(artifacts).toEqual(
      expect.arrayContaining([
        "1Z999AA10123456784",
        "jane@example.com",
        "https://pay.stripe.com/r/1",
        "129.00",
      ])
    );
  });
});

describe("two-pass engine decision logic", () => {
  it("auto-advances only when validation and QA both pass", async () => {
    const result = await runTwoPassEngine(testBundle(), {
      draft: async () => validDraft(),
      qa: async () => passingQA(),
    });
    expect(result.qaPassed).toBe(true);
    expect(result.needsHumanReview).toBe(false);
  });

  it("flags for human review when QA fails, even with a valid draft", async () => {
    const result = await runTwoPassEngine(testBundle(), {
      draft: async () => validDraft(),
      qa: async () => ({
        ...passingQA(),
        verdict: "fail" as const,
        score: 0.3,
        critiques: [
          {
            severity: "blocking" as const,
            issue: "No IP/device evidence for a CNP fraud claim",
            recommendation: "Escalate to human review",
          },
        ],
      }),
    });
    expect(result.qaPassed).toBe(false);
    expect(result.needsHumanReview).toBe(true);
  });

  it("never auto-advances a draft that failed programmatic validation, even if QA passes", async () => {
    const fabricated = validDraft();
    fabricated.narrative += " Package was signed for under confirmation SIG99231.";
    const result = await runTwoPassEngine(testBundle(), {
      draft: async () => fabricated,
      qa: async () => passingQA(), // QA missed the fabrication — validator must not
    });
    expect(result.validation.ok).toBe(false);
    expect(result.qaPassed).toBe(false);
    expect(result.needsHumanReview).toBe(true);
  });

  it("fails closed when QA reports unsupported claims", async () => {
    const result = await runTwoPassEngine(testBundle(), {
      draft: async () => validDraft(),
      qa: async () => ({
        ...passingQA(),
        unsupportedClaims: ["Narrative claims a signature confirmation that is not in evidence"],
      }),
    });
    expect(result.qaPassed).toBe(false);
    expect(result.needsHumanReview).toBe(true);
  });

  it("fails closed on an out-of-range QA score", async () => {
    const result = await runTwoPassEngine(testBundle(), {
      draft: async () => validDraft(),
      qa: async () => ({ ...passingQA(), score: 7 }),
    });
    expect(result.qaPassed).toBe(false);
  });
});
