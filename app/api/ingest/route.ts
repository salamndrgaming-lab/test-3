import { handleIngestRequest } from "@/lib/ingest/http";
import { resolveApiKeySupabase, SupabaseIngestStore } from "@/lib/ingest/supabase-store";

export const dynamic = "force-dynamic";

/**
 * Ingest endpoint for agent runs and trace events.
 * Auth: `Authorization: Bearer al_sk_...` (hashed lookup, revocable).
 * Idempotency: required `Idempotency-Key` header, unique per org.
 */
export async function POST(request: Request) {
  return handleIngestRequest(request, {
    resolveApiKey: (keyHash) => resolveApiKeySupabase(keyHash),
    store: new SupabaseIngestStore(),
  });
}
