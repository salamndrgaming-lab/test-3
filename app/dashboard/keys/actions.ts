"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { generateApiKey, NEW_KEY_COOKIE } from "@/lib/apikeys";
import { getCurrentOrg } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";

export async function createApiKey(formData: FormData) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const name = z
    .string()
    .min(1)
    .max(100)
    .safeParse((formData.get("name") ?? "").toString().trim() || "default");
  if (!name.success) redirect("/dashboard/keys?error=invalid_name");

  const key = generateApiKey();
  const db = createAdminClient();
  const { error } = await db.from("api_keys").insert({
    org_id: ctx.orgId,
    name: name.data,
    key_prefix: key.keyPrefix,
    key_hash: key.keyHash,
    created_by: ctx.userId,
  });
  if (error) {
    redirect(`/dashboard/keys?error=${encodeURIComponent(error.message)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(NEW_KEY_COOKIE, key.plaintext, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60,
    path: "/dashboard/keys",
  });

  revalidatePath("/dashboard/keys");
  redirect("/dashboard/keys");
}

export async function revokeApiKey(formData: FormData) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const keyId = z.string().uuid().safeParse(formData.get("keyId"));
  if (!keyId.success) redirect("/dashboard/keys");

  const db = createAdminClient();
  const { error } = await db
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId.data)
    .eq("org_id", ctx.orgId)
    .is("revoked_at", null);
  if (error) {
    redirect(`/dashboard/keys?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/keys");
  redirect("/dashboard/keys?revoked=1");
}
