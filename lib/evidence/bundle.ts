import { z } from "zod";
import type Stripe from "stripe";

import { configForReason, type StripeEvidenceField } from "./reason-codes";

/**
 * The normalized evidence bundle stored per dispute. Everything in here is
 * derived from real Stripe records on the connected account — no field is
 * ever synthesized. Missing data is represented as null and reported in
 * `gaps` so downstream drafting can work around it instead of inventing it.
 */

const addressSchema = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  country: z.string().nullable(),
});

export const evidenceBundleSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  dispute: z.object({
    stripeDisputeId: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    reason: z.string(),
    stripeStatus: z.string(),
    evidenceDueBy: z.string().nullable(),
  }),
  reasonCode: z.object({
    visa: z.string(),
    mastercard: z.string(),
    winCriteria: z.string(),
  }),
  charge: z.object({
    id: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    createdAt: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    paid: z.boolean(),
    receiptUrl: z.string().nullable(),
    receiptNumber: z.string().nullable(),
    receiptEmail: z.string().nullable(),
    calculatedStatementDescriptor: z.string().nullable(),
    billing: z.object({
      name: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      address: addressSchema.nullable(),
    }),
    card: z
      .object({
        brand: z.string().nullable(),
        last4: z.string().nullable(),
        funding: z.string().nullable(),
        country: z.string().nullable(),
        fingerprint: z.string().nullable(),
        checks: z.object({
          addressLine1: z.string().nullable(),
          addressPostalCode: z.string().nullable(),
          cvc: z.string().nullable(),
        }),
        threeDSecure: z
          .object({
            result: z.string().nullable(),
            version: z.string().nullable(),
            authenticationFlow: z.string().nullable(),
          })
          .nullable(),
      })
      .nullable(),
    outcome: z
      .object({
        networkStatus: z.string().nullable(),
        riskLevel: z.string().nullable(),
        riskScore: z.number().nullable(),
        sellerMessage: z.string().nullable(),
      })
      .nullable(),
    metadata: z.record(z.string(), z.string()),
  }),
  customer: z
    .object({
      id: z.string(),
      email: z.string().nullable(),
      name: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: z.string().nullable(),
      address: addressSchema.nullable(),
      accountAgeDaysAtCharge: z.number().int().nullable(),
    })
    .nullable(),
  invoice: z
    .object({
      id: z.string(),
      number: z.string().nullable(),
      status: z.string().nullable(),
      hostedInvoiceUrl: z.string().nullable(),
      invoicePdf: z.string().nullable(),
      amountPaid: z.number().int().nullable(),
      lines: z.array(
        z.object({
          description: z.string().nullable(),
          amount: z.number().int(),
          quantity: z.number().nullable(),
          periodStart: z.string().nullable(),
          periodEnd: z.string().nullable(),
        })
      ),
    })
    .nullable(),
  shipping: z
    .object({
      name: z.string().nullable(),
      phone: z.string().nullable(),
      address: addressSchema.nullable(),
      carrier: z.string().nullable(),
      trackingNumber: z.string().nullable(),
      shippedAt: z.string().nullable(),
    })
    .nullable(),
  priorChargeHistory: z
    .object({
      customerId: z.string(),
      totalCharges: z.number().int(),
      succeededCharges: z.number().int(),
      refundedCharges: z.number().int(),
      disputedCharges: z.number().int(),
      totalSpendMinor: z.number().int(),
      currency: z.string().nullable(),
      firstChargeAt: z.string().nullable(),
      lastChargeAt: z.string().nullable(),
      undisputedChargesOlderThan120Days: z.number().int(),
    })
    .nullable(),
  /** Evidence fields the reason code weights that we could not source. */
  gaps: z.array(
    z.object({
      field: z.string(),
      weight: z.enum(["critical", "strong", "supporting"]),
    })
  ),
});

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
type Address = z.infer<typeof addressSchema>;

function iso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString();
}

function normalizeAddress(
  address: Stripe.Address | null | undefined
): Address | null {
  if (!address) return null;
  return {
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postal_code: address.postal_code ?? null,
    country: address.country ?? null,
  };
}

/** Common metadata keys merchants use for tracking numbers and carriers. */
const TRACKING_METADATA_KEYS = ["tracking_number", "trackingNumber", "tracking", "tracking_id"];
const CARRIER_METADATA_KEYS = ["carrier", "shipping_carrier", "shippingCarrier"];
const SHIPPED_AT_METADATA_KEYS = ["shipped_at", "shippedAt", "ship_date", "shipping_date"];

function fromMetadata(
  metadata: Record<string, string>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (value && value.trim() !== "") return value.trim();
  }
  return null;
}

