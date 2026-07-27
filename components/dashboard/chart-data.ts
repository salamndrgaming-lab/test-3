export interface DayBucket {
  date: string; // YYYY-MM-DD
  count: number;
}

/** Buckets run start timestamps into per-UTC-day counts for the chart window. */
export function bucketRunsByDay(
  startedAts: string[],
  days = 14,
  now = new Date()
): DayBucket[] {
  const buckets: DayBucket[] = [];
  const dayMs = 86_400_000;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    buckets.push({ date: new Date(todayUtc - i * dayMs).toISOString().slice(0, 10), count: 0 });
  }
  const index = new Map(buckets.map((bucket, i) => [bucket.date, i]));
  for (const startedAt of startedAts) {
    const i = index.get(startedAt.slice(0, 10));
    if (i !== undefined) buckets[i].count += 1;
  }
  return buckets;
}

/** Rounds a maximum up to a clean axis ceiling (5, 10, 20, 50, ...). */
export function niceMax(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const multiple of [1, 2, 5, 10]) {
    if (value <= multiple * magnitude) return multiple * magnitude;
  }
  return 10 * magnitude;
}
