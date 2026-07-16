import type { RouteType } from "../../../lib/types";

// Shared "route tree" spoke layout — originally WR-only (Reception Perception
// style), reused as-is by TE (open%) and QB (on-target%) radars so all three
// route-based charts share one visual fan instead of three near-identical copies.
export const ROUTE_RADAR_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "other", "flat", "comeback", "corner", "out",
];

export const ROUTE_RADAR_LABEL: Record<RouteType, string> = {
  nine: "NINE", post: "POST", dig: "DIG", curl: "CURL", slant: "SLANT",
  screen: "SCREEN", other: "OTHER", flat: "FLAT", comeback: "COMEBACK",
  corner: "CORNER", out: "OUT",
};

// degrees from east (right), counter-clockwise — mirrors Reception Perception layout
export const ROUTE_RADAR_ANGLE_DEG: Record<RouteType, number> = {
  nine: 90, post: 55, dig: 10, curl: -32, slant: -60, screen: -80,
  other: -118, flat: 178, comeback: 210, corner: 133, out: 162,
};
