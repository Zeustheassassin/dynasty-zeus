import type { CSSProperties } from "react";

// ============================================================
// Shared chart theme — dark-only, matches the app's gray-900/800/700
// card surfaces. Prerequisite for every chart built in Phase D onward
// (see the July 2026 platform-upgrade plan, stage A5 / decision V12).
//
// Categorical palette validated against the app's card surface
// (#111827, i.e. Tailwind gray-900) with scripts/validate_palette.js
// from the dataviz skill — all six checks pass (lightness band, chroma
// floor, CVD separation, normal-vision floor, contrast). Slot order is
// the CVD-safety mechanism: never reorder, only take a shorter prefix
// when a chart needs fewer than 8 series.
// ============================================================

/** Fixed-order categorical series colors. Slot 1 first, never cycled. */
export const CHART_CATEGORICAL = [
  "#3987e5", // 1 blue
  "#008300", // 2 green
  "#d55181", // 3 magenta
  "#c98500", // 4 yellow
  "#199e70", // 5 aqua
  "#d95926", // 6 orange
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

/** Single-hue sequential ramp (magnitude), light -> dark. */
export const CHART_SEQUENTIAL = {
  100: "#cde2fb",
  200: "#9ec5f4",
  300: "#6da7ec",
  400: "#3987e5",
  500: "#256abf",
  600: "#184f95",
  700: "#0d366b",
} as const;

/** Diverging pair (polarity) + neutral midpoint. */
export const CHART_DIVERGING = {
  positive: "#3987e5", // blue
  negative: "#e66767", // red
  neutral: "#383835",
} as const;

/** Fixed, reserved status scale — never used for plain series identity. */
export const CHART_STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/** Chart chrome/ink, tuned to the app's actual card surface (gray-900/800/700). */
export const CHART_CHROME = {
  surface: "#111827",       // gray-900 — matches bg-gray-900 card pattern used app-wide
  border: "#1f2937",        // gray-800 — matches border-gray-800 card pattern
  gridline: "#1f2937",      // gray-800
  axis: "#374151",          // gray-700
  textPrimary: "#f9fafb",   // gray-50
  textSecondary: "#9ca3af", // gray-400 — matches the app's usual secondary-text shade
  textMuted: "#6b7280",     // gray-500
  tooltipBg: "#030712",     // gray-950 — matches bg-gray-950 card pattern
  tooltipBorder: "#374151", // gray-700
} as const;

/** Recharts inherits nothing from the DOM by default; every text-bearing
 *  element (axis ticks, legend, tooltip) should spread this so numbers use
 *  the app's font and align in columns. */
export const CHART_FONT_STYLE: CSSProperties = {
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontVariantNumeric: "tabular-nums",
  fontSize: 11,
};
