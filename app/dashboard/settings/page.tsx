import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { REASON_CODE_CONFIG } from "@/lib/evidence/reason-codes";
import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateAutoSubmit } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);
  if (isGuest) {
    return (
      <main>
        <Alert>
          <AlertTitle>Guest mode</AlertTitle>
          <AlertDescription>
            Settings are stored per organization and activate once Supabase is configured.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const flags = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("fee_rate, auto_submit_reasons")
    .eq("id", ctx.orgId)
    .single();

  const feeRate = Number(org?.fee_rate ?? 0.15);
  const autoReasons = new Set<string>(org?.auto_submit_reasons ?? []);

  return (
    <main className="space-y-6">
      {flags.saved && (
        <Alert variant="success">
          <AlertDescription>Settings saved.</AlertDescription>
        </Alert>
      )}
      {flags.error && (
        <Alert variant="destructive">
          <AlertDescription>{flags.error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>Success-based — you only pay when a dispute is won.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            <span className="text-3xl font-bold">{(feeRate * 100).toFixed(0)}%</span>{" "}
            <span className="text-muted-foreground">of recovered revenue</span>
          </p>
          <p className="mt-2 text-muted-foreground">
            Fees are currently calculated on won disputes but not collected.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-submit</CardTitle>
          <CardDescription>
            For checked reason codes, responses that pass both the no-fabrication validator and
            the adversarial QA review are submitted to Stripe automatically. Everything else
            waits for your review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAutoSubmit} className="space-y-3">
            {Object.values(REASON_CODE_CONFIG).map((config) => (
              <label
                key={config.stripeReason}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
              >
                <input
                  type="checkbox"
                  name="auto_submit"
                  value={config.stripeReason}
                  defaultChecked={autoReasons.has(config.stripeReason)}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-medium">{config.stripeReason}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    (Visa {config.network.visa.code} / MC {config.network.mastercard.code})
                  </span>
                  <span className="block text-sm text-muted-foreground">{config.summary}</span>
                </span>
              </label>
            ))}
            <Button type="submit">Save settings</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
