import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { NEW_KEY_COOKIE } from "@/lib/apikeys";
import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createApiKey, revokeApiKey } from "./actions";

export const dynamic = "force-dynamic";

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function ingestSnippet(appUrl: string): string {
  return `curl -X POST ${appUrl}/api/ingest \\
  -H "Authorization: Bearer al_sk_YOUR_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "runs": [{
      "agent": { "external_id": "support-bot", "name": "Support Bot" },
      "run": {
        "external_run_id": "run_001",
        "status": "failed",
        "started_at": "2026-07-27T12:00:00Z",
        "ended_at": "2026-07-27T12:00:41Z",
        "model": "claude-opus-4-8",
        "input_tokens": 5210, "output_tokens": 1874,
        "error": "tool loop: search_docs called 12x with same query"
      },
      "events": [
        { "seq": 0, "type": "llm_call", "name": "plan", "occurred_at": "2026-07-27T12:00:01Z" },
        { "seq": 1, "type": "tool_call", "name": "search_docs", "occurred_at": "2026-07-27T12:00:03Z" },
        { "seq": 2, "type": "error", "name": "loop_detected", "occurred_at": "2026-07-27T12:00:40Z" }
      ]
    }]
  }'`;
}

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; revoked?: string }>;
}) {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);
  if (isGuest) {
    return (
      <main>
        <Alert>
          <AlertTitle>Guest mode</AlertTitle>
          <AlertDescription>
            API keys are stored per organization and activate once Supabase is configured.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const flags = await searchParams;
  const cookieStore = await cookies();
  const newKey = cookieStore.get(NEW_KEY_COOKIE)?.value ?? null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  const keys = (data ?? []) as KeyRow[];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-domain";

  return (
    <main className="space-y-6">
      {flags.error && (
        <Alert variant="destructive">
          <AlertDescription>{flags.error}</AlertDescription>
        </Alert>
      )}
      {flags.revoked && (
        <Alert variant="success">
          <AlertDescription>Key revoked. Requests with it now return 401.</AlertDescription>
        </Alert>
      )}
      {newKey && (
        <Alert variant="success">
          <AlertTitle>API key created — copy it now</AlertTitle>
          <AlertDescription>
            <p>This is the only time the full key is shown:</p>
            <code className="mt-1 block break-all rounded bg-muted p-2 font-mono text-xs">
              {newKey}
            </code>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Keys authenticate your agents against the ingest API. Only a hash is stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={createApiKey} className="flex gap-2">
            <Input name="name" placeholder="Key name (e.g. production)" className="max-w-xs" />
            <Button type="submit">Create key</Button>
          </form>

          {keys.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Key</th>
                  <th className="pb-2 pr-4 font-medium">Created</th>
                  <th className="pb-2 pr-4 font-medium">Last used</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{key.name}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{key.key_prefix}…</td>
                    <td className="py-2 pr-4">{new Date(key.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "never"}
                    </td>
                    <td className="py-2 text-right">
                      {key.revoked_at ? (
                        <Badge variant="secondary">revoked</Badge>
                      ) : (
                        <form action={revokeApiKey}>
                          <input type="hidden" name="keyId" value={key.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Revoke
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send your first run</CardTitle>
          <CardDescription>
            POST batches of runs + trace events. The Idempotency-Key makes retries safe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {ingestSnippet(appUrl)}
          </pre>
        </CardContent>
      </Card>
    </main>
  );
}
