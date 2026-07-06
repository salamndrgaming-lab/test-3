import type {
  ConnectedAccountRef,
  DisputeUpsert,
  EventClaim,
  OutcomeRecord,
  WebhookStore,
} from "@/lib/webhooks/types";

interface StoredEvent {
  type: string;
  stripeAccount: string | null;
  status: "received" | "processed" | "failed";
  error?: string;
}

export interface StoredDispute extends Omit<DisputeUpsert, "lifecycleStatus"> {
  status: string;
}

/**
 * In-memory WebhookStore mirroring the semantics of the Supabase store
 * (unique event ids, upsert-by-stripe_dispute_id, lifecycle preserved when
 * lifecycleStatus is null). Used by webhook integration tests.
 */
export class InMemoryWebhookStore implements WebhookStore {
  events = new Map<string, StoredEvent>();
  disputes = new Map<string, StoredDispute>();
  outcomes = new Map<string, OutcomeRecord>();
  accounts = new Map<string, ConnectedAccountRef>();

  /** Optional fault injection for retry tests. */
  failNextUpsert = false;

  addConnectedAccount(stripeAccountId: string, ref: ConnectedAccountRef) {
    this.accounts.set(stripeAccountId, ref);
  }

  async claimEvent(input: {
    stripeEventId: string;
    type: string;
    stripeAccount: string | null;
    payload: unknown;
  }): Promise<EventClaim> {
    const existing = this.events.get(input.stripeEventId);
    if (existing) {
      return existing.status === "processed" ? "duplicate" : "retry";
    }
    this.events.set(input.stripeEventId, {
      type: input.type,
      stripeAccount: input.stripeAccount,
      status: "received",
    });
    return "new";
  }

  async markEventProcessed(stripeEventId: string): Promise<void> {
    const event = this.events.get(stripeEventId);
    if (!event) throw new Error(`event ${stripeEventId} not claimed`);
    event.status = "processed";
  }

  async markEventFailed(stripeEventId: string, error: string): Promise<void> {
    const event = this.events.get(stripeEventId);
    if (!event) throw new Error(`event ${stripeEventId} not claimed`);
    event.status = "failed";
    event.error = error;
  }

  async findConnectedAccount(stripeAccountId: string): Promise<ConnectedAccountRef | null> {
    return this.accounts.get(stripeAccountId) ?? null;
  }

  async upsertDispute(input: DisputeUpsert): Promise<void> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("injected upsert failure");
    }
    const existing = this.disputes.get(input.stripeDisputeId);
    const { lifecycleStatus, ...fields } = input;
    this.disputes.set(input.stripeDisputeId, {
      ...fields,
      status: lifecycleStatus ?? existing?.status ?? "new",
    });
  }

  async recordOutcome(input: OutcomeRecord): Promise<void> {
    if (!this.disputes.has(input.stripeDisputeId)) {
      throw new Error(`dispute ${input.stripeDisputeId} not found`);
    }
    this.outcomes.set(input.stripeDisputeId, input);
  }
}
