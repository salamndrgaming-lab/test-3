import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import {
  buildEvidenceBundle,
  summarizePriorCharges,
  type BundleInputs,
} from "@/lib/evidence/bundle";
import {
  configForReason,
  REASON_CODE_CONFIG,
} from "@/lib/evidence/reason-codes";

const NOW_UNIX = 1751846400; // 2025-07-07

function chargeFixture(overrides: Record<string, unknown> = {}): Stripe.Charge {
  return {
    id: "ch_1",
    object: "charge",
    amount: 12900,
    currency: "usd",
    created: NOW_UNIX - 20 * 86400,
    description: "Pro plan — July",
    status: "succeeded",
    paid: true,
    refunded: false,
    disputed: true,
    receipt_url: "https://pay.stripe.com/receipts/rcpt_123",
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
    outcome: {
      network_status: "approved_by_network",
      risk_level: "normal",
      risk_score: 12,
      seller_message: "Payment complete.",
    },
    shipping: null,
    metadata: { tracking_number: "1Z999AA10123456784", carrier: "UPS" },
    customer: null,
    ...overrides,
  } as unknown as Stripe.Charge;
}

function customerFixture(): Stripe.Customer {
  return {
    id: "cus_1",
    object: "customer",
    created: NOW_UNIX - 400 * 86400,
    email: "jane@example.com",
    name: "Jane Doe",
    phone: null,
    address: null,
    deleted: undefined,
  } as unknown as Stripe.Customer;
}

function priorCharge(id: string, daysAgo: number, opts: Partial<{ disputed: boolean; refunded: boolean; status: string; amount: number }> = {}): Stripe.Charge {
  return {
    id,
    object: "charge",
    amount: opts.amount ?? 5000,
    currency: "usd",
    created: NOW_UNIX - daysAgo * 86400,
    status: opts.status ?? "succeeded",
    disputed: opts.disputed ?? false,
    refunded: opts.refunded ?? false,
  } as unknown as Stripe.Charge;
}

function bundleInputs(overrides: Partial<BundleInputs> = {}): BundleInputs {
  return {
    dispute: {
      stripeDisputeId: "dp_1",
      amount: 12900,
      currency: "usd",
      reason: "fraudulent",
      stripeStatus: "needs_response",
      evidenceDueBy: new Date((NOW_UNIX + 10 * 86400) * 1000).toISOString(),
      createdUnix: NOW_UNIX,
    },
    charge: chargeFixture(),
    customer: customerFixture(),
    invoice: null,
    priorCharges: [
      priorCharge("ch_old_1", 200),
      priorCharge("ch_old_2", 150),
      priorCharge("ch_recent", 30),
      priorCharge("ch_disputed", 180, { disputed: true }),
      priorCharge("ch_1", 20), // the disputed charge itself — must be excluded
    ],
    ...overrides,
  };
}

describe("reason code config", () => {
  it("covers the core Stripe dispute reasons", () => {
    for (const reason of [
      "fraudulent",
      "product_not_received",
      "product_unacceptable",
      "duplicate",
      "subscription_canceled",
      "credit_not_processed",
      "unrecognized",
      "general",
    ]) {
      expect(REASON_CODE_CONFIG[reason], `missing config for ${reason}`).toBeDefined();
    }
  });

  it("every config has network citations, win criteria, and weighted evidence", () => {
    for (const [reason, config] of Object.entries(REASON_CODE_CONFIG)) {
      expect(config.network.visa.code, reason).toBeTruthy();
      expect(config.network.visa.citation.length, reason).toBeGreaterThan(20);
      expect(config.network.mastercard.code, reason).toBeTruthy();
      expect(config.network.mastercard.citation.length, reason).toBeGreaterThan(20);
      expect(config.winCriteria.length, reason).toBeGreaterThan(20);
      expect(config.evidence.length, reason).toBeGreaterThanOrEqual(3);
      for (const item of config.evidence) {
        expect(item.rationale.length, `${reason}/${item.field}`).toBeGreaterThan(10);
      }
    }
  });

  it("falls back to the general config for bank/processing reasons and unknowns", () => {
    expect(configForReason("insufficient_funds").stripeReason).toBe("general");
    expect(configForReason("some_future_reason").stripeReason).toBe("general");
    expect(configForReason("fraudulent").stripeReason).toBe("fraudulent");
  });
});

