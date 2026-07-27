import Link from "next/link";
import { cookies } from "next/headers";

import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);
  const ctx = isGuest ? null : await getCurrentOrg();

  const orgName = isGuest ? "Guest workspace" : (ctx?.orgName ?? "");
  const email = isGuest ? "guest (temporary)" : (ctx?.email ?? "");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AgentLens</h1>
          <p className="text-sm text-muted-foreground">
            {orgName} · {email}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Runs</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/keys">API keys</Link>
          </Button>
          <form action="/auth/signout" method="post">
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
