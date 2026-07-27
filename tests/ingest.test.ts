import { beforeEach, describe, expect, it } from "vitest";

import { handleIngestRequest } from "@/lib/ingest/http";
import { InMemoryIngest } from "./helpers/in-memory-ingest";

const KEY = "al_sk_test_0123456789abcdef0123456789abcdef";
const URL = "http://localhost:3000/api/ingest";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    runs: [
      {
        agent: { external_id: "support-bot", name: "Support Bot" },
        run: {
          external_run_id: "run_001",
          status: "failed",
          started_at: "2026-07-27T12:00:00Z",
          ended_at: "2026-07-27T12:00:41Z",
          model: "claude-opus-4-8",
          input_tokens: 5210,
          output_tokens: 1874,
          error: "tool loop detected",
          ...((overrides.run as object) ?? {}),
        },
        events: (overrides.events as unknown[]) ?? [
          { seq: 0, type: "llm_call", name: "plan", occurred_at: "2026-07-27T12:00:01Z" },
          { seq: 1, type: "tool_call", name: "search_docs", occurred_at: "2026-07-27T12:00:03Z" },
        ],
      },
    ],
    ...((overrides.top as object) ?? {}),
  };
}

function request(
  body: unknown,
  { auth = `Bearer ${KEY}`, idem = "idem-1" }: { auth?: string | null; idem?: string | null } = {}
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  if (idem) headers["idempotency-key"] = idem;
  return new Request(URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("ingest API", () => {
  let store: InMemoryIngest;

  beforeEach(() => {
    store = new InMemoryIngest();
    store.addKey(KEY, { orgId: "org-a", apiKeyId: "key-1" });
  });

  const deps = () => ({ resolveApiKey: store.resolveApiKey, store });

  describe("authentication", () => {
    it("rejects requests without an Authorization header", async () => {
      const res = await handleIngestRequest(request(payload(), { auth: null }), deps());
      expect(res.status).toBe(401);
      expect(store.requests.size).toBe(0);
    });

    it("rejects unknown and revoked keys", async () => {
      const res = await handleIngestRequest(
        request(payload(), { auth: "Bearer al_sk_unknown_key_material_here" }),
        deps()
      );
      expect(res.status).toBe(401);
    });

    it("rejects malformed bearer schemes", async () => {
      const res = await handleIngestRequest(
        request(payload(), { auth: `Basic ${KEY}` }),
        deps()
      );
      expect(res.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("requires an Idempotency-Key header", async () => {
      const res = await handleIngestRequest(request(payload(), { idem: null }), deps());
      expect(res.status).toBe(400);
    });

    it("rejects non-JSON bodies", async () => {
      const res = await handleIngestRequest(
        new Request(URL, {
          method: "POST",
          headers: { authorization: `Bearer ${KEY}`, "idempotency-key": "x" },
          body: "not json",
        }),
        deps()
      );
      expect(res.status).toBe(400);
    });

    it("rejects payloads that fail the zod schema", async () => {
      const bad = payload({ run: { status: "exploded" } });
      const res = await handleIngestRequest(request(bad), deps());
      expect(res.status).toBe(422);
      expect(store.runs.size).toBe(0);
    });

    it("rejects empty run batches", async () => {
      const res = await handleIngestRequest(request({ runs: [] }), deps());
      expect(res.status).toBe(422);
    });
  });

  describe("processing", () => {
    it("stores agent, run, and events for a valid batch", async () => {
      const res = await handleIngestRequest(request(payload()), deps());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, outcome: "processed", runs: 1, events: 2 });

      expect(store.agents.get("org-a:support-bot")).toBeDefined();
      const run = store.runs.get("org-a:run_001");
      expect(run).toMatchObject({ status: "failed", model: "claude-opus-4-8" });
      expect(store.events.get(run!.id)?.size).toBe(2);
      expect(store.touchedKeys).toContain("key-1");
    });

    it("is idempotent: the same Idempotency-Key never reprocesses", async () => {
      await handleIngestRequest(request(payload()), deps());
      const second = await handleIngestRequest(
        request(payload(), { idem: "idem-1" }),
        deps()
      );
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ outcome: "duplicate" });
      expect(store.runs.size).toBe(1);
    });

    it("reprocesses after a failure when the client retries the same key", async () => {
      store.failNextUpsert = true;
      const failed = await handleIngestRequest(request(payload()), deps());
      expect(failed.status).toBe(500);
      expect(store.requests.get("org-a:idem-1")?.status).toBe("failed");

      const retried = await handleIngestRequest(request(payload()), deps());
      expect(retried.status).toBe(200);
      expect(await retried.json()).toMatchObject({ outcome: "processed" });
      expect(store.runs.get("org-a:run_001")).toBeDefined();
    });

    it("never regresses a terminal run back to running", async () => {
      await handleIngestRequest(request(payload()), deps()); // failed (terminal)
      const regression = payload({ run: { status: "running" } });
      await handleIngestRequest(request(regression, { idem: "idem-2" }), deps());
      expect(store.runs.get("org-a:run_001")?.status).toBe("failed");
    });

    it("allows running → completed transitions", async () => {
      await handleIngestRequest(
        request(payload({ run: { status: "running" } }), { idem: "a" }),
        deps()
      );
      await handleIngestRequest(
        request(payload({ run: { status: "completed" } }), { idem: "b" }),
        deps()
      );
      expect(store.runs.get("org-a:run_001")?.status).toBe("completed");
    });

    it("ignores replayed event sequence numbers", async () => {
      await handleIngestRequest(request(payload()), deps());
      await handleIngestRequest(request(payload(), { idem: "idem-2" }), deps());
      const run = store.runs.get("org-a:run_001")!;
      expect(store.events.get(run.id)?.size).toBe(2); // not 4
    });
  });
});
