import type { ApiKeyContext, IngestPayload, IngestResult, IngestStore } from "./types";

/**
 * Processes a validated ingest batch. Idempotent per (org, Idempotency-Key):
 * duplicates are acknowledged without reprocessing; failed requests are
 * marked so the client's retry reprocesses them.
 */
export async function processIngest(
  payload: IngestPayload,
  key: ApiKeyContext,
  idempotencyKey: string,
  store: IngestStore
): Promise<IngestResult> {
  const claim = await store.claimRequest({
    orgId: key.orgId,
    idempotencyKey,
    payload,
  });
  if (claim === "duplicate") {
    return { outcome: "duplicate" };
  }

  try {
    let eventCount = 0;
    for (const item of payload.runs) {
      const agentId = await store.upsertAgent(
        key.orgId,
        item.agent.external_id,
        item.agent.name ?? null
      );
      const runId = await store.upsertRun(key.orgId, agentId, item.run);
      if (item.events.length > 0) {
        eventCount += await store.insertEvents(key.orgId, runId, item.events);
      }
    }

    await store.touchApiKey(key.apiKeyId);
    await store.markProcessed(key.orgId, idempotencyKey);
    return { outcome: "processed", runs: payload.runs.length, events: eventCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.markFailed(key.orgId, idempotencyKey, message);
    throw err;
  }
}
