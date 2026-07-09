import { NextResponse } from "next/server";

import { gatherEvidenceForDispute } from "@/lib/evidence/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safety-net sweep (Vercel cron): re-runs evidence gathering for any
 * dispute stuck in 'new' — e.g. the post-webhook task failed, or an
 * updated/closed event arrived for a dispute we never saw created.
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
  const { data: stuck, error } = await db
    .from("disputes")
    .select("stripe_dispute_id")
    .eq("status", "new")
    .order("evidence_due_by", { ascending: true, nullsFirst: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const dispute of stuck ?? []) {
    results.push(await gatherEvidenceForDispute(dispute.stripe_dispute_id));
  }

  return NextResponse.json({
    swept: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => ({ id: r.stripeDisputeId, error: r.error })),
  });
}
