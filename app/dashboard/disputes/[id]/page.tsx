import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { EvidenceBundle } from "@/lib/evidence/bundle";
import { formatAmount, formatDeadline } from "@/lib/format";
import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import type { SubmissionEntry } from "@/lib/submission";
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
import { saveDraft, submitToStripe } from "./actions";

export const dynamic = "force-dynamic";

interface QAReview {
  qa: {
    verdict: "pass" | "fail";
    score: number;
    critiques: { severity: string; issue: string; recommendation: string }[];
    missingEvidence: string[];
    unsupportedClaims: string[];
  } | null;
  validation: { ok: boolean; violations: { detail: string }[] } | null;
}

export default async function DisputeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; submitted?: string }>;
}) {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);
  if (isGuest) redirect("/dashboard");

  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const { id } = await params;
  const flags = await searchParams;

  const supabase = await createClient();
  const { data: dispute } = await supabase
    .from("disputes")
    .select(
      "id, stripe_dispute_id, stripe_charge_id, amount, currency, reason, status, stripe_status, evidence_due_by, created_at, responses(id, narrative, evidence_mapping, qa_review, qa_passed, confidence, needs_human_review, submitted_at), evidence_items(kind, payload)"
    )
    .eq("id", id)
    .single();

  if (!dispute) redirect("/dashboard");

  const response = Array.isArray(dispute.responses)
    ? (dispute.responses[0] ?? null)
    : dispute.responses;
  const bundleItem = (dispute.evidence_items as { kind: string; payload: unknown }[]).find(
    (item) => item.kind === "bundle"
  );
  const bundle = (bundleItem?.payload ?? null) as EvidenceBundle | null;
  const qaReview = (response?.qa_review ?? null) as QAReview | null;
  const submission = ((response?.evidence_mapping as { submission?: SubmissionEntry[] } | null)
    ?.submission ?? []) as SubmissionEntry[];
  const deadline = formatDeadline(dispute.evidence_due_by);
  const isClosed = ["submitted", "won", "lost"].includes(dispute.status);

  return (
    <main className="space-y-6">
      {flags.error && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{flags.error}</AlertDescription>
        </Alert>
      )}
      {flags.saved && (
        <Alert variant="success">
          <AlertDescription>Draft saved and marked as human-reviewed.</AlertDescription>
        </Alert>
      )}
      {flags.submitted && (
        <Alert variant="success">
          <AlertTitle>Submitted to Stripe</AlertTitle>
          <AlertDescription>
            The evidence was submitted to the card network. The outcome arrives via webhook.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {formatAmount(dispute.amount, dispute.currency)} · {dispute.reason}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{dispute.status}</Badge>
              {deadline && (
                <Badge variant={deadline.tone === "normal" ? "outline" : "destructive"}>
                  {deadline.label}
                </Badge>
              )}
            </div>
          </div>
          <CardDescription className="font-mono text-xs">
            {dispute.stripe_dispute_id} · charge {dispute.stripe_charge_id} · Stripe status:{" "}
            {dispute.stripe_status}
          </CardDescription>
        </CardHeader>
      </Card>

      {qaReview?.qa && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Adversarial QA review</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={qaReview.qa.verdict === "pass" ? "success" : "destructive"}>
                  {qaReview.qa.verdict === "pass" ? "QA passed" : "QA failed"}
                </Badge>
                <Badge variant="outline">
                  win likelihood {Math.round(qaReview.qa.score * 100)}%
                </Badge>
              </div>
            </div>
            <CardDescription>
              Critiqued as the issuing bank&apos;s reviewer before you submit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {qaReview.validation && !qaReview.validation.ok && (
              <Alert variant="destructive">
                <AlertTitle>Validator caught unsupported content</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {qaReview.validation.violations.map((v, i) => (
                      <li key={i}>{v.detail}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {qaReview.qa.unsupportedClaims.length > 0 && (
              <div>
                <p className="font-medium text-destructive">Unsupported claims</p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {qaReview.qa.unsupportedClaims.map((claim, i) => (
                    <li key={i}>{claim}</li>
                  ))}
                </ul>
              </div>
            )}
            {qaReview.qa.critiques.length > 0 && (
              <div>
                <p className="font-medium">Critiques</p>
                <ul className="space-y-1">
                  {qaReview.qa.critiques.map((c, i) => (
                    <li key={i}>
                      <Badge
                        variant={c.severity === "blocking" ? "destructive" : "secondary"}
                        className="mr-2"
                      >
                        {c.severity}
                      </Badge>
                      {c.issue} — <span className="text-muted-foreground">{c.recommendation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {qaReview.qa.missingEvidence.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Missing evidence: </span>
                {qaReview.qa.missingEvidence.join("; ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {response ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>AI draft response</CardTitle>
              {response.confidence != null && (
                <Badge variant="outline">
                  confidence {Math.round(Number(response.confidence) * 100)}%
                </Badge>
              )}
            </div>
            <CardDescription>
              Edit inline, save, then submit. Saving marks the draft human-reviewed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={saveDraft} className="space-y-4">
              <input type="hidden" name="disputeId" value={dispute.id} />
              <div>
                <p className="mb-1 text-sm font-medium">Narrative</p>
                <textarea
                  name="narrative"
                  defaultValue={response.narrative ?? ""}
                  rows={12}
                  disabled={isClosed}
                  className="w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                />
              </div>
              {submission.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Evidence fields to submit</p>
                  {submission.map((entry, index) => (
                    <div key={entry.field} className="grid gap-1 sm:grid-cols-[240px_1fr]">
                      <span className="pt-1.5 font-mono text-xs text-muted-foreground">
                        {entry.field}
                      </span>
                      <Input name={`ev_${index}`} defaultValue={entry.value} disabled={isClosed} />
                    </div>
                  ))}
                </div>
              )}
              {!isClosed && (
                <Button type="submit" variant="outline">
                  Save edits
                </Button>
              )}
            </form>

            {!isClosed && (
              <form action={submitToStripe}>
                <input type="hidden" name="disputeId" value={dispute.id} />
                <Button type="submit" className="w-full">
                  Submit to Stripe
                </Button>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Writes the evidence to Stripe&apos;s dispute API and finalizes the response —
                  this cannot be undone.
                </p>
              </form>
            )}
            {response.submitted_at && (
              <p className="text-sm text-muted-foreground">
                Submitted {new Date(response.submitted_at).toLocaleString()}.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No draft yet</CardTitle>
            <CardDescription>
              {dispute.status === "new"
                ? "Evidence gathering is in progress. The draft appears once the AI passes complete."
                : "The response engine has not produced a draft — check that ANTHROPIC_API_KEY is configured; the daily sweep retries automatically."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {bundle && (
        <Card>
          <CardHeader>
            <CardTitle>Evidence bundle</CardTitle>
            <CardDescription>
              Normalized from the connected Stripe account · Visa {bundle.reasonCode.visa} /
              Mastercard {bundle.reasonCode.mastercard}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Customer: </span>
                {bundle.customer?.name ?? bundle.charge.billing.name ?? "—"} (
                {bundle.customer?.email ?? bundle.charge.billing.email ?? "no email"})
              </p>
              <p>
                <span className="text-muted-foreground">Card: </span>
                {bundle.charge.card
                  ? `${bundle.charge.card.brand} •••• ${bundle.charge.card.last4} · AVS ${bundle.charge.card.checks.addressPostalCode ?? "n/a"} · CVC ${bundle.charge.card.checks.cvc ?? "n/a"}`
                  : "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Shipping: </span>
                {bundle.shipping?.trackingNumber
                  ? `${bundle.shipping.carrier ?? "carrier n/a"} ${bundle.shipping.trackingNumber}`
                  : "none"}
              </p>
              <p>
                <span className="text-muted-foreground">Prior charges: </span>
                {bundle.priorChargeHistory
                  ? `${bundle.priorChargeHistory.succeededCharges} succeeded · ${bundle.priorChargeHistory.disputedCharges} disputed · ${bundle.priorChargeHistory.undisputedChargesOlderThan120Days} in CE3.0 window`
                  : "no customer history"}
              </p>
            </div>
            {bundle.gaps.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Evidence gaps: </span>
                {bundle.gaps.map((gap) => `${gap.field} (${gap.weight})`).join(", ")}
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-muted-foreground">Raw bundle JSON</summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(bundle, null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
