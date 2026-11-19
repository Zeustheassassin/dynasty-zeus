import type { ChartingDecision, RouteType } from "../../../lib/types";
import { SAMPLE_FULL_PLAYS, sampleTier } from "../../../lib/scouting/sampleTiers";

export const GAME_TYPES = ["regular", "bowl", "playoff", "scrimmage"];

/** Fully Charted comes from the full sample (deriveChartingDecision), so the
 *  status pickers show it but don't offer it. */
export const FULLY_CHARTED_HINT =
  `Fully Charted is set by the Big Board's full sample: QB ${SAMPLE_FULL_PLAYS.QB} graded throws, ` +
  `RB ${SAMPLE_FULL_PLAYS.RB} runs, WR ${SAMPLE_FULL_PLAYS.WR} routes, TE ${SAMPLE_FULL_PLAYS.TE} routes`;

export const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Undecided" },
  { value: "not_charting",  label: "Not Charting" },
];

export const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];

export const ROUTE_LABELS: Record<RouteType, string> = {
  nine: "Nine", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Screen", flat: "Flat", comeback: "Comeback", out: "Out", corner: "Corner", other: "Other",
};

const hasFullSample = (pos: string | undefined): pos is keyof typeof SAMPLE_FULL_PLAYS =>
  pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";

// Moves along the charting → partial_chart → fully_charted chain. Charting even
// one game means the user decided to chart him, so "pending" (Undecided) with a
// charted game joins the chain too (the user's call, 2026-10-12).
// "not_charting" is left alone.
// Fully Charted at QB / RB / WR / TE is the Big Board's full sample and nothing
// else (the user, 2026-11-19): `samplePlays` (his graded throws, known runs, WR
// routes or rated TE routes) at SAMPLE_FULL_PLAYS (QB 180, RB 100, WR 160,
// TE 140), the count the Big Board's sample dot reads. So it reads Fully
// Charted exactly when that dot is green, and a Fully Charted stored under the
// full sample (picked by hand, or written back by an older rule) reads as
// Partial Chart. Any other position: 8 games, never demoted.
export function deriveChartingDecision(
  stored: ChartingDecision,
  totalGames: number,
  position?: string,
  samplePlays?: number,
): ChartingDecision {
  if (stored === "not_charting") return stored;
  if (stored === "pending" && totalGames < 1) return stored;

  if (hasFullSample(position)) {
    if (sampleTier(samplePlays ?? 0, SAMPLE_FULL_PLAYS[position]) === "full") return "fully_charted";
    if (stored === "fully_charted") return totalGames >= 1 ? "partial_chart" : "charting";
  } else if (totalGames >= 8) {
    return "fully_charted";
  }

  if (totalGames >= 1 && (stored === "charting" || stored === "pending")) return "partial_chart";
  return stored;
}
