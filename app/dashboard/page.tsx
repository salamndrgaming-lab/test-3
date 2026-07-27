import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

export const dynamic = "force-dynamic";

interface RunRow {
  id: string;
  external_run_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_micro_usd: number | null;
  error: string | null;
  agents: { name: string | null; external_id: string } | { name: string | null; external_id: string }[] | null;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "success" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "timeout":
      return "destructive";
    case "running":
      return "default";
    default:
      return "secondary";
  }
}

function duration(run: RunRow): string {
  if (!run.ended_at) return "—";
  const ms = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
  if (ms < 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function cost(run: RunRow): string {
  if (run.cost_micro_usd == null) return "—";
  return `$${(run.cost_micro_usd / 1_000_000).toFixed(4)}`;
}

function agentLabel(run: RunRow): string {
  const agent = Array.isArray(run.agents) ? run.agents[0] : run.agents;
  return agent?.name ?? agent?.external_id ?? "unknown";
}

export default async function DashboardPage() {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);

  let runs: RunRow[] = [];
  let hasKeys = false;

  if (!isGuest) {
    const ctx = await getCurrentOrg();
    if (!ctx) redirect("/login");

    const supabase = await createClient();
    const [{ data: runRows }, { count }] = await Promise.all([
      supabase
        .from("runs")
        .select(
          "id, external_run_id, status, started_at, ended_at, model, input_tokens, output_tokens, cost_micro_usd, error, agents(name, external_id)"
        )
        .order("started_at", { ascending: false })
        .limit(100),
      supabase.from("api_keys").select("id", { count: "exact", head: true }).is("revoked_at", null),
    ]);
    runs = (runRows ?? []) as RunRow[];
    hasKeys = (count ?? 0) > 0;
  }

  const failed = runs.filter((r) => r.status === "failed" || r.status === "timeout");

  return (
    <main className="space-y-6">
      {isGuest && (
        <Alert>
          <AlertTitle>Guest mode</AlertTitle>
          <AlertDescription>
            You&apos;re previewing without a database. Runs stream in once Supabase is
            configured and your agents send traces to the ingest API.
          </AlertDescription>
        </Alert>
      )}

      {!isGuest && !hasKeys && (
        <Card>
          <CardHeader>
            <CardTitle>Connect your agents</CardTitle>
            <CardDescription>
              Create an API key, then send runs from your agent framework to the ingest API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/keys">Create an API key</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>
            {runs.length === 0
              ? "No runs yet. Send your first trace to POST /api/ingest — the snippet is on the API keys page."
              : `${runs.length} recent · ${failed.length} failed`}
          </CardDescription>
        </CardHeader>
        {runs.length > 0 && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Agent</th>
                    <th className="pb-2 pr-4 font-medium">Run</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 font-medium">Duration</th>
                    <th className="pb-2 pr-4 font-medium">Tokens</th>
                    <th className="pb-2 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{agentLabel(run)}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{run.external_run_id}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">{new Date(run.started_at).toLocaleString()}</td>
                      <td className="py-2 pr-4">{duration(run)}</td>
                      <td className="py-2 pr-4">
                        {run.input_tokens != null || run.output_tokens != null
                          ? `${run.input_tokens ?? 0} / ${run.output_tokens ?? 0}`
                          : "—"}
                      </td>
                      <td className="py-2">{cost(run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </main>
  );
}
