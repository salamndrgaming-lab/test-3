import Stripe from "stripe";

export const TEST_WEBHOOK_SECRET = "whsec_test_recoveryengine_secret";

let counter = 0;

export interface DisputeFixtureOptions {
  disputeId?: string;
  chargeId?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  status?: string;
  dueBy?: number | null;
}

export function disputeObject(opts: DisputeFixtureOptions = {}) {
  return {
    id: opts.disputeId ?? `dp_test_${++counter}`,
    object: "dispute",
    amount: opts.amount ?? 5000,
    currency: opts.currency ?? "usd",
    charge: opts.chargeId ?? "ch_test_1",
    reason: opts.reason ?? "fraudulent",
    status: opts.status ?? "needs_response",
    evidence_details: {
      due_by: opts.dueBy === undefined ? 1783468800 : opts.dueBy,
      has_evidence: false,
      past_due: false,
      submission_count: 0,
    },
    is_charge_refundable: true,
    livemode: false,
    created: 1751846400,
  };
}

export interface EventFixtureOptions {
  eventId?: string;
  type?: string;
  account?: string | null;
  disputeOverride?: Record<string, unknown>;
  dispute?: DisputeFixtureOptions;
}

export function disputeEvent(opts: EventFixtureOptions = {}) {
  return {
    id: opts.eventId ?? `evt_test_${++counter}`,
    object: "event",
    api_version: "2025-06-30",
    created: 1751846400,
    ...(opts.account === null ? {} : { account: opts.account ?? "acct_test_org_a" }),
    data: {
      object: { ...disputeObject(opts.dispute), ...(opts.disputeOverride ?? {}) },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: opts.type ?? "charge.dispute.created",
  };
}

/**
 * Builds a Request with a genuine Stripe signature over the payload, using
 * the SDK's own test-header generator — the same HMAC scheme production
 * Stripe uses.
 */
export function signedWebhookRequest(
  payload: unknown,
  { secret = TEST_WEBHOOK_SECRET, url = "http://localhost:3000/api/webhooks/stripe" } = {}
): Request {
  const body = JSON.stringify(payload);
  const stripe = new Stripe("sk_test_dummy");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body,
  });
}
