import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">AgentLens</h1>
        <p className="mx-auto max-w-md text-lg text-muted-foreground">
          Observability for production AI agents. Stream every run and tool call
          in, and when an agent fails, get an AI-generated diagnosis of why —
          with the fix.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
