// ============================================================
// Public shared roster — /roster/{leagueId}/{rosterId}
// ============================================================
// Pure view model for the read-only roster page a user can send to a friend (no login). It shows
// one team's QB/RB/WR/TE in value order plus its picks, and NOTHING personal: no dispositions
// (Core/Pricey/…), no free agents, no scores or records. Values are the same league-adjusted
// FantasyCalc dynasty values the Rosters tab shows (applyScoringMultipliers), and the position
// ranks come from the same getLeaguePositionalBaseline the Roster Direction card uses.
// ============================================================

import type {
  SleeperLeague, SleeperRoster, SleeperUser, SleeperTradedPick, SleeperDraft, AugmentedPick,
} from "../types";
import { applyScoringMultipliers, computeScoringMultipliers } from "./scoring";
import { buildLeaguePickPool, sortOwnerPicks } from "./picks";
import { getLeaguePositionalBaseline, getRosterPositionalStrength } from "./direction/baseline";
import { getLineupSettings } from "./lineup";
import { ordinal } from "./math";
import { CURRENT_YEAR } from "./season";

export const PUBLIC_ROSTER_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type PublicRosterPosition = (typeof PUBLIC_ROSTER_POSITIONS)[number];
export type PublicRosterRole = "Starter" | "Bench" | "Taxi" | "IR";

export interface PublicRosterPlayer {
  id: string;
  name: string;
  role: PublicRosterRole;
  value: number;
}

export interface PublicRosterColumn {
  pos: PublicRosterPosition;
  players: PublicRosterPlayer[];
  totalValue: number;
  avgAge: number | null;
  /** 1 = most value at this position in the league. */
  rank: number;
}

export interface PublicRosterPick {
  key: string;
  /** "1.04" for a current-season pick with a known slot, else "1st"/"2nd"/… */
  label: string;
  /** Display name of the team the pick originally belonged to; null for the team's own pick. */
  fromName: string | null;
}

export interface PublicRosterView {
  leagueName: string;
  teamName: string;
  ownerName: string;
  /** e.g. "QB 1 • RB 2 • WR 3 • TE 1 • FLEX 2 • SFLEX 1" */
  lineup: string;
  teamCount: number;
  columns: PublicRosterColumn[];
  picksByYear: Array<{ year: string; picks: PublicRosterPick[] }>;
  pickCount: number;
}

/** The fields of a player-map entry this page reads (the slim /api/players shape satisfies it). */
export interface PublicRosterPlayerInfo {
  full_name?: string;
  position?: string;
  age?: number | null;
}

/** Parses a raw /api/fc-values array into Sleeper ID -> value (same rule as useCalcValues:
 *  every entry with a Sleeper ID; pick entries have none, so they drop out). */
export function fcValuesBySleeperId(raw: unknown): Record<string, number> {
  const vals: Record<string, number> = {};
  if (!Array.isArray(raw)) return vals;
  for (const entry of raw as Array<{ player?: { sleeperId?: string | number }; value?: unknown }>) {
    const sleeperId = entry?.player?.sleeperId;
    if (sleeperId != null && sleeperId !== "" && typeof entry.value === "number") vals[String(sleeperId)] = entry.value;
  }
  return vals;
}

/** A team's name the way Sleeper shows it: the owner's custom team name when set, else their
 *  display name. */
export function publicTeamName(roster: SleeperRoster, owner: SleeperUser | undefined): string {
  return owner?.metadata?.team_name || roster.settings?.team_name || owner?.display_name || `Team ${roster.roster_id}`;
}

function roleFor(roster: SleeperRoster, id: string): PublicRosterRole {
  if (roster.starters?.includes(id)) return "Starter";
  if (roster.reserve?.includes(id)) return "IR";
  if (roster.taxi?.includes(id)) return "Taxi";
  return "Bench";
}

/** "1.04" only when the pick's slot is real — buildLeaguePickPool's perLeague mode falls back to a
 *  roster-id slot for a current-season pick before the draft order is set, which a friend reading
 *  this page would take as the actual slot. Everything else reads "1st"/"2nd"/… */
