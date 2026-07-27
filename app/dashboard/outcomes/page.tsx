import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { formatAmount } from "@/lib/format";
import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface OutcomeRow {
  result: "won" | "lost";
  amount_recovered: number;
  fee_amount: number;
  closed_at: string;
  disputes: { reason: string; currency: string } | { reason: string; currency: string }[] | null;
}

export default async function OutcomesPage() {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);
  if (isGuest) {
    return (
      <main>
        <Alert>
          <AlertTitle>Guest mode</AlertTitle>
          <AlertDescription>
            Outcomes populate once Supabase and Stripe are configured and disputes close.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("outcomes")
    .select("result, amount_recovered, fee_amount, closed_at, disputes(reason, currency)")
    .order("closed_at", { ascending: false });
  const outcomes = (data ?? []) as OutcomeRow[];

  const won = outcomes.filter((o) => o.result === "won");
  const totalRecovered = won.reduce((sum, o) => sum + o.amount_recovered, 0);
  const totalFees = won.reduce((sum, o) => sum + o.fee_amount, 0);
  const currency =
    (Array.isArray(outcomes[0]?.disputes)
      ? outcomes[0]?.disputes[0]?.currency
      : outcomes[0]?.disputes?.currency) ?? "usd";

  const byReason = new Map<string, { won: number; lost: number; recovered: number }>();
  for (const outcome of outcomes) {
    const dispute = Array.isArray(outcome.disputes) ? outcome.disputes[0] : outcome.disputes;
    const reason = dispute?.reason ?? "unknown";
    const bucket = byReason.get(reason) ?? { won: 0, lost: 0, recovered: 0 };
    if (outcome.result === "won") {
      bucket.won += 1;
      bucket.recovered += outcome.amount_recovered;
    } else {
      bucket.lost += 1;
    }
    byReason.set(reason, bucket);
  }

  return (
    <main className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Win rate</CardDescription>
            <CardTitle className="text-3xl">
              {outcomes.length > 0 ? `${Math.round((won.length / outcomes.length) * 100)}%` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {won.length} won of {outcomes.length} closed
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Recovered</CardDescription>
            <CardTitle className="text-3xl">{formatAmount(totalRecovered, currency)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            revenue returned to you
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Our fee</CardDescription>
            <CardTitle className="text-3xl">{formatAmount(totalFees, currency)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            success-based — only on wins (calculation only, not yet collected)
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Win rate by reason code</CardTitle>
          <CardDescription>
            {outcomes.length === 0
              ? "No closed disputes yet — outcomes appear when Stripe reports won/lost."
              : "Where the evidence engine is strongest."}
          </CardDescription>
        </CardHeader>
        {byReason.size > 0 && (
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Reason</th>
                  <th className="pb-2 pr-4 font-medium">Won</th>
                  <th className="pb-2 pr-4 font-medium">Lost</th>
                  <th className="pb-2 pr-4 font-medium">Win rate</th>
                  <th className="pb-2 font-medium">Recovered</th>
                </tr>
              </thead>
              <tbody>
                {[...byReason.entries()].map(([reason, stats]) => (
                  <tr key={reason} className="border-b last:border-0">
                    <td className="py-2 pr-4">{reason}</td>
                    <td className="py-2 pr-4">{stats.won}</td>
                    <td className="py-2 pr-4">{stats.lost}</td>
                    <td className="py-2 pr-4">
                      {Math.round((stats.won / (stats.won + stats.lost)) * 100)}%
                    </td>
                    <td className="py-2">{formatAmount(stats.recovered, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>
    </main>
  );
}
