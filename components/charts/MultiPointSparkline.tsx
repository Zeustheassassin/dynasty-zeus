"use client";
import { CHART_DIVERGING } from "../../lib/chartTheme";

// ============================================================
// Hand-rolled SVG sparkline for an arbitrary number of points (1..N),
// rendered inline in dense table rows the same way MiniSparkline.tsx
// is — a mounted Recharts chart per row would be wasteful here too.
// Unlike MiniSparkline (permanently 2-point, see that file's header),
// this plots a real time series: Draft Hub's Consensus board tracks
// avg_pick_no across however many times a user has recompiled the
// network (consensus_draft_history, Phase G stage G1/G2). Values are
// pick numbers, where LOWER is better (moved up the board), so the
// polarity color is inverted relative to a typical value sparkline.
// ============================================================

interface MultiPointSparklineProps {
  values: number[]; // avg_pick_no per snapshot, chronological order
  width?: number;
  height?: number;
  /** Default polarity (false) is avg-pick-no's "lower is better." Pass true
   *  for metrics like playoff odds where a rising line is the good outcome. */
  higherIsBetter?: boolean;
}

export function MultiPointSparkline({ values, width = 40, height = 14, higherIsBetter = false }: MultiPointSparklineProps) {
  if (values.length < 2 || values.some((v) => v <= 0)) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return { x, y };
  });

  // Lower avg_pick_no is better (moved up the board) by default, so a falling
  // line is the "positive" color; higherIsBetter flips that for metrics like odds.
  const improved = higherIsBetter
    ? values[values.length - 1] >= values[0]
    : values[values.length - 1] <= values[0];
  const color = improved ? CHART_DIVERGING.positive : CHART_DIVERGING.negative;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={1.5} fill={color} />
    </svg>
  );
}
