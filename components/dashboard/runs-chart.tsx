/**
 * Runs-per-day column chart (last 14 days), server-rendered SVG from real
 * run rows. Single series → no legend (the title names it). Mark specs:
 * columns ≤24px with 4px rounded caps square at the baseline, 2px gaps,
 * hairline solid gridlines, muted axis text, selective labeling (peak only),
 * native per-column tooltips.
 */

import { niceMax, type DayBucket } from "./chart-data";

const SERIES = "#2a78d6"; // categorical slot 1 (validated reference palette)
const GRID = "#e1e0d9";
const AXIS_INK = "#898781";
const LABEL_INK = "#52514e";

export function RunsChart({ buckets }: { buckets: DayBucket[] }) {
  const width = 720;
  const height = 180;
  const pad = { top: 16, right: 8, bottom: 22, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = niceMax(Math.max(...buckets.map((b) => b.count), 1));
  const slot = plotW / buckets.length;
  const barW = Math.min(24, slot - 2);
  const peak = buckets.reduce((best, b, i) => (b.count > buckets[best].count ? i : best), 0);

  const y = (count: number) => pad.top + plotH * (1 - count / max);
  const ticks = [0, max / 2, max].map((t) => Math.round(t));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Runs per day, last 14 days"
      className="h-auto w-full"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={GRID}
            strokeWidth={1}
          />
          <text
            x={pad.left - 6}
            y={y(tick) + 3}
            textAnchor="end"
            fontSize={10}
            fill={AXIS_INK}
          >
            {tick.toLocaleString("en-US")}
          </text>
        </g>
      ))}

      {buckets.map((bucket, i) => {
        const x = pad.left + i * slot + (slot - barW) / 2;
        const top = y(bucket.count);
        const barH = Math.max(pad.top + plotH - top, bucket.count > 0 ? 2 : 0);
        const radius = Math.min(4, barW / 2, barH);
        const label = new Date(`${bucket.date}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        return (
          <g key={bucket.date}>
            {barH > 0 && (
              // Rounded cap, square baseline.
              <path
                d={`M ${x} ${pad.top + plotH}
                    L ${x} ${top + radius}
                    Q ${x} ${top} ${x + radius} ${top}
                    L ${x + barW - radius} ${top}
                    Q ${x + barW} ${top} ${x + barW} ${top + radius}
                    L ${x + barW} ${pad.top + plotH} Z`}
                fill={SERIES}
              >
                <title>{`${label}: ${bucket.count.toLocaleString("en-US")} runs`}</title>
              </path>
            )}
            {i === peak && bucket.count > 0 && (
              <text
                x={x + barW / 2}
                y={top - 4}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill={LABEL_INK}
              >
                {bucket.count.toLocaleString("en-US")}
              </text>
            )}
            {(i === 0 || i === buckets.length - 1 || i === Math.floor(buckets.length / 2)) && (
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill={AXIS_INK}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      <line
        x1={pad.left}
        x2={width - pad.right}
        y1={pad.top + plotH}
        y2={pad.top + plotH}
        stroke="#c3c2b7"
        strokeWidth={1}
      />
    </svg>
  );
}
