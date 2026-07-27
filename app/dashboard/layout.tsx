import { cookies } from "next/headers";

import { GUEST_COOKIE, isGuestModeAvailable } from "@/lib/guest";
import { getCurrentOrg } from "@/lib/org";
import { DashboardNav } from "@/components/dashboard/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isGuest = isGuestModeAvailable() && (await cookies()).has(GUEST_COOKIE);
  const ctx = isGuest ? null : await getCurrentOrg();

  const orgName = isGuest ? "Guest workspace" : (ctx?.orgName ?? "");
  const email = isGuest ? "guest session" : (ctx?.email ?? "");

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2a78d6] text-xs font-bold text-white">
                A
              </span>
              <span className="text-sm font-semibold tracking-tight">AgentLens</span>
            </div>
            <DashboardNav />
          </div>
          <div className="flex items-center gap-3">
            {isGuest && <Badge variant="secondary">guest</Badge>}
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight">{orgName}</p>
              <p className="text-xs leading-tight text-muted-foreground">{email}</p>
            </div>
            <form action="/auth/signout" method="post">
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
