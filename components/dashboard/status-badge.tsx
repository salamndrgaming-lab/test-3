import { cn } from "@/lib/utils";

/**
 * Run status chip: reserved status colors carried by a dot, label in ink —
 * never color alone. (good / critical / serious per the status palette;
 * running and canceled are neutral states.)
 */
const STATUS: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  completed: { dot: "bg-[#0ca30c]", label: "completed" },
  failed: { dot: "bg-[#d03b3b]", label: "failed" },
  timeout: { dot: "bg-[#ec835a]", label: "timeout" },
  running: { dot: "bg-[#2a78d6]", label: "running", pulse: true },
  canceled: { dot: "bg-muted-foreground", label: "canceled" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS[status] ?? { dot: "bg-muted-foreground", label: status };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs font-medium">
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot, config.pulse && "animate-pulse")} />
      {config.label}
    </span>
  );
}
