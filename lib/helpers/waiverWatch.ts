// ============================================================
// To-Do hub Waiver Watch: per league, the two free agents whose dynasty value
// rose most over the last week next to the user's two lowest-value players, so
// a pickup worth more than the worst player on the roster stands out. Built
// only from data the app already holds (no Sleeper calls):
//   - the 7-day rise from two daily player_value_history snapshots (migration
//     047 — the shared FantasyCalc 2QB value, read by useWeeklyValueRisers);
//   - who's rostered from the League Overview rosters;
//   - current values from players[id].value — the same raw FantasyCalc 2QB
//     number Roster Overview reads, so 1QB leagues read QBs high.
// Pure: the Waiver Watch tab builds and renders it.
// ============================================================
import { isReserveEligible } from "../../components/AlertsPage/alertsPageHelpers";
import { getRosterSlotSummary } from "./rosterSlots";
import { getSleeperLeagueOrder } from "./leagueOrder";
import type { LeagueOverviewEntry, SleeperLeague, SleeperPlayer, SleeperRoster } from "../types";

/** Rising free agents and drop candidates shown per league. */
export const WAIVER_WATCH_COUNT = 2;
/** How far back the rise is measured — the base snapshot is the newest one at least this many
 *  days older than the latest. */
export const WAIVER_RISE_DAYS = 7;

/** Positions FantasyCalc values. K/DEF never go on the drop list (user rule 10/14), and an IDP
 *  player would read as worthless here only because FantasyCalc doesn't price IDP. */
const VALUED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export interface ValueSnapshotRow {
  player_id: string;
  value: number;
}

export interface ValueRiser {
  playerId: string;
  /** Value in the base snapshot (≥ WAIVER_RISE_DAYS older than the latest). */
  from: number;
  /** Value in the latest snapshot. */
  to: number;
  gain: number;
}

/** The ISO date `days` before an ISO date (`YYYY-MM-DD`), in UTC — the snapshot table's dates are
 *  the cron's UTC day. */
export function isoDaysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Every player whose value went up between the two snapshots, biggest raw gain first (ties by
 *  id, so the order is stable). A player missing from the base snapshot is left out: he was below
 *  FantasyCalc's list then, so his starting value — and his gain — is unknown, not zero. */
export function computeValueRisers(latest: ValueSnapshotRow[], base: ValueSnapshotRow[]): ValueRiser[] {
  const baseValue = new Map(base.map((row) => [row.player_id, row.value]));
  const risers: ValueRiser[] = [];
  for (const row of latest) {
    const from = baseValue.get(row.player_id);
    if (from == null) continue;
    const gain = row.value - from;
    if (gain > 0) risers.push({ playerId: row.player_id, from, to: row.value, gain });
  }
  return risers.sort((a, b) => b.gain - a.gain || a.playerId.localeCompare(b.playerId));
}

export interface DropCandidate {
  playerId: string;
  /** players[id].value; 0 = not on FantasyCalc's list at all. */
  value: number;
  /** In an IR slot — on the list only because more IR-eligible players than IR slots. */
  onIr: boolean;
}

/** The roster's lowest-value players, lowest first (ties by name). Leaves out taxi, K/DEF (and
 *  any position FantasyCalc doesn't value) and IR — except: a stale-IR player (Sleeper no longer
 *  lists him as eligible) counts as active, and when the roster's IR-eligible players outnumber
 *  the IR slots the IR players count too, since someone has to give (user rule 10/14:
 *  3 slots + 5 eligible → include IR). Eligibility is Sleeper's own designation via
 *  isReserveEligible, never ESPN's. */
