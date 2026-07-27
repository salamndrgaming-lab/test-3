import { Suspense } from "react";

import { isGuestModeAvailable } from "@/lib/guest";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Suspense>
        <LoginForm guestAvailable={isGuestModeAvailable()} />
      </Suspense>
    </main>
  );
}
