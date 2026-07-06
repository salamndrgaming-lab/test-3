import Link from "next/link";
import { redirect } from "next/navigation";

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

interface DisputeRow {
  id: string;
  stripe_dispute_id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  stripe_status: string;
  evidence_due_by: string | null;
  created_at: string;
}

interface ConnectedAccountRow {
  id: string;
  stripe_account_id: string;
  livemode: boolean;
  disputes_access_verified_at: string | null;
  created_at: string;
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "success" {
  switch (status) {
    case "won":
      return "success";
    case "lost":
      return "destructive";
    case "new":
      return "default";
    default:
      return "secondary";
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe_connected?: string; stripe_error?: string }>;
}) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: accounts }, { data: disputes }] = await Promise.all([
    supabase
      .from("connected_accounts")
      .select("id, stripe_account_id, livemode, disputes_access_verified_at, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("disputes")
      .select(
        "id, stripe_dispute_id, amount, currency, reason, status, stripe_status, evidence_due_by, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const connectedAccounts = (accounts ?? []) as ConnectedAccountRow[];
  const disputeRows = (disputes ?? []) as DisputeRow[];
  const isConnected = connectedAccounts.length > 0;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RecoveryEngine</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.orgName} · {ctx.email}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <Button variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      {params.stripe_connected && (
        <Alert variant="success">
          <AlertTitle>Stripe connected</AlertTitle>
          <AlertDescription>
            Dispute read access verified. New chargebacks will appear here
            automatically.
          </AlertDescription>
        </Alert>
      )}
      {params.stripe_error && (
        <Alert variant="destructive">
          <AlertTitle>Stripe connection failed</AlertTitle>
          <AlertDescription>{params.stripe_error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stripe account</CardTitle>
          <CardDescription>
            Connect your Stripe account so we can watch for chargebacks and pull
            evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <div className="space-y-3">
              {connectedAccounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-mono text-sm">{account.stripe_account_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.disputes_access_verified_at
                        ? `Dispute access verified ${new Date(account.disputes_access_verified_at).toLocaleString()}`
                        : "Dispute access not verified"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={account.livemode ? "default" : "secondary"}>
                      {account.livemode ? "live" : "test"}
                    </Badge>
                    {account.disputes_access_verified_at && (
                      <Badge variant="success">verified</Badge>
                    )}
                  </div>
                </div>
              ))}
              <Button asChild variant="outline" size="sm">
                <Link href="/api/stripe/connect">Connect another account</Link>
              </Button>
            </div>
          ) : (
            <Button asChild>
              <Link href="/api/stripe/connect">Connect Stripe</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disputes</CardTitle>
          <CardDescription>
            {disputeRows.length === 0
              ? isConnected
                ? "No disputes yet. When a chargeback hits your Stripe account, it will appear here within seconds."
                : "Connect Stripe to start receiving disputes."
              : `${disputeRows.length} dispute${disputeRows.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        {disputeRows.length > 0 && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Dispute</th>
                    <th className="pb-2 pr-4 font-medium">Amount</th>
                    <th className="pb-2 pr-4 font-medium">Reason</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Evidence due</th>
                  </tr>
                </thead>
                <tbody>
                  {disputeRows.map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{d.stripe_dispute_id}</td>
                      <td className="py-2 pr-4">{formatAmount(d.amount, d.currency)}</td>
                      <td className="py-2 pr-4">{d.reason}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                      </td>
                      <td className="py-2">
                        {d.evidence_due_by
                          ? new Date(d.evidence_due_by).toLocaleDateString()
                          : "—"}
                      </td>
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
