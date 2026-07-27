import { createClient } from "@/lib/supabase/server";

export interface CurrentOrgContext {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
}

/**
 * Resolves the signed-in user and their organization, or null when signed
 * out. The users row is created by the `handle_new_user` DB trigger at
 * signup, so it must exist for any authenticated user.
 */
export async function getCurrentOrg(): Promise<CurrentOrgContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row, error } = await supabase
    .from("users")
    .select("id, org_id, email, organizations(name)")
    .eq("id", user.id)
    .single();

  if (error || !row) return null;

  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

  return {
    userId: row.id,
    email: row.email,
    orgId: row.org_id,
    orgName: (org as { name: string } | null)?.name ?? "My organization",
  };
}
