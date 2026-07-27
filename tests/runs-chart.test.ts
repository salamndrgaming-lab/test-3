import { describe, expect, it } from "vitest";

import { bucketRunsByDay } from "@/components/dashboard/chart-data";

describe("bucketRunsByDay", () => {
  const now = new Date("2026-07-27T15:00:00Z");

  it("produces one bucket per day for the window, oldest first", () => {
    const buckets = bucketRunsByDay([], 14, now);
    expect(buckets).toHaveLength(14);
    expect(buckets[0].date).toBe("2026-07-14");
    expect(buckets[13].date).toBe("2026-07-27");
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("counts runs into their UTC day and ignores out-of-window runs", () => {
    const buckets = bucketRunsByDay(
      [
        "2026-07-27T00:00:01Z",
        "2026-07-27T23:59:59Z",
        "2026-07-20T12:00:00Z",
        "2026-06-01T12:00:00Z", // out of window
      ],
      14,
      now
    );
    expect(buckets.find((b) => b.date === "2026-07-27")?.count).toBe(2);
    expect(buckets.find((b) => b.date === "2026-07-20")?.count).toBe(1);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
  });
});
