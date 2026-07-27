import { z } from "zod";

/**
 * Ingest payload schema. Customers batch one or more runs per request;
 * each run may carry ordered trace events. Everything is zod-validated —
 * a malformed batch is rejected wholesale with a 422.
 */

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO timestamp");

export const RUN_STATUSES = ["running", "completed", "failed", "timeout", "canceled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses that end a run; a terminal run never reverts to running. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "timeout",
  "canceled",
]);

export const runEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.enum(["llm_call", "tool_call", "error", "log", "custom"]),
  name: z.string().max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  occurred_at: isoDate,
});

export const runIngestSchema = z.object({
  agent: z.object({
    external_id: z.string().min(1).max(200),
    name: z.string().max(200).optional(),
  }),
  run: z.object({
    external_run_id: z.string().min(1).max(200),
    status: z.enum(RUN_STATUSES),
    started_at: isoDate,
    ended_at: isoDate.optional(),
    model: z.string().max(100).optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cost_micro_usd: z.number().int().nonnegative().optional(),
    error: z.string().max(10000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  events: z.array(runEventSchema).max(500).default([]),
});

export const ingestPayloadSchema = z.object({
  runs: z.array(runIngestSchema).min(1).max(100),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type RunIngest = z.infer<typeof runIngestSchema>;

/** 'new' = first delivery; 'retry' = seen but unprocessed; 'duplicate' = already processed. */
export type IngestClaim = "new" | "retry" | "duplicate";

export interface ApiKeyContext {
  orgId: string;
  apiKeyId: string;
}

/**
 * Persistence boundary for ingest processing. Production is Supabase;
 * tests use an in-memory implementation.
 */
export interface IngestStore {
  claimRequest(input: {
    orgId: string;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<IngestClaim>;
  markProcessed(orgId: string, idempotencyKey: string): Promise<void>;
  markFailed(orgId: string, idempotencyKey: string, error: string): Promise<void>;
  upsertAgent(orgId: string, externalId: string, name: string | null): Promise<string>;
  upsertRun(orgId: string, agentId: string, run: RunIngest["run"]): Promise<string>;
  insertEvents(
    orgId: string,
    runId: string,
    events: z.infer<typeof runEventSchema>[]
  ): Promise<number>;
  touchApiKey(apiKeyId: string): Promise<void>;
}

export type IngestResult =
  | { outcome: "processed"; runs: number; events: number }
  | { outcome: "duplicate" };
