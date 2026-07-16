"use client";
import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { CHART_CHROME, CHART_FONT_STYLE } from "../../lib/chartTheme";

// ============================================================
// Shared chart primitives — the dark-theme wrapper every V-item chart
// builds on (Phase A stage A5 / decision V12). Colors and chrome come
// from lib/chartTheme.ts; nothing here is chart-type-specific.
// ============================================================

interface ChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  /** Rendered below the chart, outside ResponsiveContainer's fixed-height box.
   *  Pass a <ChartLegend/> here instead of nesting it as a chart child —
   *  ResponsiveContainer sizes to exactly `height`, and a legend nested
   *  inside it has no guaranteed room, so it can visually spill into
   *  whatever follows the card in the DOM instead of sitting below the chart. */
  legend?: ReactNode;
  children: ReactNode;
}

/** Standard card shell for a full-size chart — matches the app's
 *  `bg-gray-900 border border-gray-800 rounded-xl` panel pattern. */
export function ChartCard({ title, subtitle, height = 260, legend, children }: ChartCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-white">{title}</div>
        {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
      {legend}
    </div>
  );
}

/** Shared axis tick style — spread onto <XAxis tick={...}> / <YAxis tick={...}>. */
export const chartTickStyle = {
  fill: CHART_CHROME.textSecondary,
  ...CHART_FONT_STYLE,
};

/** Shared <CartesianGrid> props. */
export const chartGridProps = {
  stroke: CHART_CHROME.gridline,
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/** Shared axis line/tick-line props — spread onto <XAxis> / <YAxis>. */
export const chartAxisProps = {
  stroke: CHART_CHROME.axis,
  tickLine: false,
  axisLine: { stroke: CHART_CHROME.axis },
} as const;

/** Themed tooltip content, in place of Recharts' default light-mode box.
 *  Pass as `<Tooltip content={ChartTooltip} />` — the bare component reference,
 *  not `<ChartTooltip />`, since Recharts injects active/payload/label itself
 *  at render time and TS can't verify a pre-built element satisfies those
 *  required props. Values render tabular-nums so multi-row tooltips align. */
export function ChartTooltip<TValue extends ValueType = ValueType, TName extends NameType = NameType>({
  active,
  payload,
  label,
}: TooltipContentProps<TValue, TName>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-2xl"
      style={{
        background: CHART_CHROME.tooltipBg,
        border: `1px solid ${CHART_CHROME.tooltipBorder}`,
        ...CHART_FONT_STYLE,
      }}
    >
      {label != null && (
        <div className="mb-1 font-semibold" style={{ color: CHART_CHROME.textPrimary }}>
          {label}
        </div>
      )}
      <div className="space-y-0.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: entry.color }}
            />
            <span style={{ color: CHART_CHROME.textSecondary }}>{entry.name}</span>
            <span className="tabular-nums ml-auto pl-3" style={{ color: CHART_CHROME.textPrimary }}>
              {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ChartLegendProps {
  items: { label: string; color: string }[];
}

/** Direct-labeled legend row — every multi-series chart needs one (identity
 *  is never color-alone). Not used for single-series charts (the title names it). */
export function ChartLegend({ items }: ChartLegendProps) {
  return (
    <div className="flex flex-wrap gap-3 mt-2 text-[11px]" style={{ color: CHART_CHROME.textSecondary }}>
      {items.map(({ label, color }) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
