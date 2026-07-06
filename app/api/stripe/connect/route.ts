import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { serverEnv } from "@/lib/env";
import { getCurrentOrg } from "@/lib/org";
import { STRIPE_OAUTH_STATE_COOKIE } from "@/lib/stripe-connect";

/**
 * Starts the Stripe Connect (standard, OAuth) onboarding flow.
 * A random nonce is stored in an httpOnly cookie and sent as `state`
 * to prevent CSRF on the callback.
 */
export async function GET() {
  const ctx = await getCurrentOrg();
  if (!ctx) {
    return NextResponse.redirect(new URL("/login", serverEnv().NEXT_PUBLIC_APP_URL));
  }

  const env = serverEnv();
  const state = randomBytes(24).toString("hex");

  const authorize = new URL("https://connect.stripe.com/oauth/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.STRIPE_CONNECT_CLIENT_ID);
  authorize.searchParams.set("scope", "read_only");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set(
    "redirect_uri",
    `${env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/callback`
  );

  const res = NextResponse.redirect(authorize);
  res.cookies.set(STRIPE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.NEXT_PUBLIC_APP_URL.startsWith("https"),
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/api/stripe/connect",
  });
  return res;
}
