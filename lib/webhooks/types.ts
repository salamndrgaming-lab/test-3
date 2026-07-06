import { z } from "zod";

/**
 * Zod schema for the subset of Stripe's Dispute object we persist.
 * Everything else is kept in the raw payload column.
 */
export const stripeDisputeSchema = z.object({
  id: z.string().startsWith("dp_").or(z.string().startsWith("du_")),
  object: z.literal("dispute"),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(3),
  charge: z.union([z.string(), z.object({ id: z.string() }).loose()]),
  reason: z.string(),
  status: z.string(),
  evidence_details: z
    .object({ due_by: z.number().int().nullable().optional() })
    .loose()
    .nullable()
    .optional(),
  is_charge_refundable: z.boolean().optional(),
  livemode: z.boolean(),
  created: z.number().int(),
});

export type StripeDispute = z.infer<typeof stripeDisputeSchema>;

export function disputeChargeId(dispute: StripeDispute): string {
  return typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
}

/** Our internal dispute lifecycle. */
export type DisputeLifecycleStatus =
  | "new"
  | "evidence_gathering"
  | "drafted"
  | "submitted"
  | "won"
  | "lost";

export interface DisputeUpsert {
  orgId: string;
  connectedAccountId: string;
  stripeDisputeId: string;
  stripeChargeId: string;
  amount: number;
  currency: string;
  reason: string;
  stripeStatus: string;
  evidenceDueBy: string | null;
  isChargeRefundable: boolean | null;
  livemode: boolean;
  raw: unknown;
  stripeCreatedAt: string;
  /** Lifecycle status to set; null = leave existing lifecycle untouched. */
  lifecycleStatus: DisputeLifecycleStatus | null;
}

export interface OutcomeRecord {
  orgId: string;
  stripeDisputeId: string;
  result: "won" | "lost";
  amountRecovered: number;
  feeAmount: number;
  closedAt: string;
}

export interface ConnectedAccountRef {
  id: string;
  orgId: string;
  /** Org success-fee rate as a fraction, e.g. 0.15. */
  feeRate: number;
}

/** 'new' = first delivery; 'retry' = seen before but not processed; 'duplicate' = already processed. */
export type EventClaim = "new" | "retry" | "duplicate";

/**
 * Persistence boundary for webhook processing. The production
 * implementation is backed by Supabase; tests use an in-memory store.
 */
export interface WebhookStore {
  claimEvent(input: {
    stripeEventId: string;
    type: string;
    stripeAccount: string | null;
    payload: unknown;
  }): Promise<EventClaim>;
  markEventProcessed(stripeEventId: string): Promise<void>;
  markEventFailed(stripeEventId: string, error: string): Promise<void>;
  findConnectedAccount(stripeAccountId: string): Promise<ConnectedAccountRef | null>;
  upsertDispute(input: DisputeUpsert): Promise<void>;
  recordOutcome(input: OutcomeRecord): Promise<void>;
}

export type WebhookProcessResult =
  | { outcome: "processed"; action: string }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string };
