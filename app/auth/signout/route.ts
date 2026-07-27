import { NextResponse } from "next/server";

import { GUEST_COOKIE } from "@/lib/guest";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Supabase not configured (guest mode) — nothing to sign out of there.
  }
  const res = NextResponse.redirect(new URL("/login", new URL(request.url).origin), {
    status: 302,
  });
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
