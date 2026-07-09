/**
 * Maps Stripe dispute reason codes to the evidence types card networks
 * actually weight when deciding representment for that reason code.
 *
 * Evidence type identifiers are Stripe dispute-evidence object field names
 * (https://docs.stripe.com/api/disputes/evidence_object) so Phase 3 can map
 * bundle fields straight onto the submission.
 *
 * Network citations:
 * - Visa: "Visa Core Rules and Visa Product and Service Rules", Section 11
 *   (Dispute Resolution), dispute categories 10.x (Fraud), 12.x (Processing
 *   Errors), 13.x (Consumer Disputes), and "Visa Claims Resolution (VCR)
 *   Dispute Management Guidelines" compelling-evidence requirements
 *   (incl. Compelling Evidence 3.0, CE3.0, effective Apr 2023).
 * - Mastercard: "Mastercard Chargeback Guide" (TB-CG), chapters for message
 *   reason codes 4837, 4853, 4834, 4860, 4863 and the Second
 *   Presentment/compelling-evidence remedies in each chapter.
 */

/** Stripe dispute evidence object field names we may submit. */
export type StripeEvidenceField =
  | "customer_name"
  | "customer_email_address"
  | "customer_purchase_ip"
  | "billing_address"
  | "receipt"
  | "customer_signature"
  | "shipping_address"
  | "shipping_carrier"
  | "shipping_date"
  | "shipping_tracking_number"
  | "shipping_documentation"
  | "service_date"
  | "service_documentation"
  | "product_description"
  | "access_activity_log"
  | "cancellation_policy"
  | "cancellation_policy_disclosure"
  | "cancellation_rebuttal"
  | "duplicate_charge_id"
  | "duplicate_charge_explanation"
  | "duplicate_charge_documentation"
  | "refund_policy"
  | "refund_policy_disclosure"
  | "refund_refusal_explanation"
  | "uncategorized_text";

export type EvidenceWeight = "critical" | "strong" | "supporting";

export interface WeightedEvidence {
  field: StripeEvidenceField;
  weight: EvidenceWeight;
  /** Why the networks weight this evidence for this reason code. */
  rationale: string;
}

export interface ReasonCodeConfig {
  /** Stripe dispute reason string. */
  stripeReason: string;
  summary: string;
  network: {
    visa: { code: string; name: string; citation: string };
    mastercard: { code: string; name: string; citation: string };
  };
  /** What the issuer must be convinced of for the merchant to win. */
  winCriteria: string;
  evidence: WeightedEvidence[];
}

