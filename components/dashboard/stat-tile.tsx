import { cn } from "@/lib/utils";

/**
 * Stat tile per the dataviz contract: sentence-case label, semibold
 * auto-compact value, optional signed delta colored by direction × goodness.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: { text: string; good: boolean } | null;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {(delta || hint) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {delta && (
            <span
              className={cn(
                "mr-1.5 font-medium",
                delta.good ? "text-[#006300]" : "text-[#d03b3b]"
              )}
            >
              {delta.text}
            </span>
          )}
          {hint}
        </p>
      )}
    </div>
  );
}

/** Compacts 12934 → "12.9K", keeps small numbers exact. */
export function compactNumber(value: number): string {
  if (value < 10000) return value.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
