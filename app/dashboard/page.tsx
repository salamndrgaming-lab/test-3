import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { formatAmount, formatDeadline } from "@/lib/format";
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

interface ResponseSummary {
  confidence: number | null;
  qa_passed: boolean | null;
  needs_human_review: boolean;
  submitted_at: string | null;
}

interface DisputeRow {
  id: string;
  stripe_dispute_id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  evidence_due_by: string | null;
  created_at: string;
  responses: ResponseSummary[] | ResponseSummary | null;
}

interface ConnectedAccountRow {
  id: string;
  stripe_account_id: string;
  livemode: boolean;
  disputes_access_verified_at: string | null;
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

function deadlineClass(tone: string): string {
  switch (tone) {
    case "overdue":
    case "urgent":
      return "font-medium text-red-600 dark:text-red-400";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function responseOf(d: DisputeRow): ResponseSummary | null {
  return Array.isArray(d.responses) ? (d.responses[0] ?? null) : d.responses;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe_connected?: string; stripe_error?: string }>;
}) {
  const params = await searchParams;
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);

  let connectedAccounts: ConnectedAccountRow[] = [];
  let disputes: DisputeRow[] = [];

  if (!isGuest) {
    const ctx = await getCurrentOrg();
    if (!ctx) redirect("/login");

    const supabase = await createClient();
    const [{ data: accounts }, { data: disputeRows }] = await Promise.all([
      supabase
        .from("connected_accounts")
        .select("id, stripe_account_id, livemode, disputes_access_verified_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("disputes")
        .select(
          "id, stripe_dispute_id, amount, currency, reason, status, evidence_due_by, created_at, responses(confidence, qa_passed, needs_human_review, submitted_at)"
        )
        .order("evidence_due_by", { ascending: true, nullsFirst: false })
        .limit(100),
    ]);
    connectedAccounts = (accounts ?? []) as ConnectedAccountRow[];
    disputes = (disputeRows ?? []) as DisputeRow[];
  }

  const isConnected = connectedAccounts.length > 0;
  const open = disputes.filter((d) => !["won", "lost"].includes(d.status));
  const needsReview = open.filter((d) => responseOf(d)?.needs_human_review);

  return (
    <main className="space-y-6">
      {isGuest && (
        <Alert>
          <AlertTitle>Guest mode</AlertTitle>
          <AlertDescription>
            You&apos;re previewing without a database. The queue fills with real
            disputes once Supabase and Stripe are configured.
          </AlertDescription>
        </Alert>
      )}
      {params.stripe_connected && (
        <Alert variant="success">
          <AlertTitle>Stripe connected</AlertTitle>
          <AlertDescription>
            Dispute access verified. New chargebacks will appear here automatically.
          </AlertDescription>
        </Alert>
      )}
      {params.stripe_error && (
        <Alert variant="destructive">
          <AlertTitle>Stripe connection failed</AlertTitle>
          <AlertDescription>{params.stripe_error}</AlertDescription>
        </Alert>
      )}

      {!isGuest && !isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Connect Stripe</CardTitle>
            <CardDescription>
              Connect your Stripe account so we can watch for chargebacks, pull
              evidence, and submit responses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/api/stripe/connect">Connect Stripe</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {needsReview.length > 0 && (
        <Alert>
          <AlertTitle>
            {needsReview.length} dispute{needsReview.length === 1 ? "" : "s"} need
            {needsReview.length === 1 ? "s" : ""} human review
          </AlertTitle>
          <AlertDescription>
            The adversarial QA pass flagged weaknesses — review and submit manually.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dispute queue</CardTitle>
          <CardDescription>
            {disputes.length === 0
              ? isConnected
                ? "No disputes yet. When a chargeback hits, it appears here within seconds."
                : "Connect Stripe to start receiving disputes."
              : `${open.length} open · ${disputes.length - open.length} closed`}
          </CardDescription>
        </CardHeader>
        {disputes.length > 0 && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Deadline</th>
                    <th className="pb-2 pr-4 font-medium">Amount</th>
                    <th className="pb-2 pr-4 font-medium">Reason</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">AI confidence</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.map((d) => {
                    const deadline = formatDeadline(d.evidence_due_by);
                    const response = responseOf(d);
                    return (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          {deadline ? (
                            <span className={deadlineClass(deadline.tone)}>{deadline.label}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{formatAmount(d.amount, d.currency)}</td>
                        <td className="py-2 pr-4">{d.reason}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                        </td>
                        <td className="py-2 pr-4">
                          {response?.confidence != null ? (
                            <span className="flex items-center gap-2">
                              {Math.round(Number(response.confidence) * 100)}%
                              {response.needs_human_review && (
                                <Badge variant="destructive">review</Badge>
                              )}
                              {response.qa_passed && <Badge variant="success">QA ✓</Badge>}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/dashboard/disputes/${d.id}`}>Open</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      {!isGuest && isConnected && (
        <p className="text-xs text-muted-foreground">
          Connected: {connectedAccounts.map((a) => a.stripe_account_id).join(", ")} ·{" "}
          <Link className="underline" href="/api/stripe/connect">
            connect another account
          </Link>
        </p>
      )}
    </main>
  );
}