export function getDropCandidates(
  league: Pick<SleeperLeague, "roster_positions" | "settings">,
  roster: Pick<SleeperRoster, "players" | "reserve" | "taxi">,
  players: Record<string, SleeperPlayer>
): DropCandidate[] {
  const slots = getRosterSlotSummary(league, roster, players);
  const reserveSet = new Set(roster.reserve ?? []);
  const taxiSet = new Set(roster.taxi ?? []);
  const staleIr = new Set(slots.staleIrIds);
  const allPlayers = roster.players ?? [];

  // Taxi players can't be IR'd, so they don't count toward the overflow either.
  const eligibleCount = allPlayers.filter((pid) => {
    const p = players[pid];
    return !taxiSet.has(pid) && !!p && isReserveEligible(p, league.settings);
  }).length;
  const irOverflow = eligibleCount > slots.ir.cap;

  const nameOf = (pid: string) => players[pid]?.full_name ?? pid;
  return allPlayers
    .filter((pid) => {
      if (taxiSet.has(pid)) return false;
      if (!VALUED_POSITIONS.has(players[pid]?.position ?? "")) return false;
      return !reserveSet.has(pid) || staleIr.has(pid) || irOverflow;
    })
    .map((pid) => ({
      playerId: pid,
      value: players[pid]?.value ?? 0,
      onIr: reserveSet.has(pid) && !staleIr.has(pid),
    }))
    .sort((a, b) => a.value - b.value || nameOf(a.playerId).localeCompare(nameOf(b.playerId)));
}

export interface WaiverRiser extends ValueRiser {
  /** Current value (players[id].value, else the latest snapshot) — what the drop list is
   *  compared against. */
  value: number;
  /** Worth more than the user's lowest-value player in this league. */
  beatsLowest: boolean;
}

export interface WaiverWatchRow {
  league: SleeperLeague;
  risers: WaiverRiser[];
  lowest: DropCandidate[];
  /** Best rising free agent's value less the lowest player's, when positive — how much of an
   *  upgrade the pickup is. Null when no riser beats the lowest. */
  upgrade: number | null;
}

export interface WaiverWatchInput {
  leagues: SleeperLeague[];
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  userId: string;
  players: Record<string, SleeperPlayer>;
  /** computeValueRisers' list, biggest gain first. */
  risers: ValueRiser[];
}

/** One row per league the user has a roster in, in the user's Sleeper order (the user's call,
 *  10/14; leagues with an upgrade are highlighted in place rather than moved up). */
export function buildWaiverWatch(input: WaiverWatchInput): WaiverWatchRow[] {
  const { leagues, leagueOverviewData, userId, players, risers } = input;
  const rows: WaiverWatchRow[] = [];
  for (const league of leagues) {
    const entry = leagueOverviewData[league.league_id];
    const myRoster = entry?.rosters.find((r) => r.owner_id === userId);
    if (!entry || !myRoster) continue;

    const rostered = new Set<string>();
    for (const r of entry.rosters) {
      for (const pid of [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]) rostered.add(pid);
    }

    const lowest = getDropCandidates(league, myRoster, players).slice(0, WAIVER_WATCH_COUNT);
    const floor = lowest[0]?.value;
    const leagueRisers: WaiverRiser[] = [];
    for (const riser of risers) {
      if (leagueRisers.length >= WAIVER_WATCH_COUNT) break;
      // Rostered anywhere in the league (actives, IR or taxi), or not in Sleeper's map to show.
      if (rostered.has(riser.playerId) || !players[riser.playerId]) continue;
      const value = players[riser.playerId].value ?? riser.to;
      leagueRisers.push({ ...riser, value, beatsLowest: floor != null && value > floor });
    }
    const best = leagueRisers.filter((r) => r.beatsLowest).reduce((max, r) => Math.max(max, r.value), -Infinity);
    rows.push({
      league,
      risers: leagueRisers,
      lowest,
      upgrade: floor != null && best > floor ? best - floor : null,
    });
  }
  const sleeperOrder = getSleeperLeagueOrder(leagues);
  return rows.sort(
    (a, b) => (sleeperOrder.get(a.league.league_id) ?? 0) - (sleeperOrder.get(b.league.league_id) ?? 0)
  );
}
