// ============================================================
// Roster Crunch: who has to go once the season ends and the next rookie class arrives. IR players
// come off IR when the year ends, and every pick owned in the next rookie draft adds a player, so
// the count is the whole roster plus those picks, against active spots plus whatever taxi can hold.
//
// Who can sit on taxi next season comes from Sleeper's two taxi settings:
//   - Taxi Squad Years Experience Limit (taxi_years): a player past it must be activated. 0 = No
//     Max, he can stay forever.
//   - Allow Non-Rookies For Taxi (taxi_allow_vets). Off: a player already on taxi can be left there
//     until the limit, but only a rookie can be added, and once he comes off he can't go back.
//     On: anyone inside the limit can go on.
// Sleeper's meaning checked against the settings screen and every taxi squad in a real 36-league
// account (2026-11-03): nobody past the limit was on one.
//
// A free agent has to land on the active roster before moving to taxi, and a team over the limit
// can't add one. So a taxi the roster can't fill on its own costs one extra cut (user, 11/03): one
// open spot is enough, since each rookie moves down and frees it for the next.
//
// The danger list is strictly lowest value first, whole roster, IR and taxi included, and tags
// don't move anyone on or off it (user, 11/03). Values are adjusted to each league's scoring, the
// number the Rosters tab shows: a TE premium or 6-point passing TDs can reorder a list. Being on
// it overrides Core and Pricey elsewhere: see withDangerTags.
// ============================================================
import { normalizeDisposition } from "./dispositions";
import { ownedPicksByRound, pickSeasonWindow, rookieDraftRoundCount } from "./picks";
import { isSkillPosition } from "./playerPosition";
import { getRosterSlotSummary, type SlotFill } from "./rosterSlots";
import { computeScoringMultipliers } from "./scoring";
import { CURRENT_YEAR } from "./season";
import type {
  LeagueAssetDispositions,
  LeagueOverviewEntry,
  SleeperDraft,
  SleeperLeague,
  SleeperPlayer,
  SleeperRoster,
  SleeperTradedPick,
} from "../types";

/** Extra names listed past the must-cut count, so there's a choice of who goes. */
export const DANGER_CUSHION = 2;

export interface DangerPlayer {
  playerId: string;
  /** League-adjusted FantasyCalc value; 0 = not on FantasyCalc's list at all. */
  value: number;
  /** One of the DANGER_CUSHION extras rather than a must-cut. */
  cushion: boolean;
  where: "ACTIVE" | "IR" | "TAXI";
}

export interface RosterCrunch {
  /** The next rookie draft this league hasn't held. */
  draftSeason: string;
  /** Picks owned in that draft, index 0 = round 1; one entry per round the league drafts. */
  picksByRound: number[];
  picks: number;
  active: SlotFill;
  ir: SlotFill;
  taxi: SlotFill;
  rookiesOnly: boolean;
  /** Sleeper's experience limit in years; 0 = No Max. */
  taxiYearsLimit: number;
  /** Players on taxi now who are past the limit by next season, so they must be activated. */
  taxiAgingOff: string[];
  /** Taxi spots the roster and picks can fill next season without adding a free agent. */
  taxiFillable: number;
  /** Taxi spots left empty after that. */
  taxiShort: number;
  /** The one extra cut for room to bring in a free agent for taxi, when taxi is short and that
   *  spot isn't already open. */
  waiverRoomCut: number;
  /** Roster + picks that have to be cut or traded. */
  mustCut: number;
  /** Lowest value first: mustCut names, then the cushion. */
  danger: DangerPlayer[];
}

