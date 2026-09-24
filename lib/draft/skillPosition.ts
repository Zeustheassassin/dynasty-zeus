/**
 * Who counts as a fantasy-relevant player on the Consensus Draft Board.
 *
 * The board is a rookie ADP board, so it lists QB / RB / WR / TE and nothing
 * else. That sounds like a one-line `includes()` check, and used to be one —
 * but a player's position is not a single fact. There are three sources, and
 * they disagree:
 *
 *   1. `compiled`  — the position recorded on the draft pick at compile time
 *                    (`pick.metadata.position`, frozen whenever the board was
 *                    last compiled, possibly years ago).
 *   2. `current`   — Sleeper's primary position for that player today.
 *   3. `fantasyPositions` — Sleeper's eligibility list, which is where a
 *                    genuinely two-way player shows up twice.
 *
 * A player qualifies if ANY of those says a skill position, with one
 * deliberate restriction on the third (see below). Concretely:
 *
 *   - **Travis Hunter** is `position: "DB"`, `fantasy_positions: ["DB","WR"]`
 *     in Sleeper's map. His 2025 pick metadata happens to say "WR", so he
 *     shows today — but a recompile that fell back to the player map would
 *     silently drop the WR4-by-ADP off the board. The dual-eligibility clause
 *     is what keeps him on it either way. Checked against the full Sleeper
 *     player map: he is the ONLY active player that clause admits.
 *   - **Sione Vaki** was compiled as "DB" (15 drafts in 2024) and is an RB in
 *     Sleeper today. The `current` clause is what puts him on the board.
 *
 * The restriction: the `fantasyPositions` clause requires **more than one**
 * eligibility. That is what keeps fullbacks off the board — every FB in
 * Sleeper's map is `position: "FB"` with `fantasy_positions: ["RB"]`, a single
 * entry, so they fail all three clauses. Without the length check they would
 * all be readmitted as RBs. (One retired FB, James Casey, is listed
 * `["RB","TE"]` and would slip through; he predates the 2020 floor of the
 * consensus cache by a decade, so he cannot appear.)
 */

export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type SkillPosition = (typeof SKILL_POSITIONS)[number];

/** The three (disagreeing) things we can know about one player's position. */
export interface PositionSources {
  /** Position frozen onto the draft pick when the board was compiled. */
  compiled?: string | null;
  /** Sleeper's primary position for this player right now. */
  current?: string | null;
  /** Sleeper's `fantasy_positions` eligibility list. */
  fantasyPositions?: readonly string[] | null;
}

export function isSkillPosition(position: string | null | undefined): position is SkillPosition {
  return !!position && (SKILL_POSITIONS as readonly string[]).includes(position);
}

/** True when any source above puts this player at a skill position. */
export function countsAsSkillPlayer(sources: PositionSources): boolean {
  if (isSkillPosition(sources.compiled)) return true;
  if (isSkillPosition(sources.current)) return true;
  const eligible = sources.fantasyPositions ?? [];
  // Multi-eligibility only — a lone "RB" here is every fullback in the league.
  return eligible.length > 1 && eligible.some(isSkillPosition);
}

/**
 * The position to print in the board's Pos column.
 *
 * Prefers whichever source first yields a skill position, so an admitted
 * two-way or reclassified player reads as the thing that makes him relevant
 * (Sione Vaki as RB, not the "DB" frozen into his 2024 pick metadata) rather
 * than showing a defensive label on a fantasy board. Falls back to whatever
 * label exists when none of them is a skill position.
 */
export function displayPosition(sources: PositionSources): string {
  if (isSkillPosition(sources.compiled)) return sources.compiled;
  if (isSkillPosition(sources.current)) return sources.current;
  const fromEligibility = (sources.fantasyPositions ?? []).find(isSkillPosition);
  if (fromEligibility) return fromEligibility;
  return sources.compiled || sources.current || "";
}