describe("evidence bundle normalization", () => {
  it("builds a schema-valid bundle from real Stripe object shapes", () => {
    const bundle = buildEvidenceBundle(bundleInputs());

    expect(bundle.version).toBe(1);
    expect(bundle.dispute.stripeDisputeId).toBe("dp_1");
    expect(bundle.reasonCode.visa).toBe("10.4");
    expect(bundle.reasonCode.mastercard).toBe("4837");
    expect(bundle.charge.card?.checks.cvc).toBe("pass");
    expect(bundle.charge.billing.address?.postal_code).toBe("62701");
    expect(bundle.customer?.email).toBe("jane@example.com");
    expect(bundle.customer?.accountAgeDaysAtCharge).toBe(380);
  });

  it("extracts shipping from charge metadata when charge.shipping is absent", () => {
    const bundle = buildEvidenceBundle(bundleInputs());
    expect(bundle.shipping?.trackingNumber).toBe("1Z999AA10123456784");
    expect(bundle.shipping?.carrier).toBe("UPS");
  });

  it("summarizes prior charge history excluding the disputed charge", () => {
    const bundle = buildEvidenceBundle(bundleInputs());
    const history = bundle.priorChargeHistory!;
    expect(history.totalCharges).toBe(4); // ch_1 excluded
    expect(history.disputedCharges).toBe(1);
    expect(history.totalSpendMinor).toBe(4 * 5000);
    // CE3.0 window: undisputed, 120–365 days old → ch_old_1 (200d), ch_old_2 (150d)
    expect(history.undisputedChargesOlderThan120Days).toBe(2);
  });

  it("counts only the 120-365 day window for CE3.0 eligibility", () => {
    const summary = summarizePriorCharges(
      "cus_1",
      [
        priorCharge("a", 119), // too recent
        priorCharge("b", 120),
        priorCharge("c", 365),
        priorCharge("d", 366), // too old
        priorCharge("e", 200, { disputed: true }), // disputed — excluded
      ],
      "ch_x",
      NOW_UNIX
    );
    expect(summary.undisputedChargesOlderThan120Days).toBe(2);
  });

  it("reports gaps for reason-weighted evidence that is missing, never inventing it", () => {
    const inputs = bundleInputs({
      charge: chargeFixture({ metadata: {}, shipping: null }),
      customer: null,
      priorCharges: null,
    });
    const bundle = buildEvidenceBundle(inputs);

    expect(bundle.customer).toBeNull();
    expect(bundle.shipping).toBeNull();
    expect(bundle.priorChargeHistory).toBeNull();

    const gapFields = bundle.gaps.map((g) => g.field);
    // fraudulent weights tracking + IP + activity log; none available here
    expect(gapFields).toContain("shipping_tracking_number");
    expect(gapFields).toContain("customer_purchase_ip");
    expect(gapFields).toContain("access_activity_log");
    // but email IS available (billing details) so it must not be a gap
    expect(gapFields).not.toContain("customer_email_address");
  });

  it("handles a minimal charge with no card details, customer, or invoice", () => {
    const bundle = buildEvidenceBundle(
      bundleInputs({
        charge: chargeFixture({
          payment_method_details: null,
          outcome: null,
          billing_details: { name: null, email: null, phone: null, address: null },
          receipt_url: null,
          receipt_number: null,
          receipt_email: null,
          metadata: {},
          description: null,
        }),
        customer: null,
        invoice: null,
        priorCharges: null,
      })
    );
    expect(bundle.charge.card).toBeNull();
    expect(bundle.gaps.map((g) => g.field)).toContain("customer_email_address");
    expect(bundle.gaps.map((g) => g.field)).toContain("receipt");
  });
});
