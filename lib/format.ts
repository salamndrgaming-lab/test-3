export function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);
}

export interface Deadline {
  label: string;
  /** urgent = <48h or overdue; warning = <7d */
  tone: "overdue" | "urgent" | "warning" | "normal";
}

export function formatDeadline(evidenceDueBy: string | null, now = new Date()): Deadline | null {
  if (!evidenceDueBy) return null;
  const due = new Date(evidenceDueBy);
  const ms = due.getTime() - now.getTime();
  if (ms <= 0) return { label: "past due", tone: "overdue" };

  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const label = days >= 1 ? `${days}d ${hours % 24}h left` : `${hours}h left`;

  if (hours < 48) return { label, tone: "urgent" };
  if (days < 7) return { label, tone: "warning" };
  return { label, tone: "normal" };
}
