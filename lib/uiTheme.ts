// ============================================================
// Shared UI tokens for non-chart surfaces (buttons, cards, badges, alerts).
// Chart colors live in lib/chartTheme.ts — STATUS below re-exports the same
// good/warning/serious/critical scale so charts and UI agree, instead of the
// ad-hoc green/emerald/red/orange/yellow mix that had accumulated per file.
// Part of the July 2026 visual-polish pass, Phase 1 (foundation).
// ============================================================

import { CHART_STATUS } from "./chartTheme";

/** Same four-slot semantic scale charts use — the hex values, for callers
 *  that need a raw color rather than a Tailwind class (e.g. inline SVG). */
export const STATUS = CHART_STATUS;

/** Fixed Tailwind class sets for each STATUS slot. Never swap which hue
 *  maps to which slot — that's the whole point of having one scale. */
export const STATUS_CLASSES = {
  good: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  warning: "border-amber-800 bg-amber-950/40 text-amber-300",
  serious: "border-orange-800 bg-orange-950/40 text-orange-300",
  critical: "border-red-800 bg-red-950/40 text-red-300",
} as const;

/** One accent color, app-wide — matches the nav's pre-existing active-tab
 *  blue and CHART_CATEGORICAL's slot-1 blue. */
export const ACCENT_CLASSES = {
  text: "text-blue-400",
  textHover: "hover:text-blue-300",
  solid: "bg-blue-600 hover:bg-blue-500",
  ring: "focus-visible:ring-blue-500",
} as const;

/** Elevation convention: "raised" for cards that should visually separate
 *  from the page background (dashboard panels, standalone widgets); "flush"
 *  (no shadow) for cards nested inside another raised surface. */
export const ELEVATION = {
  raised: "shadow-lg shadow-black/30",
  flush: "",
} as const;
