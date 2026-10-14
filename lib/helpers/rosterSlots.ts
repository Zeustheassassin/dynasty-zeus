// ============================================================
// One roster's Active / IR / Taxi use and its IR flags. Shared by Roster
// Overview (League Hub) and the To-Do hub so the counts and the to-do items
// can never disagree.
//
// IR eligibility reads Sleeper's own designation (the raw players map, never
// the ESPN-overlaid gameday map) through isReserveEligible, gated by the
// league's reserve_allow_* settings — the same rule as the Injury Report.
// ============================================================
import { isReserveEligible } from "../../components/AlertsPage/alertsPageHelpers";
import type { SleeperLeague, SleeperPlayer, SleeperRoster } from "../types";

export interface SlotFill {
  filled: number;
  cap: number;
}

export interface RosterSlotSummary {
  /** Starters + bench: roster.players less IR and taxi, against the league's roster spots. */
  active: SlotFill;
  ir: SlotFill;
  taxi: SlotFill;
  /** IR-eligible players still on the active roster. Empty while IR is full (0 of 0 counts as
   *  full) — they can't be moved there. */
  irEligibleIds: string[];
  /** Players in IR slots whose Sleeper designation no longer qualifies them. */
  staleIrIds: string[];
}

export function getRosterSlotSummary(
  league: Pick<SleeperLeague, "roster_positions" | "settings">,
  roster: Pick<SleeperRoster, "players" | "reserve" | "taxi">,
  players: Record<string, SleeperPlayer> | null | undefined
): RosterSlotSummary {
  // Sleeper's roster.players is the full union — actives + IR + taxi — so subtract IR and taxi
  // to get the starters/bench count.
  const reserve = roster.reserve ?? [];
  const taxi = roster.taxi ?? [];
  const reserveSet = new Set(reserve);
  const taxiSet = new Set(taxi);
  const allPlayers = roster.players ?? [];
  const irCap = league.settings?.reserve_slots ?? 0;

  // Only IR-eligible players who AREN'T already on IR — those are the ones the user could still
  // claim into a reserve slot. Taxi players generally can't be IR'd, so they're excluded too, and
  // nothing counts once the reserve slots are full.
  const reserveFull = reserve.length >= irCap;
  const irEligibleIds = allPlayers.filter((pid) => {
    if (reserveSet.has(pid) || taxiSet.has(pid) || reserveFull) return false;
    const playerData = players?.[pid];
    return !!playerData && isReserveEligible(playerData, league.settings);
  });

  // Players sitting in reserve slots whose current status no longer qualifies them for IR (e.g.
  // activated off injury, tag cleared) — they need to move back to the active roster or be dropped.
  const staleIrIds = reserve.filter((pid) => {
    const playerData = players?.[pid];
    return !!playerData && !isReserveEligible(playerData, league.settings);
  });

  return {
    active: {
      filled: allPlayers.filter((pid) => !reserveSet.has(pid) && !taxiSet.has(pid)).length,
      cap: (league.roster_positions ?? []).length,
    },
    ir: { filled: reserve.length, cap: irCap },
    taxi: { filled: taxi.length, cap: league.settings?.taxi_slots ?? 0 },
    irEligibleIds,
    staleIrIds,
  };
}
