import { hashApiKey } from "@/lib/apikeys";
import {
  TERMINAL_STATUSES,
  type ApiKeyContext,
  type IngestClaim,
  type IngestStore,
  type RunIngest,
} from "@/lib/ingest/types";

interface StoredRequest {
  status: "received" | "processed" | "failed";
  error?: string;
}

export interface StoredRun {
  id: string;
  orgId: string;
  agentId: string;
  externalRunId: string;
  status: string;
  error: string | null;
  model: string | null;
}

/**
 * In-memory IngestStore + key resolver mirroring the Supabase store's
 * semantics (unique idempotency keys, agent/run upserts, terminal runs
 * never regress, duplicate event seqs ignored).
 */
export class InMemoryIngest implements IngestStore {
  requests = new Map<string, StoredRequest>();
  agents = new Map<string, { id: string; name: string | null }>();
  runs = new Map<string, StoredRun>();
  events = new Map<string, Set<number>>();
  keys = new Map<string, ApiKeyContext>(); // keyHash → context
  touchedKeys: string[] = [];
  failNextUpsert = false;

  private nextId = 0;

  addKey(plaintext: string, context: ApiKeyContext) {
    this.keys.set(hashApiKey(plaintext), context);
  }

  resolveApiKey = async (keyHash: string): Promise<ApiKeyContext | null> =>
    this.keys.get(keyHash) ?? null;

  async claimRequest(input: {
    orgId: string;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<IngestClaim> {
    const key = `${input.orgId}:${input.idempotencyKey}`;
    const existing = this.requests.get(key);
    if (existing) return existing.status === "processed" ? "duplicate" : "retry";
    this.requests.set(key, { status: "received" });
    return "new";
  }

  async markProcessed(orgId: string, idempotencyKey: string): Promise<void> {
    this.requests.set(`${orgId}:${idempotencyKey}`, { status: "processed" });
  }

  async markFailed(orgId: string, idempotencyKey: string, error: string): Promise<void> {
    this.requests.set(`${orgId}:${idempotencyKey}`, { status: "failed", error });
  }

  async upsertAgent(orgId: string, externalId: string, name: string | null): Promise<string> {
    const key = `${orgId}:${externalId}`;
    const existing = this.agents.get(key);
    if (existing) {
      if (name !== null) existing.name = name;
      return existing.id;
    }
    const id = `agent_${++this.nextId}`;
    this.agents.set(key, { id, name });
    return id;
  }

  async upsertRun(orgId: string, agentId: string, run: RunIngest["run"]): Promise<string> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("injected upsert failure");
    }
    const key = `${orgId}:${run.external_run_id}`;
    const existing = this.runs.get(key);
    const incomingTerminal = TERMINAL_STATUSES.has(run.status);
    const keepStatus = existing && TERMINAL_STATUSES.has(existing.status) && !incomingTerminal;

    const stored: StoredRun = {
      id: existing?.id ?? `run_${++this.nextId}`,
      orgId,
      agentId,
      externalRunId: run.external_run_id,
      status: keepStatus ? existing.status : run.status,
      error: run.error ?? null,
      model: run.model ?? null,
    };
    this.runs.set(key, stored);
    return stored.id;
  }

  async insertEvents(
    _orgId: string,
    runId: string,
    events: { seq: number }[]
  ): Promise<number> {
    const seen = this.events.get(runId) ?? new Set<number>();
    for (const event of events) seen.add(event.seq);
    this.events.set(runId, seen);
    return events.length;
  }

  async touchApiKey(apiKeyId: string): Promise<void> {
    this.touchedKeys.push(apiKeyId);
  }
}
