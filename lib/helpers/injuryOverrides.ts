// ============================================================
// Overlay ESPN's (fresher) injury report onto Sleeper's players map.
// Sleeper's map is cached for up to 24h, so a Sunday-morning Out/Doubtful — or
// a stale Out that has since been cleared — wouldn't show up in the Gameday
// Hub otherwise. Pure so the matching rules are unit-testable.
// ============================================================
import { normalizeProjName } from "./scoring";
import type { SleeperPlayer } from "../types";

export interface EspnInjuryEntry {
  name: string;
  position: string;
  team: string;
  status: string;
  date: string | null;
}

const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];
/** ESPN abbreviations that differ from Sleeper's. */
const TEAM_ALIASES: Record<string, string> = { WSH: "WAS", WAS: "WSH" };

/** ESPN status → Sleeper's injury_status vocabulary. `null` = healthy (clears a
 *  stale Sleeper tag); `undefined` = a status we don't recognise (no override). */
export const mapEspnInjuryStatus = (status: string): string | null | undefined => {
  switch (status.trim().toLowerCase()) {
    case "out": return "Out";
    case "injured reserve": return "IR";
    case "doubtful": return "Doubtful";
    case "questionable": return "Questionable";
    case "active": return null;
    default: return undefined;
  }
};

const sameTeam = (sleeperTeam: string | null | undefined, espnTeam: string): boolean => {
  if (!sleeperTeam || !espnTeam) return true; // can't disambiguate — don't block the match
  return sleeperTeam === espnTeam || TEAM_ALIASES[sleeperTeam] === espnTeam;
};

/**
 * Returns a players map with ESPN's injury status applied. Only players ESPN
 * lists are touched; everyone else keeps Sleeper's status. Matching is by
 * normalized name, and — because names collide — the position must agree and the
 * team must not contradict. ESPN wins when it has an entry: Sleeper's map can be
 * a day old, ESPN's report is refreshed continuously.
 *
 * Returns the ORIGINAL map (same reference) when nothing changes.
 */
export function applyInjuryOverrides(
  players: Record<string, SleeperPlayer>,
  injuries: EspnInjuryEntry[]
): Record<string, SleeperPlayer> {
  if (injuries.length === 0) return players;

  const byName = new Map<string, SleeperPlayer[]>();
  for (const player of Object.values(players)) {
    if (!SKILL_POSITIONS.includes(player.position)) continue;
    const key = normalizeProjName(player.full_name ?? "");
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(player);
    else byName.set(key, [player]);
  }

  let next: Record<string, SleeperPlayer> | null = null;
  for (const entry of injuries) {
    const override = mapEspnInjuryStatus(entry.status);
    if (override === undefined) continue;
    const candidates = (byName.get(normalizeProjName(entry.name)) ?? [])
      .filter((p) => p.position === entry.position && sameTeam(p.team, entry.team));
    if (candidates.length !== 1) continue; // unmatched or ambiguous — leave Sleeper's status alone

    const player = candidates[0];
    if ((player.injury_status ?? null) === override) continue;
    if (!next) next = { ...players };
    next[player.player_id] = { ...player, injury_status: override };
  }
  return next ?? players;
}
