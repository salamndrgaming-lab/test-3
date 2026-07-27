"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentOrg } from "@/lib/org";
import { submitDisputeEvidence, type SubmissionEntry } from "@/lib/submission";
import { createAdminClient } from "@/lib/supabase/admin";

const saveSchema = z.object({
  disputeId: z.string().uuid(),
  narrative: z.string().min(1).max(20000),
});

/**
 * Saves human edits to the draft: the narrative and any edited evidence
 * values (fields named ev_<index> in the form). Editing implies human
 * review, so the response is marked reviewed.
 */
export async function saveDraft(formData: FormData) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const parsed = saveSchema.safeParse({
    disputeId: formData.get("disputeId"),
    narrative: formData.get("narrative"),
  });
  if (!parsed.success) {
    redirect(`/dashboard?error=${encodeURIComponent("invalid draft input")}`);
  }
  const { disputeId, narrative } = parsed.data;

  const db = createAdminClient();
  const { data: response, error } = await db
    .from("responses")
    .select("id, evidence_mapping, disputes!inner(org_id)")
    .eq("dispute_id", disputeId)
    .single();
  if (error || !response) {
    redirect(`/dashboard/disputes/${disputeId}?error=response_not_found`);
  }
  const dispute = Array.isArray(response.disputes) ? response.disputes[0] : response.disputes;
  if ((dispute as { org_id: string }).org_id !== ctx.orgId) {
    redirect("/dashboard");
  }

  const mapping = (response.evidence_mapping ?? {}) as {
    submission?: SubmissionEntry[];
    gapHandling?: unknown;
  };
  const submission = (mapping.submission ?? []).map((entry, index) => {
    const edited = formData.get(`ev_${index}`);
    return typeof edited === "string" ? { ...entry, value: edited } : entry;
  });

  const { error: updateError } = await db
    .from("responses")
    .update({
      narrative,
      evidence_mapping: { ...mapping, submission },
      needs_human_review: false,
    })
    .eq("id", response.id);
  if (updateError) {
    redirect(`/dashboard/disputes/${disputeId}?error=${encodeURIComponent(updateError.message)}`);
  }

  revalidatePath(`/dashboard/disputes/${disputeId}`);
  redirect(`/dashboard/disputes/${disputeId}?saved=1`);
}

export async function submitToStripe(formData: FormData) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const disputeId = z.string().uuid().safeParse(formData.get("disputeId"));
  if (!disputeId.success) redirect("/dashboard");

  const result = await submitDisputeEvidence({
    disputeId: disputeId.data,
    orgId: ctx.orgId,
    submittedBy: ctx.userId,
  });

  revalidatePath(`/dashboard/disputes/${disputeId.data}`);
  if (!result.ok) {
    redirect(
      `/dashboard/disputes/${disputeId.data}?error=${encodeURIComponent(result.error ?? "submit failed")}`
    );
  }
  redirect(`/dashboard/disputes/${disputeId.data}?submitted=1`);
}
