import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const callbackSchema = z.object({
  code: z.string().min(1),
  next: z
    .string()
    .startsWith("/")
    .refine((p) => !p.startsWith("//"), "invalid redirect")
    .default("/dashboard"),
});

/**
 * Supabase auth callback: exchanges the OAuth / email-confirmation code
 * for a session cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = callbackSchema.safeParse({
    code: url.searchParams.get("code") ?? undefined,
    next: url.searchParams.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/login?error=invalid_callback", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(parsed.data.code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
    );
  }

  return NextResponse.redirect(new URL(parsed.data.next, url.origin));
}
