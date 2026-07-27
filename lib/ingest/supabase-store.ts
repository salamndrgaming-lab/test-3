import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  TERMINAL_STATUSES,
  type ApiKeyContext,
  type IngestClaim,
  type IngestStore,
  type RunIngest,
  type runEventSchema,
} from "./types";
import type { z } from "zod";

/** Resolves an API key hash against api_keys (active keys only). */
export async function resolveApiKeySupabase(
  keyHash: string,
  db: SupabaseClient = createAdminClient()
): Promise<ApiKeyContext | null> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, org_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return { orgId: data.org_id, apiKeyId: data.id };
}

/**
 * Production IngestStore backed by Supabase (service role; tenancy comes
 * from the resolved API key's org).
 */
export class SupabaseIngestStore implements IngestStore {
  private client: SupabaseClient | null;

  constructor(db?: SupabaseClient) {
    this.client = db ?? null;
  }

  /** Lazy: the admin client (and its env validation) is only touched after auth. */
  private get db(): SupabaseClient {
    if (!this.client) this.client = createAdminClient();
    return this.client;
  }

  async claimRequest(input: {
    orgId: string;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<IngestClaim> {
    const { error } = await this.db.from("ingest_events").insert({
      org_id: input.orgId,
      idempotency_key: input.idempotencyKey,
      status: "received",
      payload: input.payload,
    });
    if (!error) return "new";
    if (error.code !== "23505") {
      throw new Error(`claimRequest failed: ${error.message}`);
    }

    const { data, error: readError } = await this.db
      .from("ingest_events")
      .select("status")
      .eq("org_id", input.orgId)
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    if (readError || !data) {
      throw new Error(`claimRequest read-back failed: ${readError?.message}`);
    }
    return data.status === "processed" ? "duplicate" : "retry";
  }

  async markProcessed(orgId: string, idempotencyKey: string): Promise<void> {
    const { error } = await this.db
      .from("ingest_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("org_id", orgId)
      .eq("idempotency_key", idempotencyKey);
    if (error) throw new Error(`markProcessed failed: ${error.message}`);
  }

  async markFailed(orgId: string, idempotencyKey: string, message: string): Promise<void> {
    const { error } = await this.db
      .from("ingest_events")
      .update({ status: "failed", error: message })
      .eq("org_id", orgId)
      .eq("idempotency_key", idempotencyKey);
    if (error) throw new Error(`markFailed failed: ${error.message}`);
  }

  async upsertAgent(orgId: string, externalId: string, name: string | null): Promise<string> {
    const row: Record<string, unknown> = { org_id: orgId, external_id: externalId };
    if (name !== null) row.name = name;
    const { data, error } = await this.db
      .from("agents")
      .upsert(row, { onConflict: "org_id,external_id" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`upsertAgent failed: ${error?.message}`);
    return data.id;
  }

  async upsertRun(orgId: string, agentId: string, run: RunIngest["run"]): Promise<string> {
    // Fetch existing to enforce lifecycle: terminal runs never regress.
    const { data: existing, error: readError } = await this.db
      .from("runs")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("external_run_id", run.external_run_id)
      .maybeSingle();
    if (readError) throw new Error(`upsertRun read failed: ${readError.message}`);

    const incomingTerminal = TERMINAL_STATUSES.has(run.status);
    const keepExistingStatus =
      existing && TERMINAL_STATUSES.has(existing.status) && !incomingTerminal;

    const row: Record<string, unknown> = {
      org_id: orgId,
      agent_id: agentId,
      external_run_id: run.external_run_id,
      started_at: run.started_at,
      ended_at: run.ended_at ?? null,
      model: run.model ?? null,
      input_tokens: run.input_tokens ?? null,
      output_tokens: run.output_tokens ?? null,
      cost_micro_usd: run.cost_micro_usd ?? null,
      error: run.error ?? null,
      metadata: run.metadata ?? {},
    };
    if (!keepExistingStatus) row.status = run.status;

    const { data, error } = await this.db
      .from("runs")
      .upsert(row, { onConflict: "org_id,external_run_id" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`upsertRun failed: ${error?.message}`);
    return data.id;
  }

  async insertEvents(
    orgId: string,
    runId: string,
    events: z.infer<typeof runEventSchema>[]
  ): Promise<number> {
    if (events.length === 0) return 0;
    const rows = events.map((event) => ({
      org_id: orgId,
      run_id: runId,
      seq: event.seq,
      type: event.type,
      name: event.name ?? null,
      payload: event.payload ?? {},
      occurred_at: event.occurred_at,
    }));
    // Replays of the same seq are ignored (append-only trace).
    const { error } = await this.db
      .from("run_events")
      .upsert(rows, { onConflict: "run_id,seq", ignoreDuplicates: true });
    if (error) throw new Error(`insertEvents failed: ${error.message}`);
    return rows.length;
  }

  async touchApiKey(apiKeyId: string): Promise<void> {
    await this.db
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", apiKeyId);
  }
}
