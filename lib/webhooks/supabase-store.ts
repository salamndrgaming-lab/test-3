import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ConnectedAccountRef,
  DisputeUpsert,
  EventClaim,
  OutcomeRecord,
  WebhookStore,
} from "./types";

/**
 * Production WebhookStore backed by Supabase (service role — webhooks have
 * no user session; tenancy is resolved via the connected account id).
 */
export class SupabaseWebhookStore implements WebhookStore {
  private db: SupabaseClient;

  constructor(db: SupabaseClient = createAdminClient()) {
    this.db = db;
  }

  async claimEvent(input: {
    stripeEventId: string;
    type: string;
    stripeAccount: string | null;
    payload: unknown;
  }): Promise<EventClaim> {
    // Unique index on stripe_event_id makes this race-safe: exactly one
    // concurrent delivery inserts; the rest see the conflict.
    const { error } = await this.db.from("webhook_events").insert({
      stripe_event_id: input.stripeEventId,
      type: input.type,
      stripe_account: input.stripeAccount,
      status: "received",
      payload: input.payload,
    });

    if (!error) return "new";
    if (error.code !== "23505") {
      throw new Error(`claimEvent failed: ${error.message}`);
    }

    const { data, error: readError } = await this.db
      .from("webhook_events")
      .select("status")
      .eq("stripe_event_id", input.stripeEventId)
      .single();
    if (readError || !data) {
      throw new Error(`claimEvent read-back failed: ${readError?.message}`);
    }
    return data.status === "processed" ? "duplicate" : "retry";
  }

  async markEventProcessed(stripeEventId: string): Promise<void> {
    const { error } = await this.db
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("stripe_event_id", stripeEventId);
    if (error) throw new Error(`markEventProcessed failed: ${error.message}`);
  }

  async markEventFailed(stripeEventId: string, message: string): Promise<void> {
    const { error } = await this.db
      .from("webhook_events")
      .update({ status: "failed", error: message })
      .eq("stripe_event_id", stripeEventId);
    if (error) throw new Error(`markEventFailed failed: ${error.message}`);
  }

  async findConnectedAccount(stripeAccountId: string): Promise<ConnectedAccountRef | null> {
    const { data, error } = await this.db
      .from("connected_accounts")
      .select("id, org_id, organizations(fee_rate)")
      .eq("stripe_account_id", stripeAccountId)
      .maybeSingle();
    if (error) throw new Error(`findConnectedAccount failed: ${error.message}`);
    if (!data) return null;

    const org = Array.isArray(data.organizations)
      ? data.organizations[0]
      : data.organizations;
    return {
      id: data.id,
      orgId: data.org_id,
      feeRate: Number((org as { fee_rate: number } | null)?.fee_rate ?? 0.15),
    };
  }

  async upsertDispute(input: DisputeUpsert): Promise<void> {
    const row: Record<string, unknown> = {
      org_id: input.orgId,
      connected_account_id: input.connectedAccountId,
      stripe_dispute_id: input.stripeDisputeId,
      stripe_charge_id: input.stripeChargeId,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      stripe_status: input.stripeStatus,
      evidence_due_by: input.evidenceDueBy,
      is_charge_refundable: input.isChargeRefundable,
      livemode: input.livemode,
      raw: input.raw,
      stripe_created_at: input.stripeCreatedAt,
    };

    if (input.lifecycleStatus !== null) {
      row.status = input.lifecycleStatus;
    }

    const { error } = await this.db
      .from("disputes")
      .upsert(row, { onConflict: "stripe_dispute_id" });
    if (error) throw new Error(`upsertDispute failed: ${error.message}`);
  }

  async recordOutcome(input: OutcomeRecord): Promise<void> {
    const { data: dispute, error: findError } = await this.db
      .from("disputes")
      .select("id")
      .eq("stripe_dispute_id", input.stripeDisputeId)
      .single();
    if (findError || !dispute) {
      throw new Error(`recordOutcome: dispute ${input.stripeDisputeId} not found`);
    }

    const { error } = await this.db.from("outcomes").upsert(
      {
        org_id: input.orgId,
        dispute_id: dispute.id,
        result: input.result,
        amount_recovered: input.amountRecovered,
        fee_amount: input.feeAmount,
        closed_at: input.closedAt,
      },
      { onConflict: "dispute_id" }
    );
    if (error) throw new Error(`recordOutcome failed: ${error.message}`);
  }
}
