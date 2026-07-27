"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { REASON_CODE_CONFIG } from "@/lib/evidence/reason-codes";
import { getCurrentOrg } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";

/** Persists the per-reason-code auto-submit toggles for the caller's org. */
export async function updateAutoSubmit(formData: FormData) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const validReasons = new Set(Object.keys(REASON_CODE_CONFIG));
  const selected = formData
    .getAll("auto_submit")
    .filter((value): value is string => typeof value === "string" && validReasons.has(value));

  const db = createAdminClient();
  const { error } = await db
    .from("organizations")
    .update({ auto_submit_reasons: selected })
    .eq("id", ctx.orgId);

  revalidatePath("/dashboard/settings");
  if (error) {
    redirect(`/dashboard/settings?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/dashboard/settings?saved=1");
}