export function normalizeShipping(
  charge: Stripe.Charge
): EvidenceBundle["shipping"] {
  const shipping = charge.shipping;
  const metadata = charge.metadata ?? {};
  const trackingNumber =
    shipping?.tracking_number ?? fromMetadata(metadata, TRACKING_METADATA_KEYS);
  const carrier = shipping?.carrier ?? fromMetadata(metadata, CARRIER_METADATA_KEYS);
  const shippedAt = fromMetadata(metadata, SHIPPED_AT_METADATA_KEYS);

  if (!shipping && !trackingNumber && !carrier) return null;

  return {
    name: shipping?.name ?? null,
    phone: shipping?.phone ?? null,
    address: normalizeAddress(shipping?.address),
    carrier,
    trackingNumber,
    shippedAt,
  };
}

export function normalizeCharge(charge: Stripe.Charge): EvidenceBundle["charge"] {
  const card = charge.payment_method_details?.card ?? null;
  return {
    id: charge.id,
    amount: charge.amount,
    currency: charge.currency,
    createdAt: iso(charge.created)!,
    description: charge.description ?? null,
    status: charge.status,
    paid: charge.paid,
    receiptUrl: charge.receipt_url ?? null,
    receiptNumber: charge.receipt_number ?? null,
    receiptEmail: charge.receipt_email ?? null,
    calculatedStatementDescriptor: charge.calculated_statement_descriptor ?? null,
    billing: {
      name: charge.billing_details?.name ?? null,
      email: charge.billing_details?.email ?? null,
      phone: charge.billing_details?.phone ?? null,
      address: normalizeAddress(charge.billing_details?.address),
    },
    card: card
      ? {
          brand: card.brand ?? null,
          last4: card.last4 ?? null,
          funding: card.funding ?? null,
          country: card.country ?? null,
          fingerprint: card.fingerprint ?? null,
          checks: {
            addressLine1: card.checks?.address_line1_check ?? null,
            addressPostalCode: card.checks?.address_postal_code_check ?? null,
            cvc: card.checks?.cvc_check ?? null,
          },
          threeDSecure: card.three_d_secure
            ? {
                result: card.three_d_secure.result ?? null,
                version: card.three_d_secure.version ?? null,
                authenticationFlow: card.three_d_secure.authentication_flow ?? null,
              }
            : null,
        }
      : null,
    outcome: charge.outcome
      ? {
          networkStatus: charge.outcome.network_status ?? null,
          riskLevel: charge.outcome.risk_level ?? null,
          riskScore: charge.outcome.risk_score ?? null,
          sellerMessage: charge.outcome.seller_message ?? null,
        }
      : null,
    metadata: (charge.metadata ?? {}) as Record<string, string>,
  };
}

export function normalizeCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null,
  chargeCreated: number
): EvidenceBundle["customer"] {
  if (!customer || customer.deleted) return null;
  const created = customer.created ?? null;
  return {
    id: customer.id,
    email: customer.email ?? null,
    name: customer.name ?? null,
    phone: customer.phone ?? null,
    createdAt: iso(created),
    address: normalizeAddress(customer.address),
    accountAgeDaysAtCharge:
      created != null
        ? Math.max(0, Math.floor((chargeCreated - created) / 86400))
        : null,
  };
}

export function normalizeInvoice(
  invoice: Stripe.Invoice | null
): EvidenceBundle["invoice"] {
  if (!invoice) return null;
  return {
    id: invoice.id ?? "",
    number: invoice.number ?? null,
    status: invoice.status ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
    amountPaid: invoice.amount_paid ?? null,
    lines: (invoice.lines?.data ?? []).map((line) => ({
      description: line.description ?? null,
      amount: line.amount,
      quantity: line.quantity ?? null,
      periodStart: iso(line.period?.start),
      periodEnd: iso(line.period?.end),
    })),
  };
}

/**
 * Summarizes the customer's prior charge history on the connected account.
 * The 120-day counter exists because Visa CE3.0 requires prior undisputed
 * transactions 120–365 days old.
 */
export function summarizePriorCharges(
  customerId: string,
  charges: Stripe.Charge[],
  disputedChargeId: string,
  disputeCreatedUnix: number
): NonNullable<EvidenceBundle["priorChargeHistory"]> {
  const prior = charges.filter((c) => c.id !== disputedChargeId);
  const succeeded = prior.filter((c) => c.status === "succeeded");
  const cutoff120 = disputeCreatedUnix - 120 * 86400;
  const cutoff365 = disputeCreatedUnix - 365 * 86400;

  const timestamps = prior.map((c) => c.created).sort((a, b) => a - b);

  return {
    customerId,
    totalCharges: prior.length,
    succeededCharges: succeeded.length,
    refundedCharges: prior.filter((c) => c.refunded).length,
    disputedCharges: prior.filter((c) => Boolean(c.disputed)).length,
    totalSpendMinor: succeeded.reduce((sum, c) => sum + c.amount, 0),
    currency: prior[0]?.currency ?? null,
    firstChargeAt: iso(timestamps[0] ?? null),
    lastChargeAt: iso(timestamps[timestamps.length - 1] ?? null),
    undisputedChargesOlderThan120Days: succeeded.filter(
      (c) => !c.disputed && c.created <= cutoff120 && c.created >= cutoff365
    ).length,
  };
}

