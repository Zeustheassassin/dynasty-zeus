"use client";
import { CHART_DIVERGING } from "../../lib/chartTheme";

// ============================================================
// Lightweight 2-point trend sparkline — hand-rolled SVG rather than a
// mounted Recharts chart, since this renders inline in dense/virtualized
// table rows (Rankings, Value Trends) where per-row chart instances would
// be wasteful. See lib/chartTheme.ts for the shared palette this pulls from.
// Only ever has 2 data points today (current value vs. the single stored
// snapshot) — see project_platform_upgrade_plan_july15 memory for why.
// ============================================================

interface MiniSparklineProps {
  from: number;
  to: number;
  width?: number;
  height?: number;
}

export function MiniSparkline({ from, to, width = 32, height = 14 }: MiniSparklineProps) {
  if (from <= 0 || to <= 0) return null;
  const max = Math.max(from, to);
  const min = Math.min(from, to);
  const range = max - min || 1;
  const pad = 2;
  const y1 = height - pad - ((from - min) / range) * (height - pad * 2);
  const y2 = height - pad - ((to - min) / range) * (height - pad * 2);
  const positive = to >= from;
  const color = positive ? CHART_DIVERGING.positive : CHART_DIVERGING.negative;

  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline
        points={`1,${y1} ${width - 2},${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx={width - 2} cy={y2} r={1.5} fill={color} />
    </svg>
  );
}
