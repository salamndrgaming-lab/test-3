import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every request and gates
 * authenticated routes. Public routes: landing page, auth pages, and
 * API endpoints that do their own verification (Stripe webhooks).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  let env: ReturnType<typeof publicEnv>;
  try {
    env = publicEnv();
  } catch {
    // Supabase env not configured yet (fresh deploy): treat everyone as
    // signed out so public pages still render instead of 500ing.
    return gate(request, null, supabaseResponse);
  }
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser() —
  // it can cause random logouts (see Supabase SSR docs).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return gate(request, user, supabaseResponse);
}

function gate(
  request: NextRequest,
  user: { id: string } | null,
  supabaseResponse: NextResponse
) {
  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/webhooks");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
