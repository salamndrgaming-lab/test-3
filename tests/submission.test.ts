import { describe, expect, it } from "vitest";

import { buildStripeEvidence } from "@/lib/submission";

describe("buildStripeEvidence", () => {
  it("maps known fields onto the Stripe evidence object", () => {
    const evidence = buildStripeEvidence([
      { field: "customer_email_address", value: "jane@example.com" },
      { field: "shipping_tracking_number", value: "1Z999AA10123456784" },
      { field: "uncategorized_text", value: "Narrative here." },
    ]);
    expect(evidence).toEqual({
      customer_email_address: "jane@example.com",
      shipping_tracking_number: "1Z999AA10123456784",
      uncategorized_text: "Narrative here.",
    });
  });

  it("drops unknown fields and empty values", () => {
    const evidence = buildStripeEvidence([
      { field: "not_a_stripe_field", value: "x" },
      { field: "customer_name", value: "   " },
      { field: "receipt", value: "https://pay.stripe.com/r/1" },
    ]);
    expect(evidence).toEqual({ receipt: "https://pay.stripe.com/r/1" });
  });

  it("returns an empty object for an empty submission", () => {
    expect(buildStripeEvidence([])).toEqual({});
  });
});
