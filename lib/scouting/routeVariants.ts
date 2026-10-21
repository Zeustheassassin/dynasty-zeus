// ============================================================
// Sub-routes (the user, 2026-10-21): each of the 11 route buckets breaks down
// into the kind of route it was, so a WR who runs 12-yard curls all day can
// be told apart from one who runs 3-yard hitches. The bucket (route_type)
// stays the data driver; the sub-route (route_variant, migration 073) is
// DATA COLLECTION ONLY for now: no grade, model or aggregate view reads it
// until there are enough of each to use.
//
// WR and TE boards. Picking a route starts it on its default sub-route
// (Other has none, so a pick is required). Depths are PFF's bands, by the
// user's call: Short 0–9, Intermediate 10–19, Deep 20+ yards.
//
// NULL route_variant = charted before sub-routes existed (or a paste import,
// which writes none). Keys are per route: "short" on a Curl and "short" on
// a Dig share the key, so depth can later be read across routes.
// supabase/migrations/073_route_variants.sql checks the same pairs.
// ============================================================

import type { RouteType } from "../types";

export type RouteVariant =
  | "wr_screen" | "bubble" | "interior"
  | "true_flat" | "quick_out"
  | "drag" | "slant_stop" | "true_slant" | "deep_slant"
  | "short" | "intermediate" | "deep"
  | "post_dig" | "post_sit"
  | "nine" | "back_shoulder_fade" | "seam" | "love_of_the_game" | "sluggo" | "stop_and_go"
  | "option" | "texas" | "wheel" | "block_release" | "out_and_up";

export interface RouteVariantSpec {
  key: RouteVariant;
  label: string;
  /** For the play list. */
  short: string;
  /** PFF depth band, on the depth sub-routes. */
  yards?: string;
}

const SHORT: RouteVariantSpec        = { key: "short",        label: "Short",        short: "Short", yards: "0–9" };
const INTERMEDIATE: RouteVariantSpec = { key: "intermediate", label: "Intermediate", short: "Int",   yards: "10–19" };
const DEEP: RouteVariantSpec         = { key: "deep",         label: "Deep",         short: "Deep",  yards: "20+" };

/** Each route's sub-routes, in button order (the user's order). */
export const ROUTE_VARIANTS: Record<RouteType, readonly RouteVariantSpec[]> = {
  screen: [
    { key: "wr_screen", label: "WR Screen",       short: "WR" },
    { key: "bubble",    label: "Bubble Screen",   short: "Bubble" },
    { key: "interior",  label: "Interior Screen", short: "Interior" },
  ],
  flat: [
    { key: "true_flat", label: "True Flat", short: "True" },
    { key: "quick_out", label: "Quick Out", short: "Quick Out" },
  ],
  slant: [
    { key: "drag",       label: "Drag",       short: "Drag" },
    { key: "slant_stop", label: "Slant Stop", short: "Stop" },
    { key: "true_slant", label: "True Slant", short: "True" },
    { key: "deep_slant", label: "Deep Slant", short: "Deep" },
  ],
  comeback: [SHORT, INTERMEDIATE, DEEP],
  curl:     [SHORT, INTERMEDIATE, DEEP],
  out:      [INTERMEDIATE, DEEP],
  dig:      [SHORT, INTERMEDIATE, DEEP, { key: "post_dig", label: "Post Dig", short: "Post Dig" }],
  corner:   [SHORT, INTERMEDIATE, DEEP],
  post:     [SHORT, INTERMEDIATE, DEEP, { key: "post_sit", label: "Post Sit", short: "Post Sit" }],
  nine: [
    { key: "nine",               label: "Nine",               short: "Nine" },
    { key: "back_shoulder_fade", label: "Back Shoulder Fade", short: "BSF" },
    { key: "seam",               label: "Seam Route",         short: "Seam" },
    { key: "love_of_the_game",   label: "Love of the Game",   short: "LOTG" },
    { key: "sluggo",             label: "Sluggo",             short: "Sluggo" },
    { key: "stop_and_go",        label: "Stop and Go",        short: "Stop & Go" },
  ],
  other: [
    { key: "option",        label: "Option",            short: "Option" },
    { key: "texas",         label: "Texas",             short: "Texas" },
    { key: "wheel",         label: "Wheel",             short: "Wheel" },
    { key: "block_release", label: "Block and Release", short: "Blk & Rel" },
    { key: "out_and_up",    label: "Out and Up",        short: "Out & Up" },
  ],
};

/** The sub-route a route starts on (the user's defaults). Other has none: it's picked every time. */
export const DEFAULT_ROUTE_VARIANT: Record<RouteType, RouteVariant | null> = {
  screen: "wr_screen",
  flat: "true_flat",
  slant: "true_slant",
  comeback: "intermediate",
  curl: "short",
  out: "intermediate",
  dig: "intermediate",
  corner: "intermediate",
  post: "intermediate",
  nine: "nine",
  other: null,
};

export function defaultRouteVariant(route: RouteType | null): RouteVariant | null {
  return route ? DEFAULT_ROUTE_VARIANT[route] : null;
}

export function routeVariantSpec(route: RouteType | null | undefined, variant: string | null | undefined): RouteVariantSpec | null {
  if (!route || !variant) return null;
  return ROUTE_VARIANTS[route]?.find((v) => v.key === variant) ?? null;
}

/**
 * True while a route still needs its sub-route picked (blocks Log Play /
 * Save Edit): only Other starts empty. `legacy` = editing a route charted
 * before sub-routes, left on its route: it may stay blank.
 */
export function routeVariantMissing(route: RouteType | null, variant: RouteVariant | null, legacy: boolean): boolean {
  if (!route || legacy) return false;
  return variant === null || routeVariantSpec(route, variant) === null;
}

export interface RouteVariantSplit<P> {
  spec: RouteVariantSpec;
  plays: P[];
}

/**
 * One route's plays (all `route`) split by sub-route, for the breakdown
 * tables: the sub-routes charted (button order), then the routes charted
 * before sub-routes (`unsplit`). Empty `splits` when none has a sub-route.
 */
export function splitByRouteVariant<P extends { route_variant?: RouteVariant | null }>(
  route: RouteType,
  routePlays: readonly P[],
): { splits: RouteVariantSplit<P>[]; unsplit: P[] } {
  const splits = ROUTE_VARIANTS[route]
    .map((spec) => ({ spec, plays: routePlays.filter((p) => p.route_variant === spec.key) }))
    .filter((s) => s.plays.length > 0);
  const known = new Set(splits.map((s) => s.spec.key));
  return { splits, unsplit: routePlays.filter((p) => !p.route_variant || !known.has(p.route_variant)) };
}
