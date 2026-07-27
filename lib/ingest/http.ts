import { NextResponse } from "next/server";

import { bearerKey, hashApiKey } from "@/lib/apikeys";
import { processIngest } from "./handler";
import { ingestPayloadSchema, type ApiKeyContext, type IngestStore } from "./types";

export interface IngestDeps {
  /** Resolves a key hash to its org, or null for unknown/revoked keys. */
  resolveApiKey: (keyHash: string) => Promise<ApiKeyContext | null>;
  store: IngestStore;
}

/**
 * HTTP layer for POST /api/ingest. Separated from the route file so
 * integration tests can inject the key resolver and store while
 * exercising real auth, validation, and idempotency behavior.
 */
export async function handleIngestRequest(
  request: Request,
  deps: IngestDeps
): Promise<NextResponse> {
  const key = bearerKey(request.headers.get("authorization"));
  if (!key) {
    return NextResponse.json(
      { error: "missing or malformed Authorization: Bearer al_sk_... header" },
      { status: 401 }
    );
  }

  const context = await deps.resolveApiKey(hashApiKey(key));
  if (!context) {
    return NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json(
      { error: "Idempotency-Key header is required (max 200 chars)" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  const parsed = ingestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", issues: parsed.error.issues.slice(0, 10) },
      { status: 422 }
    );
  }

  try {
    const result = await processIngest(parsed.data, context, idempotencyKey, deps.store);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Ingest processing failed", err);
    return NextResponse.json(
      { error: "processing failed; retry with the same Idempotency-Key" },
      { status: 500 }
    );
  }
}
