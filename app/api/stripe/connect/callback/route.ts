import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { getCurrentOrg } from "@/lib/org";
import { stripe, verifyDisputeReadAccess } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { STRIPE_OAUTH_STATE_COOKIE } from "@/lib/stripe-connect";

const callbackSchema = z.union([
  z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  }),
  z.object({
    error: z.string(),
    error_description: z.string().optional(),
    state: z.string().optional(),
  }),
]);

function redirectToDashboard(params: Record<string, string>) {
  const url = new URL("/dashboard", serverEnv().NEXT_PUBLIC_APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/**
 * Stripe Connect OAuth callback: verifies CSRF state, exchanges the code
 * for a connected account id, verifies dispute read access, and stores
 * the connection for the user's org.
 */
export async function GET(request: Request) {
  const ctx = await getCurrentOrg();
  if (!ctx) {
    return NextResponse.redirect(new URL("/login", serverEnv().NEXT_PUBLIC_APP_URL));
  }

  const url = new URL(request.url);
  const parsed = callbackSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return redirectToDashboard({ stripe_error: "invalid_callback" });
  }

  if ("error" in parsed.data) {
    // User denied access or Stripe returned an error.
    return redirectToDashboard({
      stripe_error: parsed.data.error_description ?? parsed.data.error,
    });
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STRIPE_OAUTH_STATE_COOKIE)?.value;
  if (!expectedState || expectedState !== parsed.data.state) {
    return redirectToDashboard({ stripe_error: "state_mismatch" });
  }

  try {
    const token = await stripe().oauth.token({
      grant_type: "authorization_code",
      code: parsed.data.code,
    });

    const stripeAccountId = token.stripe_user_id;
    if (!stripeAccountId) {
      return redirectToDashboard({ stripe_error: "no_account_id" });
    }

    // Verify we can actually read disputes before declaring success.
    await verifyDisputeReadAccess(stripeAccountId);

    const admin = createAdminClient();
    const { error } = await admin.from("connected_accounts").upsert(
      {
        org_id: ctx.orgId,
        stripe_account_id: stripeAccountId,
        livemode: token.livemode ?? false,
        scope: token.scope ?? "read_only",
        disputes_access_verified_at: new Date().toISOString(),
        connected_by: ctx.userId,
      },
      { onConflict: "stripe_account_id" }
    );
    if (error) {
      console.error("Failed to store connected account", error);
      return redirectToDashboard({ stripe_error: "storage_failed" });
    }

    const res = redirectToDashboard({ stripe_connected: "1" });
    res.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("Stripe Connect callback failed", err);
    const message =
      err instanceof Error && err.message ? err.message : "connection_failed";
    return redirectToDashboard({ stripe_error: message });
  }
}
