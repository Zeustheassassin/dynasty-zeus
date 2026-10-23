// ============================================================
// RB routes off the WR / TE route tree (the user, 2026-10-23). An RB route
// used to be one of three buckets (route_type: Curl/Screen, Flat/Options,
// Other). Now the board asks the route itself, with its sub-route:
//
//   - in the backfield: Screen, Flat, Curl, Other (the user's three, plus
//     Curl for the sit / check-down routes, asked 2026-10-23);
//   - split out wide (aligned_as_wr): the full 11-route tree, like a WR.
//
// Stored in rb_plays.route_detail / route_variant (migration 077), checked
// against the same sub-route list as WR / TE / QB (route_variant_options).
// DATA COLLECTION ONLY for now: every new route also saves the bucket it
// falls in (rbBucketFor), and the bucket is still what everything reads
// (the Receiving role's Other open rate, the board's route breakdown), so
// the scores don't move. Once there are enough tree routes the models can
// read the route itself; plays charted before 077 only ever have a bucket.
// ============================================================

import type { RBRouteType, RouteType } from "../types";
import type { RouteVariant } from "./routeVariants";

/** The backfield tree, in button order. Split out wide, the board offers all 11. */
export const RB_BACKFIELD_ROUTES: readonly RouteType[] = ["screen", "flat", "curl", "other"];

/** Whether the board offers this route for where he lined up. */
export function rbRouteOffered(route: RouteType, alignedAsWr: boolean): boolean {
  return alignedAsWr || RB_BACKFIELD_ROUTES.includes(route);
}

/**
 * The bucket a tree route is saved under (rb_plays.route_type), the user's
 * mapping (2026-10-23), the same in the backfield or split out: Screen and
 * Curl → Curl/Screen; Flat, Other → Option and Other → Block and Release →
 * Flat/Options; every other route or sub-route → Other (the hard bucket).
 */
export function rbBucketFor(route: RouteType, variant: RouteVariant | null): RBRouteType {
  if (route === "screen" || route === "curl") return "mid_curl";
  if (route === "flat") return "flats";
  if (route === "other" && (variant === "option" || variant === "block_release")) return "flats";
  return "big_boy_route";
}