export function getRosterCrunch(
  league: Pick<SleeperLeague, "roster_positions" | "settings" | "scoring_settings">,
  roster: Pick<SleeperRoster, "roster_id" | "players" | "reserve" | "taxi">,
  rosters: Pick<SleeperRoster, "roster_id">[],
  tradedPicks: SleeperTradedPick[],
  drafts: SleeperDraft[],
  players: Record<string, SleeperPlayer>,
  /** Injected for tests. */
  seasonYear: string = CURRENT_YEAR
): RosterCrunch {
  const draftSeason = pickSeasonWindow(drafts)[0];
  const rounds = rookieDraftRoundCount(
    drafts.find((d) => String(d.season) === draftSeason),
    league.settings
  );
  const picksByRound = ownedPicksByRound(rosters, tradedPicks, draftSeason, rounds, roster.roster_id);
  const picks = picksByRound.reduce((sum, n) => sum + n, 0);

  const { active, ir, taxi } = getRosterSlotSummary(league, roster, players);
  const allPlayers = roster.players ?? [];
  const taxiSet = new Set(roster.taxi ?? []);
  const reserveSet = new Set(roster.reserve ?? []);

  // Experience in the draft's season. Sleeper moves years_exp up itself between seasons, so this
  // only looks ahead while the draft is still in a later season than the current one.
  const yearsAhead = Math.max(0, Number(draftSeason) - Number(seasonYear));
  const taxiYearsLimit = league.settings?.taxi_years ?? 0;
  const withinLimit = (id: string) =>
    taxiYearsLimit === 0 || (players[id]?.years_exp ?? 0) + yearsAhead <= taxiYearsLimit;

  const taxiAgingOff = (roster.taxi ?? []).filter((id) => !withinLimit(id));
  const taxiStaying = taxi.filled - taxiAgingOff.length;
  const rookiesOnly = league.settings?.taxi_allow_vets !== 1;
  const canMoveDown = rookiesOnly
    ? 0
    : allPlayers.filter((id) => !taxiSet.has(id) && withinLimit(id)).length;

  const taxiFillable = Math.min(taxi.cap, taxiStaying + picks + canMoveDown);
  const taxiShort = taxi.cap - taxiFillable;

  const over = allPlayers.length + picks - active.cap - taxiFillable;
  const mustCut = Math.max(0, over + (taxiShort > 0 ? 1 : 0));
  const waiverRoomCut = taxiShort > 0 && over + 1 > 0 ? 1 : 0;

  const multipliers = league.scoring_settings ? computeScoringMultipliers(league.scoring_settings) : {};
  const valueOf = (id: string) =>
    Math.round((players[id]?.value ?? 0) * (multipliers[players[id]?.position ?? ""] ?? 1));
  const nameOf = (id: string) => players[id]?.full_name ?? id;
  const danger = allPlayers
    .filter((id) => isSkillPosition(players[id]?.position))
    .sort((a, b) => valueOf(a) - valueOf(b) || nameOf(a).localeCompare(nameOf(b)))
    .slice(0, mustCut + DANGER_CUSHION)
    .map((id, index): DangerPlayer => ({
      playerId: id,
      value: valueOf(id),
      cushion: index >= mustCut,
      where: taxiSet.has(id) ? "TAXI" : reserveSet.has(id) ? "IR" : "ACTIVE",
    }));

  return {
    draftSeason, picksByRound, picks,
    active, ir, taxi,
    rookiesOnly, taxiYearsLimit, taxiAgingOff, taxiFillable, taxiShort, waiverRoomCut,
    mustCut, danger,
  };
}

/** False until FantasyCalc values have merged into the player map: before that every player reads
 *  0, and the danger lists would be a roster's alphabetical first names. */
export function playersHaveValues(players: Record<string, SleeperPlayer>): boolean {
  return Object.values(players).some((p) => (p?.value ?? 0) > 0);
}

/** Every league's danger list as sorted player ids, ordered by id rather than value so a value
 *  moving inside the list doesn't change the result. Empty until values have loaded. */
export function getDangerIdsByLeague(
  leagueOverviewData: Record<string, LeagueOverviewEntry>,
  userId: string | null | undefined,
  players: Record<string, SleeperPlayer>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!userId || !playersHaveValues(players)) return out;
  for (const [leagueId, entry] of Object.entries(leagueOverviewData)) {
    const roster = entry.rosters.find((r) => r.owner_id === userId);
    if (!roster || !entry.tradedPicks || !entry.drafts) continue;
    const { danger } = getRosterCrunch(entry.league, roster, entry.rosters, entry.tradedPicks, entry.drafts, players);
    out[leagueId] = danger.map((d) => d.playerId).sort();
  }
  return out;
}

/** The tag map with DANGER over every danger-listed player who is untagged, Core or Pricey, which
 *  puts him back in the Trade Finder's pool at no penalty. Shopping and Offload stay: they already
 *  say to sell him, and Offload scores higher. Derived on every read, never stored, so the
 *  player's real tag is back as soon as his value lifts him off the list (user, 11/03). Returns
 *  `tags` itself when nothing changes. */
export function withDangerTags(
  tags: LeagueAssetDispositions,
  dangerIdsByLeague: Record<string, string[]>
): LeagueAssetDispositions {
  let out: LeagueAssetDispositions | null = null;
  for (const [leagueId, ids] of Object.entries(dangerIdsByLeague)) {
    for (const id of ids) {
      const tag = normalizeDisposition(tags[leagueId]?.[id]);
      if (tag === "SHOPPING" || tag === "OFFLOAD") continue;
      out ??= { ...tags };
      if (out[leagueId] === tags[leagueId]) out[leagueId] = { ...tags[leagueId] };
      out[leagueId][id] = "DANGER";
    }
  }
  return out ?? tags;
}
