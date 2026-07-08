/**
 * Temporary guest mode: lets the app be explored before Supabase keys are
 * configured. Guest access is only honored while Supabase env is absent
 * (or when explicitly forced via NEXT_PUBLIC_ENABLE_GUEST_MODE=true), so
 * adding real keys automatically retires the bypass.
 */
export const GUEST_COOKIE = "re_guest_session";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function isGuestModeAvailable(): boolean {
  return !isSupabaseConfigured() || process.env.NEXT_PUBLIC_ENABLE_GUEST_MODE === "true";
}
