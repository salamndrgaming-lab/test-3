import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { bucketRunsByDay } from "@/components/dashboard/chart-data";
import { RunsChart } from "@/components/dashboard/runs-chart";
import { compactNumber, StatTile } from "@/components/dashboard/stat-tile";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  agents:
    | { name: string | null; external_id: string }
    | { name: string | null; external_id: string }[]
    | null;
}

function duration(run: RunRow): string {
  if (!run.ended_at) return "—";
  const ms = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
  if (ms < 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function agentInfo(run: RunRow): { label: string; initial: string } {
  const agent = Array.isArray(run.agents) ? run.agents[0] : run.agents;
  const label = agent?.name ?? agent?.external_id ?? "unknown";
  return { label, initial: label.charAt(0).toUpperCase() };
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
        .limit(500),
      supabase
        .from("api_keys")
        .select("id", { count: "exact", head: true })
        .is("revoked_at", null),
    ]);
    runs = (runRows ?? []) as RunRow[];
    hasKeys = (count ?? 0) > 0;
  }

  const terminal = runs.filter((r) => r.status !== "running");
  const failed = runs.filter((r) => r.status === "failed" || r.status === "timeout");
  const successRate =
    terminal.length > 0
      ? Math.round(
          (terminal.filter((r) => r.status === "completed").length / terminal.length) * 100
        )
      : null;
  const totalCostMicro = runs.reduce((sum, r) => sum + (r.cost_micro_usd ?? 0), 0);
  const totalTokens = runs.reduce(
    (sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0
  );
  const buckets = bucketRunsByDay(runs.map((r) => r.started_at));
  const recent = runs.slice(0, 25);

  return (
    <main className="space-y-6">
      {isGuest && (
        <Alert>
          <AlertTitle>Guest preview</AlertTitle>
          <AlertDescription>
            You&apos;re browsing without a database. Metrics and runs populate once
            Supabase is configured and your agents send traces.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Runs across all agents, most recent first.
          </p>
        </div>
        {!isGuest && !hasKeys && (
          <Button asChild size="sm">
            <Link href="/dashboard/keys">Create an API key</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Runs (14 days)"
          value={compactNumber(runs.length)}
          hint={runs.length > 0 ? `${terminal.length.toLocaleString()} finished` : "no data yet"}
        />
        <StatTile
          label="Success rate"
          value={successRate != null ? `${successRate}%` : "—"}
          hint={successRate != null ? "of finished runs" : "no finished runs yet"}
        />
        <StatTile
          label="Failures"
          value={compactNumber(failed.length)}
          hint={failed.length > 0 ? "failed or timed out" : "none recorded"}
        />
        <StatTile
          label="Spend"
          value={totalCostMicro > 0 ? `$${(totalCostMicro / 1_000_000).toFixed(2)}` : "—"}
          hint={
            totalTokens > 0 ? `${compactNumber(totalTokens)} tokens` : "reported by your agents"
          }
        />
      </div>

      {runs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Runs per day</CardTitle>
            <CardDescription>Last 14 days, all agents</CardDescription>
          </CardHeader>
          <CardContent>
            <RunsChart buckets={buckets} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription>
            {runs.length === 0
              ? "Nothing here yet"
              : `Showing ${recent.length} of ${runs.length.toLocaleString()} in the last window`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg">
                ⚡
              </span>
              <div>
                <p className="font-medium">Send your first run</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Create an API key, then POST a run from your agent framework — it
                  lands here in real time.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/keys">Get the snippet</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Agent</th>
                    <th className="pb-2 pr-4 font-medium">Run</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 text-right font-medium">Duration</th>
                    <th className="pb-2 pr-4 text-right font-medium">Tokens</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((run) => {
                    const agent = agentInfo(run);
                    return (
                      <tr
                        key={run.id}
                        className="border-b transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                              {agent.initial}
                            </span>
                            <span className="font-medium">{agent.label}</span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                          {run.external_run_id}
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {relativeTime(run.started_at)}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{duration(run)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">
                          {run.input_tokens != null || run.output_tokens != null
                            ? compactNumber((run.input_tokens ?? 0) + (run.output_tokens ?? 0))
                            : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {run.cost_micro_usd != null
                            ? `$${(run.cost_micro_usd / 1_000_000).toFixed(4)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
