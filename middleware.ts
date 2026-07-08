import { type NextRequest } from "next/server";

// Relative import (not the @/ alias): Vercel's Edge Function bundler must
// fully inline the middleware graph, and aliased specifiers have failed to
// resolve there ("referencing unsupported modules" deploy error).
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
