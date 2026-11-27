// Display-only constants shared between the QB charting board and the
// QB Overview panel. Kept here so the panel can render without depending on
// QBChartingBoard (which would create a circular import when the board
// imports the panel).
import type {
  QBSnapPosition,
  QBPlayType,
  QBTiming,
  QBAccuracy,
  QBPlatform,
  QBPlatformSide,
  QBPressure,
  QBPressureHandling,
  QBDepthZone,
  QBIntType,
  QBTouch,
} from "../../../lib/types";

// The QB board's fresh play (the user, 2026-11-26, stage 4 of the scouting
// plan): it opens on, and every reset returns to, Shotgun / Pass / 1st Option /
// Clean Pocket / On Platform / Touch Correct, the most common dropback. The
// charter changes whatever's off. A Run → Pass / RPO switch fills the timing,
// pressure and platform back in, and a throw after a sack / scramble / throw-
// away gets On Platform back (QBChartingBoard handlePlayTypeChange /
// handleTimingChange). An edit opens on the saved play, not these.
export const QB_PLAY_DEFAULTS: {
  snapPosition: QBSnapPosition;
  playType: QBPlayType;
  timing: QBTiming;
  pressure: QBPressure;
  platform: QBPlatform;
  touch: QBTouch;
} = {
  snapPosition: "shotgun",
  playType: "pass",
  timing: "first_option",
  pressure: "clean",
  platform: "on_platform",
  touch: "correct",
};

// Interception types: the board's INT Type buttons, the play list's short code
// ("INT (BT)") and the Overview panel's counts, in this order. Records only (no
// grade reads them). WR Error (2026-11-17): the receiver's mistake made the pick
// (wrong route, fell down, let it through); a tipped ball he should have caught
// stays Tipped Ball with its WR Fault call.
export const INT_TYPES: { key: QBIntType; label: string; short: string }[] = [
  { key: "bad_throw",    label: "Bad Throw",    short: "BT" },
  { key: "bad_decision", label: "Bad Decision", short: "BD" },
  { key: "fifty_fifty",  label: "50/50 Ball",   short: "50" },
  { key: "tipped",       label: "Tipped Ball",  short: "TP" },
  { key: "wr_error",     label: "WR Error",     short: "WR err" },
];

/** "BT" etc. for a pick's type; "" when it has none, or an unknown one. */
export function intTypeShort(type: QBIntType | null | undefined): string {
  return INT_TYPES.find((t) => t.key === type)?.short ?? "";
}

export const SNAP_POSITIONS: { key: QBSnapPosition; label: string }[] = [
  { key: "shotgun",      label: "Shotgun" },
  { key: "pistol",       label: "Pistol" },
  { key: "under_center", label: "Under Center" },
];

export const PLAY_TYPES: { key: QBPlayType; label: string; color: string }[] = [
  { key: "run",  label: "Run",  color: "bg-emerald-700" },
  { key: "rpo",  label: "RPO",  color: "bg-amber-700" },
  { key: "pass", label: "Pass", color: "bg-blue-700" },
];

export const TIMINGS: { key: QBTiming; label: string }[] = [
  { key: "first_option",  label: "1st Option" },
  { key: "second_option", label: "2nd Option +" },
  { key: "checkdown",     label: "Check Down" },
  { key: "extended_play", label: "Extended Play" },
  { key: "scramble",      label: "Scramble" },
  { key: "sack",          label: "Sack" },
  { key: "throw_away",    label: "Throw Away" },
];

export const ACCURACIES: { key: QBAccuracy; label: string; active: string }[] = [
  { key: "on_target",   label: "On Target",   active: "bg-emerald-600" },
  { key: "high",        label: "High",        active: "bg-red-600" },
  { key: "low",         label: "Low",         active: "bg-red-700" },
  { key: "in_front",    label: "In Front",    active: "bg-orange-600" },
  { key: "behind",      label: "Behind",      active: "bg-orange-700" },
  { key: "tipped_ball", label: "Tipped Ball", active: "bg-amber-600" },
];

export const PLATFORMS: { key: QBPlatform; label: string }[] = [
  { key: "on_platform",  label: "On Platform" },
  { key: "off_platform", label: "Off Platform" },
  { key: "on_the_run",   label: "On the Run" },
];

export const PLATFORM_SIDES: { key: QBPlatformSide; label: string }[] = [
  { key: "strong_side", label: "Strong Side" },
  { key: "cross_body",  label: "Cross Body" },
];

// 4-bucket platform breakdown used on the Overview panel. on_the_run is split
// by platform_side; the schema only allows platform_side when platform=on_the_run.
export type PlatformBreakdownKey = "on_platform" | "off_platform" | "on_the_run_strong_side" | "on_the_run_cross_body";
export const PLATFORM_BREAKDOWN: { key: PlatformBreakdownKey; label: string }[] = [
  { key: "on_platform",            label: "On Platform" },
  { key: "off_platform",           label: "Off Platform" },
  { key: "on_the_run_strong_side", label: "On the Run — Strong Side" },
  { key: "on_the_run_cross_body",  label: "On the Run — Cross Body" },
];

export const PRESSURES: { key: QBPressure; label: string; active: string }[] = [
  { key: "clean",      label: "Clean Pocket",   active: "bg-emerald-700" },
  { key: "mid",        label: "Mid Pressure",   active: "bg-amber-700" },
  { key: "backside",   label: "Backside Pressure",  active: "bg-amber-700" },
  { key: "front_side", label: "Front Side Pressure", active: "bg-amber-700" },
];

export const PRESSURE_HANDLINGS: { key: QBPressureHandling; label: string }[] = [
  { key: "step_up",          label: "Step Up" },
  { key: "bail_front_side",  label: "Bail Front Side" },
  { key: "bail_backside",    label: "Bail Backside" },
  // The user, 2026-10-22 (migration 076).
  { key: "backpedal",        label: "Backpedal" },
];

// 3×3 depth-zone grid layout
export const DEPTH_ROWS: { label: string; short: string; depths: { loc: string; key: QBDepthZone }[] }[] = [
  { label: "20+ (Deep)", short: "D", depths: [
    { loc: "Left",   key: "deep_left"   },
    { loc: "Center", key: "deep_center" },
    { loc: "Right",  key: "deep_right"  },
  ]},
  { label: "10-20 (Mid)", short: "M", depths: [
    { loc: "Left",   key: "mid_left"   },
    { loc: "Center", key: "mid_center" },
    { loc: "Right",  key: "mid_right"  },
  ]},
  { label: "U10 (Short)", short: "S", depths: [
    { loc: "Left",   key: "short_left"   },
    { loc: "Center", key: "short_center" },
    { loc: "Right",  key: "short_right"  },
  ]},
];

export function onTargetColor(p: number | null): string {
  if (p === null) return "text-slate-600";
  if (p >= 65) return "text-emerald-400";
  if (p >= 50) return "text-amber-400";
  return "text-red-400";
}