/**
 * Determines which reason-weighted evidence fields the bundle can and
 * cannot support, so drafting can lean on strengths and acknowledge gaps
 * rather than fabricate.
 */
export function computeGaps(
  bundle: Omit<EvidenceBundle, "gaps">
): EvidenceBundle["gaps"] {
  const config = configForReason(bundle.dispute.reason);

  const present: Record<StripeEvidenceField, boolean> = {
    customer_name: Boolean(bundle.customer?.name ?? bundle.charge.billing.name),
    customer_email_address: Boolean(
      bundle.customer?.email ?? bundle.charge.billing.email ?? bundle.charge.receiptEmail
    ),
    customer_purchase_ip: false, // not exposed on Charge; sourced in Phase 3+ from PaymentIntent/Radar exports if available
    billing_address: Boolean(bundle.charge.billing.address?.line1),
    receipt: Boolean(bundle.charge.receiptUrl ?? bundle.invoice?.hostedInvoiceUrl),
    customer_signature: false,
    shipping_address: Boolean(bundle.shipping?.address?.line1),
    shipping_carrier: Boolean(bundle.shipping?.carrier),
    shipping_date: Boolean(bundle.shipping?.shippedAt),
    shipping_tracking_number: Boolean(bundle.shipping?.trackingNumber),
    shipping_documentation: false, // file upload — merchant-provided, Phase 4 dashboard
    service_date: false,
    service_documentation: false,
    product_description: Boolean(
      bundle.charge.description ?? bundle.invoice?.lines.some((l) => l.description)
    ),
    access_activity_log: false, // merchant system export — not derivable from Stripe
    cancellation_policy: false, // merchant-provided documents/policies
    cancellation_policy_disclosure: false,
    cancellation_rebuttal: false,
    duplicate_charge_id: false, // needs candidate-duplicate detection against charge list
    duplicate_charge_explanation: false,
    duplicate_charge_documentation: false,
    refund_policy: false,
    refund_policy_disclosure: false,
    refund_refusal_explanation: false,
    uncategorized_text: true,
  };

  return config.evidence
    .filter((item) => !present[item.field])
    .map((item) => ({ field: item.field, weight: item.weight }));
}

export interface BundleInputs {
  dispute: {
    stripeDisputeId: string;
    amount: number;
    currency: string;
    reason: string;
    stripeStatus: string;
    evidenceDueBy: string | null;
    createdUnix: number;
  };
  charge: Stripe.Charge;
  customer: Stripe.Customer | Stripe.DeletedCustomer | null;
  invoice: Stripe.Invoice | null;
  priorCharges: Stripe.Charge[] | null;
}

/** Assembles and validates the full bundle from raw Stripe records. */
export function buildEvidenceBundle(inputs: BundleInputs): EvidenceBundle {
  const config = configForReason(inputs.dispute.reason);
  const customer = normalizeCustomer(inputs.customer, inputs.charge.created);

  const withoutGaps: Omit<EvidenceBundle, "gaps"> = {
    version: 1,
    generatedAt: new Date().toISOString(),
    dispute: {
      stripeDisputeId: inputs.dispute.stripeDisputeId,
      amount: inputs.dispute.amount,
      currency: inputs.dispute.currency,
      reason: inputs.dispute.reason,
      stripeStatus: inputs.dispute.stripeStatus,
      evidenceDueBy: inputs.dispute.evidenceDueBy,
    },
    reasonCode: {
      visa: config.network.visa.code,
      mastercard: config.network.mastercard.code,
      winCriteria: config.winCriteria,
    },
    charge: normalizeCharge(inputs.charge),
    customer,
    invoice: normalizeInvoice(inputs.invoice),
    shipping: normalizeShipping(inputs.charge),
    priorChargeHistory:
      customer && inputs.priorCharges
        ? summarizePriorCharges(
            customer.id,
            inputs.priorCharges,
            inputs.charge.id,
            inputs.dispute.createdUnix
          )
        : null,
  };

  const bundle: EvidenceBundle = {
    ...withoutGaps,
    gaps: computeGaps(withoutGaps),
  };

  return evidenceBundleSchema.parse(bundle);
}
