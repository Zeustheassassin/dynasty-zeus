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

/** Fixed position→hue identity used for position labels/badges app-wide.
 *  Categorical, not status — QB/RB/WR/TE keep their own hue regardless of
 *  "good/bad" meaning, so never repurpose these for STATUS_CLASSES use.
 *  Consolidated here in Phase 7 of the visual polish pass after this same
 *  QB=red/RB=green/WR=blue/TE=yellow map had drifted into three competing
 *  variants (a QB=blue/WR=yellow/TE=orange scheme in the Scouting Hub's
 *  recruiting tabs, and a purple/orange variant in a couple of one-off
 *  files) across ~15 files. FB/EDGE/ATH are recruiting-only extras. */
export const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
  FB: "text-orange-400",
  EDGE: "text-purple-400",
  ATH: "text-pink-400",
} as const;

/** Same identity hues as POS_COLOR, as a filled bg+text pill for badge/chip UI. */
export const POS_BADGE: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-green-500/20 text-green-400",
  WR: "bg-blue-500/20 text-blue-400",
  TE: "bg-yellow-500/20 text-yellow-400",
  FB: "bg-orange-500/20 text-orange-400",
  EDGE: "bg-purple-500/20 text-purple-400",
  ATH: "bg-pink-500/20 text-pink-400",
} as const;