function pickLabel(pick: AugmentedPick, hasRealSlot: boolean): string {
  if (String(pick.season) === CURRENT_YEAR && hasRealSlot && pick.slot) return pick.slot;
  return ordinal(Number(pick.round));
}

export interface BuildPublicRosterInput {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  players: Record<string, PublicRosterPlayerInfo | undefined>;
  /** Raw FantasyCalc dynasty values for the league's QB format (Sleeper ID -> value). */
  fcValues: Record<string, number>;
  rosterId: number;
}

/** Null when the league has no roster with this id. */
export function buildPublicRoster(input: BuildPublicRosterInput): PublicRosterView | null {
  const { league, rosters, users, tradedPicks, drafts, players, fcValues, rosterId } = input;
  const roster = rosters.find((r) => Number(r.roster_id) === rosterId);
  if (!roster) return null;

  const values = applyScoringMultipliers(
    fcValues,
    computeScoringMultipliers(league.scoring_settings ?? {}),
    players
  );
  const valueOf = (id: string) => values[id] ?? 0;

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const ownerNameByRosterId = new Map<number, string>();
  rosters.forEach((r) => {
    const name = userById.get(r.owner_id)?.display_name;
    if (name) ownerNameByRosterId.set(Number(r.roster_id), name);
  });
  const owner = userById.get(roster.owner_id);

  const baseline = getLeaguePositionalBaseline({
    rosters,
    players: players as Record<string, { position?: string }>,
    dynastyValueForPlayer: valueOf,
    positions: [...PUBLIC_ROSTER_POSITIONS],
  });
  const rankByPos = new Map(getRosterPositionalStrength(rosterId, baseline).map((s) => [s.pos, s.rank]));

  const columns: PublicRosterColumn[] = PUBLIC_ROSTER_POSITIONS.map((pos) => {
    const list: PublicRosterPlayer[] = [];
    const ages: number[] = [];
    for (const id of roster.players ?? []) {
      const p = players[id];
      if (!p || p.position !== pos) continue;
      list.push({ id, name: p.full_name || "Unknown", role: roleFor(roster, id), value: valueOf(id) });
      const age = Number(p.age);
      if (Number.isFinite(age) && age > 0) ages.push(age);
    }
    list.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    return {
      pos,
      players: list,
      totalValue: list.reduce((s, p) => s + p.value, 0),
      avgAge: ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null,
      rank: rankByPos.get(pos) ?? 0,
    };
  });

  const ownedPicks = sortOwnerPicks(buildLeaguePickPool(rosters, tradedPicks, drafts, "perLeague"), rosterId);
  // Rosters whose current-season slot comes from the real draft order (keyed by owner user id).
  const draftOrder = drafts.find((d) => String(d.season) === CURRENT_YEAR)?.draft_order ?? {};
  const rostersWithRealSlot = new Set(
    rosters.filter((r) => Number(draftOrder[r.owner_id]) > 0).map((r) => Number(r.roster_id))
  );
  const picksByYear: PublicRosterView["picksByYear"] = [];
  for (const pick of ownedPicks) {
    const year = String(pick.season);
    let group = picksByYear[picksByYear.length - 1];
    if (!group || group.year !== year) {
      group = { year, picks: [] };
      picksByYear.push(group);
    }
    const original = Number(pick.roster_id);
    group.picks.push({
      key: `${year}-${pick.round}-${original}`,
      label: pickLabel(pick, rostersWithRealSlot.has(original)),
      fromName: original === rosterId ? null : ownerNameByRosterId.get(original) ?? `Team ${original}`,
    });
  }

  return {
    leagueName: league.name,
    teamName: publicTeamName(roster, owner),
    ownerName: owner?.display_name ?? "",
    lineup: getLineupSettings(league),
    teamCount: rosters.length,
    columns,
    picksByYear,
    pickCount: ownedPicks.length,
  };
}