export const REASON_CODE_CONFIG: Record<string, ReasonCodeConfig> = {
  fraudulent: {
    stripeReason: "fraudulent",
    summary: "Cardholder claims they did not authorize the payment.",
    network: {
      visa: {
        code: "10.4",
        name: "Other Fraud — Card-Absent Environment",
        citation:
          "Visa Core Rules §11, Fraud category 10.4; VCR Dispute Management Guidelines, Compelling Evidence for 10.4 incl. CE3.0 (two prior undisputed transactions 120–365 days old sharing device/IP/account with the disputed one).",
      },
      mastercard: {
        code: "4837",
        name: "No Cardholder Authorisation",
        citation:
          "Mastercard Chargeback Guide, reason code 4837 chapter; Second Presentment remedies incl. compelling evidence of cardholder participation (prior undisputed transactions, digital-goods usage data, delivery to AVS-confirmed address).",
      },
    },
    winCriteria:
      "Show the genuine cardholder authorized and/or participated in the purchase: link identity (email, IP, device), payment verification (AVS/CVC/3DS), and prior undisputed purchase history.",
    evidence: [
      {
        field: "customer_purchase_ip",
        weight: "critical",
        rationale:
          "IP/device linkage across the disputed and prior undisputed transactions is the core of Visa CE3.0 and Mastercard's cardholder-participation remedy.",
      },
      {
        field: "customer_email_address",
        weight: "critical",
        rationale:
          "Matching email used in prior undisputed purchases establishes the same account made the purchase (CE3.0 identity element).",
      },
      {
        field: "access_activity_log",
        weight: "critical",
        rationale:
          "For digital goods/services, proof the purchased item was accessed/used post-purchase is compelling under both networks' fraud remedies.",
      },
      {
        field: "shipping_tracking_number",
        weight: "strong",
        rationale:
          "Delivery confirmation to the AVS-verified billing address rebuts 'not authorized' for physical goods (Visa 10.4 compelling evidence; MC 4837 remedy).",
      },
      {
        field: "shipping_address",
        weight: "strong",
        rationale: "AVS-match between shipping and billing address strengthens delivery evidence.",
      },
      {
        field: "billing_address",
        weight: "strong",
        rationale: "AVS full match is weighed as authorization/participation signal.",
      },
      {
        field: "customer_name",
        weight: "supporting",
        rationale: "Identity consistency across order, card, and delivery records.",
      },
      {
        field: "receipt",
        weight: "supporting",
        rationale: "Documents what was purchased and by which account.",
      },
      {
        field: "product_description",
        weight: "supporting",
        rationale: "Frames the transaction as consistent with the customer's history.",
      },
    ],
  },

  product_not_received: {
    stripeReason: "product_not_received",
    summary: "Cardholder claims goods or services were not delivered.",
    network: {
      visa: {
        code: "13.1",
        name: "Merchandise/Services Not Received",
        citation:
          "Visa Core Rules §11, Consumer Disputes category 13.1: merchant remedy is proof of delivery to the agreed location, or proof services were provided/digital goods downloaded, before the dispute date.",
      },
      mastercard: {
        code: "4853",
        name: "Cardholder Dispute — Goods/Services Not Provided",
        citation:
          "Mastercard Chargeback Guide, 4853 chapter (Goods or Services Were Either Not as Described or Not Provided sub-reason): Second Presentment requires proof of delivery/provision or that the delivery date had not yet passed.",
      },
    },
    winCriteria:
      "Prove delivery to the address the cardholder agreed to (signed carrier confirmation strongest), or for services/digital goods, prove provision/access before the dispute.",
    evidence: [
      {
        field: "shipping_tracking_number",
        weight: "critical",
        rationale:
          "Carrier tracking showing delivered status is the primary 13.1/4853 remedy for physical goods.",
      },
      {
        field: "shipping_documentation",
        weight: "critical",
        rationale:
          "Proof-of-delivery documentation (signature confirmation) directly satisfies the networks' delivery-proof requirement.",
      },
      {
        field: "shipping_carrier",
        weight: "strong",
        rationale: "Required context for validating the tracking evidence.",
      },
      {
        field: "shipping_date",
        weight: "strong",
        rationale:
          "Shows shipment within the promised window and before the dispute date.",
      },
      {
        field: "shipping_address",
        weight: "strong",
        rationale:
          "Delivery must be to the address the cardholder provided — mismatch loses the case.",
      },
      {
        field: "access_activity_log",
        weight: "critical",
        rationale:
          "For digital goods/services: download/access logs are the equivalent of delivery proof (both networks accept usage evidence).",
      },
      {
        field: "service_date",
        weight: "strong",
        rationale: "For services: shows when the service was actually provided.",
      },
      {
        field: "service_documentation",
        weight: "strong",
        rationale: "For services: proof the service was performed as agreed.",
      },
      {
        field: "customer_email_address",
        weight: "supporting",
        rationale: "Order/shipping confirmations sent to the cardholder's address.",
      },
      {
        field: "receipt",
        weight: "supporting",
        rationale: "Establishes the expected delivery terms the evidence satisfies.",
      },
    ],
  },

  product_unacceptable: {
    stripeReason: "product_unacceptable",
    summary:
      "Cardholder claims the product/service was defective, damaged, or not as described.",
    network: {
      visa: {
        code: "13.3",
        name: "Not as Described or Defective Merchandise/Services",
        citation:
          "Visa Core Rules §11, category 13.3: merchant remedy is evidence the goods/services matched the description, or that the cardholder did not attempt return/cancellation per policy.",
      },
      mastercard: {
        code: "4853",
        name: "Cardholder Dispute — Not as Described/Defective",
        citation:
          "Mastercard Chargeback Guide, 4853 chapter: Second Presentment with rebuttal evidence that goods matched description and any return was refused per disclosed policy.",
      },
    },
    winCriteria:
      "Show the delivered item matched its description/specification and the cardholder failed to follow the disclosed return/refund process.",
    evidence: [
      {
        field: "product_description",
        weight: "critical",
        rationale:
          "The as-sold description is the baseline against which 'not as described' is judged.",
      },
      {
        field: "refund_policy",
        weight: "strong",
        rationale:
          "Networks weigh whether a compliant return path existed and was disclosed.",
      },
      {
        field: "refund_policy_disclosure",
        weight: "strong",
        rationale:
          "Proof the policy was presented at checkout defeats 'no recourse' claims (13.3 / 4853 rebuttal).",
      },
      {
        field: "refund_refusal_explanation",
        weight: "strong",
        rationale: "Why a refund was not owed under the disclosed policy.",
      },
      {
        field: "shipping_documentation",
        weight: "supporting",
        rationale: "Condition/contents at shipment (packing, QC records).",
      },
      {
        field: "customer_email_address",
        weight: "supporting",
        rationale: "Support correspondence showing resolution was offered.",
      },
      {
        field: "receipt",
        weight: "supporting",
        rationale: "What was actually ordered, tying to the description.",
      },
    ],
  },

  duplicate: {
    stripeReason: "duplicate",
    summary: "Cardholder claims they were charged more than once for the same purchase.",
    network: {
      visa: {
        code: "12.6.1",
        name: "Duplicate Processing",
        citation:
          "Visa Core Rules §11, Processing Errors category 12.6.1: remedy is proof the two transactions are distinct (separate receipts/orders/deliveries) or that a credit was already issued.",
      },
      mastercard: {
        code: "4834",
        name: "Point-of-Interaction Error — Duplication",
        citation:
          "Mastercard Chargeback Guide, 4834 chapter (Transaction Amount Differs / Duplication): Second Presentment showing two separate authorizations for two separate purchases.",
      },
    },
    winCriteria:
      "Prove the charges are for two distinct purchases (different items, receipts, delivery records), or that the duplicate was already refunded.",
    evidence: [
      {
        field: "duplicate_charge_id",
        weight: "critical",
        rationale:
          "Identifies the allegedly duplicated charge so the two can be compared line-by-line.",
      },
      {
        field: "duplicate_charge_explanation",
        weight: "critical",
        rationale:
          "The distinctness narrative is the required 12.6.1/4834 rebuttal.",
      },
      {
        field: "duplicate_charge_documentation",
        weight: "critical",
        rationale:
          "Separate receipts/invoices/delivery records are the documentary proof networks require.",
      },
      {
        field: "receipt",
        weight: "strong",
        rationale: "Receipt for the disputed charge, to contrast with the other charge.",
      },
      {
        field: "product_description",
        weight: "supporting",
        rationale: "Shows the two purchases covered different goods/services.",
      },
      {
        field: "shipping_documentation",
        weight: "supporting",
        rationale: "Two distinct deliveries imply two distinct purchases.",
      },
    ],
  },

  subscription_canceled: {
    stripeReason: "subscription_canceled",
    summary:
      "Cardholder claims they were billed after canceling a subscription (or cancellation was refused).",
    network: {
      visa: {
        code: "13.2",
        name: "Cancelled Recurring Transaction",
        citation:
          "Visa Core Rules §11, category 13.2: remedy is proof the cancellation was not received before the billing, that services were used after the claimed cancellation, or that cancellation terms were disclosed and followed.",
      },
      mastercard: {
        code: "4853",
        name: "Cardholder Dispute — Cancelled Recurring/Digital Goods",
        citation:
          "Mastercard Chargeback Guide, 4853 chapter (Recurring Transaction Cancelled sub-reason): Second Presentment with proof of continued use after cancellation date or that no valid cancellation preceded billing.",
      },
    },
    winCriteria:
      "Show no valid cancellation existed before the billing date, cancellation terms were disclosed and honored, and/or the service was used after the claimed cancellation.",
    evidence: [
      {
        field: "cancellation_policy",
        weight: "critical",
        rationale: "The terms governing when/how billing stops (13.2 remedy baseline).",
      },
      {
        field: "cancellation_policy_disclosure",
        weight: "critical",
        rationale:
          "Proof the cardholder saw and accepted those terms at signup — required to enforce them.",
      },
      {
        field: "cancellation_rebuttal",
        weight: "critical",
        rationale:
          "Rebuttal that no (timely) cancellation occurred is the core representment argument.",
      },
      {
        field: "access_activity_log",
        weight: "strong",
        rationale:
          "Usage after the claimed cancellation date is decisive under both networks.",
      },
      {
        field: "customer_email_address",
        weight: "supporting",
        rationale: "Billing reminders/renewal notices sent before the charge.",
      },
      {
        field: "receipt",
        weight: "supporting",
        rationale: "Shows the billing period covered by the disputed charge.",
      },
    ],
  },

  credit_not_processed: {
    stripeReason: "credit_not_processed",
    summary:
      "Cardholder claims a promised refund/credit was never issued.",
    network: {
      visa: {
        code: "13.6",
        name: "Credit Not Processed",
        citation:
          "Visa Core Rules §11, category 13.6: remedy is proof credit was issued, or that no credit is due under the disclosed refund policy.",
      },
      mastercard: {
        code: "4860",
        name: "Credit Not Processed",
        citation:
          "Mastercard Chargeback Guide, 4860 chapter: Second Presentment with proof of credit or documentation that the refund conditions were not met.",
      },
    },
    winCriteria:
      "Prove a credit was already issued, or that under the disclosed refund policy no credit was owed (e.g., outside return window, item not returned).",
    evidence: [
      {
        field: "refund_policy",
        weight: "critical",
        rationale: "Defines whether a credit was owed at all.",
      },
      {
        field: "refund_policy_disclosure",
        weight: "critical",
        rationale: "Policy is only enforceable if disclosed before purchase (13.6/4860).",
      },
      {
        field: "refund_refusal_explanation",
        weight: "critical",
        rationale: "Why the specific refund request did not qualify.",
      },
      {
        field: "receipt",
        weight: "supporting",
        rationale: "Purchase terms the policy applies to.",
      },
      {
        field: "customer_email_address",
        weight: "supporting",
        rationale: "Correspondence about the refund request and its resolution.",
      },
    ],
  },

  unrecognized: {
    stripeReason: "unrecognized",
    summary: "Cardholder does not recognize the charge on their statement.",
    network: {
      visa: {
        code: "10.4",
        name: "Other Fraud — Card-Absent Environment (often filed as fraud)",
        citation:
          "Visa retired the standalone 'unrecognized' category (legacy 75); issuers file these under fraud 10.4 — same compelling-evidence remedies apply, plus clear merchant descriptor evidence.",
      },
      mastercard: {
        code: "4863",
        name: "Cardholder Does Not Recognise — Potential Fraud",
        citation:
          "Mastercard Chargeback Guide, 4863 chapter: Second Presentment with transaction details that help the cardholder recognize the charge (descriptor, order details) and participation evidence.",
      },
    },
    winCriteria:
      "Help the issuer connect the charge to the cardholder: order details, identity linkage, and purchase-history evidence as with fraud claims.",
    evidence: [
      {
        field: "product_description",
        weight: "critical",
        rationale:
          "What was bought, in plain terms — recognition evidence is the 4863 remedy.",
      },
      {
        field: "customer_email_address",
        weight: "critical",
        rationale: "Ties the order to the cardholder's own account/email.",
      },
      {
        field: "customer_purchase_ip",
        weight: "strong",
        rationale: "Participation evidence as in fraud representment.",
      },
      {
        field: "receipt",
        weight: "strong",
        rationale: "Order confirmation the issuer can present to the cardholder.",
      },
      {
        field: "billing_address",
        weight: "supporting",
        rationale: "AVS match supports genuine-cardholder participation.",
      },
      {
        field: "shipping_tracking_number",
        weight: "supporting",
        rationale: "Delivery to the cardholder's address aids recognition.",
      },
    ],
  },

  general: {
    stripeReason: "general",
    summary:
      "Uncategorized dispute — Stripe could not map the issuer's reason to a specific category.",
    network: {
      visa: {
        code: "13.x/12.x",
        name: "Category determined by issuer filing",
        citation:
          "Visa Core Rules §11 — the specific dispute condition arrives with the issuer's filing; respond with the fullest available record.",
      },
      mastercard: {
        code: "4853/4837",
        name: "Category determined by issuer filing",
        citation:
          "Mastercard Chargeback Guide — chapter depends on the message reason code on the incoming chargeback.",
      },
    },
    winCriteria:
      "Without a specific condition, submit a complete transaction record: identity, authorization signals, delivery/provision proof, and policies.",
    evidence: [
      { field: "receipt", weight: "strong", rationale: "Core transaction record." },
      {
        field: "customer_email_address",
        weight: "strong",
        rationale: "Identity linkage.",
      },
      {
        field: "product_description",
        weight: "strong",
        rationale: "What the payment was for.",
      },
      {
        field: "shipping_tracking_number",
        weight: "strong",
        rationale: "Delivery proof if physical goods.",
      },
      {
        field: "access_activity_log",
        weight: "strong",
        rationale: "Provision proof if digital.",
      },
      {
        field: "customer_purchase_ip",
        weight: "supporting",
        rationale: "Participation signal.",
      },
      {
        field: "refund_policy",
        weight: "supporting",
        rationale: "Governing terms context.",
      },
    ],
  },
};

/**
 * Stripe reasons that indicate bank/processing conditions rather than a
 * cardholder representment we can fight with evidence. They still get the
 * 'general' full-record treatment.
 */
const FALLBACK_REASONS = new Set([
  "bank_cannot_process",
  "check_returned",
  "customer_initiated",
  "debit_not_authorized",
  "incorrect_account_details",
  "insufficient_funds",
  "noncompliant",
]);

export function configForReason(stripeReason: string): ReasonCodeConfig {
  const config = REASON_CODE_CONFIG[stripeReason];
  if (config) return config;
  if (FALLBACK_REASONS.has(stripeReason)) return REASON_CODE_CONFIG.general;
  return REASON_CODE_CONFIG.general;
}
