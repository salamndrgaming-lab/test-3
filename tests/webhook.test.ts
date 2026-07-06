import { beforeEach, describe, expect, it } from "vitest";

// Env must be set before importing modules that read it (lazily cached).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_recoveryengine_secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

import { handleStripeWebhookRequest } from "@/lib/webhooks/http";
import { InMemoryWebhookStore } from "./helpers/in-memory-store";
import {
  disputeEvent,
  signedWebhookRequest,
  TEST_WEBHOOK_SECRET,
} from "./helpers/stripe-fixtures";

const ORG_A_ACCOUNT = "acct_test_org_a";

function makeStore() {
  const store = new InMemoryWebhookStore();
  store.addConnectedAccount(ORG_A_ACCOUNT, {
    id: "ca-row-1",
    orgId: "org-a",
    feeRate: 0.15,
  });
  return store;
}

describe("Stripe webhook endpoint", () => {
  let store: InMemoryWebhookStore;

  beforeEach(() => {
    store = makeStore();
  });

  describe("signature verification", () => {
    it("rejects requests without a stripe-signature header", async () => {
      const request = new Request("http://localhost:3000/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify(disputeEvent()),
      });
      const response = await handleStripeWebhookRequest(request, store);
      expect(response.status).toBe(400);
      expect(store.events.size).toBe(0);
    });

    it("rejects requests signed with the wrong secret", async () => {
      const request = signedWebhookRequest(disputeEvent(), {
        secret: "whsec_wrong_secret",
      });
      const response = await handleStripeWebhookRequest(request, store);
      expect(response.status).toBe(400);
      expect(store.events.size).toBe(0);
    });

    it("rejects tampered payloads", async () => {
      const event = disputeEvent();
      const goodRequest = signedWebhookRequest(event, { secret: TEST_WEBHOOK_SECRET });
      const signature = goodRequest.headers.get("stripe-signature")!;
      const tampered = { ...event, data: { object: { ...event.data.object, amount: 1 } } };
      const request = new Request("http://localhost:3000/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: JSON.stringify(tampered),
      });
      const response = await handleStripeWebhookRequest(request, store);
      expect(response.status).toBe(400);
    });
  });

  describe("charge.dispute.created", () => {
    it("creates a dispute in lifecycle status 'new' for the right org", async () => {
      const event = disputeEvent({
        eventId: "evt_created_1",
        dispute: { disputeId: "dp_1", amount: 12345, reason: "product_not_received" },
      });
      const response = await handleStripeWebhookRequest(signedWebhookRequest(event), store);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        received: true,
        outcome: "processed",
      });

      const dispute = store.disputes.get("dp_1");
      expect(dispute).toBeDefined();
      expect(dispute).toMatchObject({
        orgId: "org-a",
        connectedAccountId: "ca-row-1",
        stripeChargeId: "ch_test_1",
        amount: 12345,
        currency: "usd",
        reason: "product_not_received",
        status: "new",
        stripeStatus: "needs_response",
      });
      expect(dispute!.evidenceDueBy).toBe(new Date(1783468800 * 1000).toISOString());
    });

    it("acknowledges but ignores events from unknown connected accounts", async () => {
      const event = disputeEvent({ account: "acct_someone_else" });
      const response = await handleStripeWebhookRequest(signedWebhookRequest(event), store);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome: "ignored" });
      expect(store.disputes.size).toBe(0);
    });

    it("acknowledges but ignores non-dispute event types", async () => {
      const event = { ...disputeEvent(), type: "payment_intent.succeeded" };
      const response = await handleStripeWebhookRequest(signedWebhookRequest(event), store);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome: "ignored" });
      expect(store.disputes.size).toBe(0);
    });
  });

  describe("idempotency", () => {
    it("processes a given event id exactly once", async () => {
      const event = disputeEvent({ eventId: "evt_dup", dispute: { disputeId: "dp_dup" } });

      const first = await handleStripeWebhookRequest(signedWebhookRequest(event), store);
      const second = await handleStripeWebhookRequest(signedWebhookRequest(event), store);

      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ outcome: "processed" });
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ outcome: "duplicate" });
      expect(store.disputes.size).toBe(1);
    });

    it("returns 500 on processing failure and succeeds on Stripe's retry", async () => {
      const event = disputeEvent({
        eventId: "evt_retry",
        dispute: { disputeId: "dp_retry" },
      });

      store.failNextUpsert = true;
      const failed = await handleStripeWebhookRequest(signedWebhookRequest(event), store);
      expect(failed.status).toBe(500);
      expect(store.events.get("evt_retry")?.status).toBe("failed");
      expect(store.disputes.size).toBe(0);

      const retried = await handleStripeWebhookRequest(signedWebhookRequest(event), store);
      expect(retried.status).toBe(200);
      expect(await retried.json()).toMatchObject({ outcome: "processed" });
      expect(store.disputes.get("dp_retry")).toBeDefined();
      expect(store.events.get("evt_retry")?.status).toBe("processed");
    });

    it("marks events with malformed dispute payloads as failed", async () => {
      const event = disputeEvent({ eventId: "evt_bad" });
      // Remove a required field after fixture construction.
      (event.data.object as Record<string, unknown>).amount = "not-a-number";

      const response = await handleStripeWebhookRequest(signedWebhookRequest(event), store);
      expect(response.status).toBe(500);
      expect(store.events.get("evt_bad")?.status).toBe("failed");
      expect(store.disputes.size).toBe(0);
    });
  });

  describe("charge.dispute.updated", () => {
    it("refreshes Stripe fields without regressing our lifecycle status", async () => {
      const created = disputeEvent({
        eventId: "evt_u1",
        dispute: { disputeId: "dp_u" },
      });
      await handleStripeWebhookRequest(signedWebhookRequest(created), store);

      // Simulate downstream pipeline advancing the dispute.
      store.disputes.get("dp_u")!.status = "drafted";

      const updated = disputeEvent({
        eventId: "evt_u2",
        type: "charge.dispute.updated",
        dispute: { disputeId: "dp_u", status: "under_review" },
      });
      const response = await handleStripeWebhookRequest(signedWebhookRequest(updated), store);

      expect(response.status).toBe(200);
      const dispute = store.disputes.get("dp_u")!;
      expect(dispute.status).toBe("drafted");
      expect(dispute.stripeStatus).toBe("under_review");
    });
  });

  describe("charge.dispute.closed", () => {
    it("marks won disputes and records the recovery with our success fee", async () => {
      const created = disputeEvent({
        eventId: "evt_w1",
        dispute: { disputeId: "dp_w", amount: 10000 },
      });
      await handleStripeWebhookRequest(signedWebhookRequest(created), store);

      const closed = disputeEvent({
        eventId: "evt_w2",
        type: "charge.dispute.closed",
        dispute: { disputeId: "dp_w", amount: 10000, status: "won" },
      });
      const response = await handleStripeWebhookRequest(signedWebhookRequest(closed), store);

      expect(response.status).toBe(200);
      expect(store.disputes.get("dp_w")!.status).toBe("won");

      const outcome = store.outcomes.get("dp_w");
      expect(outcome).toMatchObject({
        orgId: "org-a",
        result: "won",
        amountRecovered: 10000,
        feeAmount: 1500, // 15% of the recovered amount
      });
    });

    it("marks lost disputes with zero recovery and zero fee", async () => {
      const created = disputeEvent({
        eventId: "evt_l1",
        dispute: { disputeId: "dp_l", amount: 8000 },
      });
      await handleStripeWebhookRequest(signedWebhookRequest(created), store);

      const closed = disputeEvent({
        eventId: "evt_l2",
        type: "charge.dispute.closed",
        dispute: { disputeId: "dp_l", amount: 8000, status: "lost" },
      });
      await handleStripeWebhookRequest(signedWebhookRequest(closed), store);

      expect(store.disputes.get("dp_l")!.status).toBe("lost");
      expect(store.outcomes.get("dp_l")).toMatchObject({
        result: "lost",
        amountRecovered: 0,
        feeAmount: 0,
      });
    });

    it("handles closed events for disputes we never saw created", async () => {
      const closed = disputeEvent({
        eventId: "evt_orphan",
        type: "charge.dispute.closed",
        dispute: { disputeId: "dp_orphan", amount: 4200, status: "won" },
      });
      const response = await handleStripeWebhookRequest(signedWebhookRequest(closed), store);

      expect(response.status).toBe(200);
      expect(store.disputes.get("dp_orphan")!.status).toBe("won");
      expect(store.outcomes.get("dp_orphan")).toMatchObject({
        result: "won",
        amountRecovered: 4200,
        feeAmount: 630,
      });
    });
  });
});
