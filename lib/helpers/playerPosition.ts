// ============================================================
// A player's fantasy position. Almost the whole app reads Sleeper's single `position` field and
// keeps QB / RB / WR / TE, so a two-way player whose primary position is defensive vanished from
// rankings, rosters, Lineup Coach, To-Do and the rest. Travis Hunter is the live case: Sleeper lists
// him `position: "DB"`, `fantasy_positions: ["DB", "WR"]` (and repeats "DB" on his projection
// rows), while FantasyCalc values him as a WR. Rather than teach ~150 position checks about
// `fantasy_positions`, the player map is normalized where it's built — /api/players, the browser's
// cached copy, Sleeper projection rows and the sim-history cron — so `position` reads WR for him.
//
// Checked against Sleeper's full player map 2026-10-15: the rule changes 6 players, and Hunter is
// the only one on a team (the rest are retired). None of the user's leagues has IDP slots, and the
// app has no IDP lineup logic, so nothing needed his DB label. Sleeper's own value is kept as
// `sleeper_position`.
// ============================================================

export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type SkillPosition = (typeof SKILL_POSITIONS)[number];

export function isSkillPosition(position: string | null | undefined): position is SkillPosition {
  return !!position && (SKILL_POSITIONS as readonly string[]).includes(position);
}

/** Sleeper's `position` when it's QB / RB / WR / TE; otherwise the first of those in
 *  `fantasy_positions`, when the player is listed at more than one position (DB, ["DB","WR"] → WR).
 *  A single-entry list is left alone: every fullback is `FB` with `["RB"]`, and they must not read
 *  as running backs. Anything else comes back unchanged. */
export function fantasySkillPosition(
  position: string | null | undefined,
  fantasyPositions: readonly string[] | null | undefined
): string {
  if (isSkillPosition(position)) return position;
  const eligible = fantasyPositions ?? [];
  if (eligible.length > 1) {
    const skill = eligible.find(isSkillPosition);
    if (skill) return skill;
  }
  return position ?? "";
}

interface PositionedPlayer {
  position: string;
  fantasy_positions?: readonly string[] | null;
  sleeper_position?: string;
}

/** The player map with fantasySkillPosition applied. A changed player is copied with
 *  `sleeper_position` set to Sleeper's own value; everyone else keeps the same object, and so does
 *  the map when nobody changes. Safe to run twice. */
export function withFantasyPositions<T extends PositionedPlayer>(players: Record<string, T>): Record<string, T> {
  let out: Record<string, T> | null = null;
  for (const [id, player] of Object.entries(players)) {
    if (!player || typeof player !== "object") continue;
    const position = fantasySkillPosition(player.position, player.fantasy_positions);
    if (position === player.position) continue;
    out ??= { ...players };
    out[id] = { ...player, position, sleeper_position: player.sleeper_position ?? player.position };
  }
  return out ?? players;
}
