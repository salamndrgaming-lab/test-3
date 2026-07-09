import { NextResponse } from "next/server";

import { generateResponseForDispute } from "@/lib/ai/engine";
import { gatherEvidenceForDispute } from "@/lib/evidence/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Safety-net sweep (Vercel cron):
 * 1. re-runs evidence gathering for disputes stuck in 'new'
 * 2. re-runs the AI response engine for disputes in 'evidence_gathering'
 *    with no stored response (e.g. ANTHROPIC_API_KEY was missing, or the
 *    post-webhook task failed)
 * Authenticated with the CRON_SECRET Vercel sends as a Bearer token.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const db = createAdminClient();

  const { data: stuckNew, error: newError } = await db
    .from("disputes")
    .select("stripe_dispute_id")
    .eq("status", "new")
    .order("evidence_due_by", { ascending: true, nullsFirst: false })
    .limit(20);
  if (newError) {
    return NextResponse.json({ error: newError.message }, { status: 500 });
  }

  const gathered = [];
  for (const dispute of stuckNew ?? []) {
    const result = await gatherEvidenceForDispute(dispute.stripe_dispute_id);
    gathered.push(result);
    if (result.ok) {
      await generateResponseForDispute(dispute.stripe_dispute_id);
    }
  }

  // Disputes with evidence but no response row yet (deadline-first).
  const { data: undrafted, error: undraftedError } = await db
    .from("disputes")
    .select("stripe_dispute_id, id, responses(id)")
    .eq("status", "evidence_gathering")
    .order("evidence_due_by", { ascending: true, nullsFirst: false })
    .limit(20);
  if (undraftedError) {
    return NextResponse.json({ error: undraftedError.message }, { status: 500 });
  }

  const drafted = [];
  for (const dispute of undrafted ?? []) {
    const hasResponse = Array.isArray(dispute.responses)
      ? dispute.responses.length > 0
      : Boolean(dispute.responses);
    if (hasResponse) continue;
    drafted.push(await generateResponseForDispute(dispute.stripe_dispute_id));
  }

  return NextResponse.json({
    gathered: {
      swept: gathered.length,
      succeeded: gathered.filter((r) => r.ok).length,
      failed: gathered.filter((r) => !r.ok).map((r) => ({ id: r.stripeDisputeId, error: r.error })),
    },
    drafted: {
      swept: drafted.length,
      succeeded: drafted.filter((r) => r.ok).length,
      failed: drafted
        .filter((r) => !r.ok)
        .map((r) => ({ id: r.stripeDisputeId, error: r.skipped ?? r.error })),
    },
  });
}
