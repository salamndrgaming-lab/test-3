import type Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import { buildEvidenceBundle, type BundleInputs, type EvidenceBundle } from "./bundle";

export interface CollectedEvidence {
  bundle: EvidenceBundle;
  /** Raw records kept alongside the bundle for audit. */
  raw: {
    charge: Stripe.Charge;
    customer: Stripe.Customer | Stripe.DeletedCustomer | null;
    invoice: Stripe.Invoice | null;
    priorCharges: Stripe.Charge[] | null;
  };
}

export interface CollectDisputeInput {
  stripeAccountId: string;
  stripeDisputeId: string;
  stripeChargeId: string;
  amount: number;
  currency: string;
  reason: string;
  stripeStatus: string;
  evidenceDueBy: string | null;
  disputeCreatedUnix: number;
}

/**
 * Pulls the full evidence record for a dispute from the connected account:
 * charge (with payment method details), customer, invoice, receipt and
 * shipping data, and the customer's prior charge history.
 */
export async function collectEvidence(
  input: CollectDisputeInput
): Promise<CollectedEvidence> {
  const client = stripe();
  const opts = { stripeAccount: input.stripeAccountId };

  const charge = await client.charges.retrieve(
    input.stripeChargeId,
    { expand: ["customer", "invoice"] },
    opts
  );

  const customer =
    charge.customer && typeof charge.customer !== "string"
      ? charge.customer
      : charge.customer
        ? await client.customers.retrieve(charge.customer, {}, opts)
        : null;

  const invoiceRef = (charge as Stripe.Charge & {
    invoice?: string | Stripe.Invoice | null;
  }).invoice;
  const invoice =
    invoiceRef && typeof invoiceRef !== "string"
      ? invoiceRef
      : invoiceRef
        ? await client.invoices.retrieve(invoiceRef, {}, opts)
        : null;

  let priorCharges: Stripe.Charge[] | null = null;
  if (customer && !("deleted" in customer && customer.deleted)) {
    const list = await client.charges.list(
      { customer: customer.id, limit: 100 },
      opts
    );
    priorCharges = list.data;
  }

  const inputs: BundleInputs = {
    dispute: {
      stripeDisputeId: input.stripeDisputeId,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      stripeStatus: input.stripeStatus,
      evidenceDueBy: input.evidenceDueBy,
      createdUnix: input.disputeCreatedUnix,
    },
    charge,
    customer,
    invoice,
    priorCharges,
  };

  return {
    bundle: buildEvidenceBundle(inputs),
    raw: { charge, customer, invoice, priorCharges },
  };
}
