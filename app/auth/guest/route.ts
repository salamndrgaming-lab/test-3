import { NextResponse } from "next/server";

import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";

/** Starts a guest session. Refused once Supabase is configured. */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;

  if (!isGuestModeAvailable()) {
    return NextResponse.redirect(new URL("/login?error=guest_disabled", origin), {
      status: 302,
    });
  }

  const res = NextResponse.redirect(new URL("/dashboard", origin), { status: 302 });
  res.cookies.set(GUEST_COOKIE, "1", {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}
