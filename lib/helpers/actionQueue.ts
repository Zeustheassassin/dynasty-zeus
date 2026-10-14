// ============================================================
// To-Do hub action list: every move the user's leagues need made in Sleeper,
// one item per move, built only from data the app already holds (no Sleeper
// calls of its own):
//   - lineup kinds from each league's LeagueLineupStatus — the Lineup Coach run
//     behind the League Overview dot, never a second calculation;
//   - roster kinds from getRosterSlotSummary — Roster Overview's counts over
//     Sleeper's raw player map (never the ESPN-overlaid one).
// Pure: useAppState builds the list, the To-Do hub renders it. Done marks live
// in localStorage (app/hooks/useTodoDone.ts); getActionState reads them.
// getAttentionLeagues / getStepIndex drive stepping through the leagues with a
// move left (app/hooks/useLeagueStepper.ts) in the hub's own By league order.
// ============================================================
import { getRosterSlotSummary } from "./rosterSlots";
import { LINEUP_DELTA_FLOOR } from "./lineup";
import { getEarlyLockDay } from "./gameday";
import type {
  EarlyLockDay,
  LeagueLineupStatus,
  LeagueOverviewEntry,
  SleeperLeague,
  SleeperPlayer,
} from "../types";

export type ActionKind = "lineup" | "pivotRisk" | "emptySlot" | "overLimit" | "irStale" | "irEligible";

/** The League Hub tab "Open in app" lands on. */
export type ActionAppTab = "STARTERS" | "ROSTERS";

export interface ActionItem {
  /** Stable for the same move all week — Done marks are stored against it. */
  key: string;
  kind: ActionKind;
  leagueId: string;
  leagueName: string;
  /** The players the move is about; By player lists the item under each. Empty for a
   *  league-wide item (over the roster limit). */
  playerIds: string[];
  title: string;
  detail: string;
  /** When it has to be done by (ms), or null when there's no clock on it. */
  deadline: number | null;
  /** How to read the deadline: "Locks" (a lineup change), "Swap by" (the last earlier-game
   *  backup's kickoff) or "Inactives" (the inactive call, when no bench player is left). */
  deadlineLabel: "Locks" | "Swap by" | "Inactives" | null;
  /** Past this the move can't be made (a lineup change's kickoff) or stops mattering (the
   *  inactive call) — the hub drops it. Null = it stays until the data changes. */
  expiresAt: number | null;
  /** Thursday / Friday / Saturday — a lineup change the League Overview's T/F/S flags price
   *  at LINEUP_DELTA_FLOOR or more, locking at that day's kickoff. */
  earlyLockDay: EarlyLockDay | null;
  appTab: ActionAppTab;
  /** Earliest moment in Sleeper the data behind the item can reflect; a Done mark is re-checked
   *  only against data newer than the click. */
  asOf: number | null;
}

export interface ActionQueueInput {
  leagues: SleeperLeague[];
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  /** useAppState's leagueLineupStatus — empty in the offseason, so only roster kinds remain. */
  lineupStatus: Record<string, LeagueLineupStatus | null>;
  /** Sleeper user id — whose roster in each league. */
  userId: string;
  /** Sleeper's raw player map: names, and IR eligibility for the roster kinds. */
  players: Record<string, SleeperPlayer>;
  /** The map the Lineup Coach ran on (ESPN's fresher statuses applied) — status words on the
   *  lineup kinds, so they match why the coach flagged them. Defaults to `players`. */
  lineupPlayers?: Record<string, SleeperPlayer>;
}

export const LINEUP_KINDS: readonly ActionKind[] = ["lineup", "pivotRisk", "emptySlot"];

const KIND_ORDER: Record<ActionKind, number> = {
  lineup: 0, pivotRisk: 1, emptySlot: 2, overLimit: 3, irStale: 4, irEligible: 5,
};

/** A league in Sleeper — opens the league on the web and in the phone app (user-verified 10/14).
 *  Sleeper's public API is read-only, so every To-Do move ends here. */
export const sleeperLeagueUrl = (leagueId: string) => `https://sleeper.com/leagues/${encodeURIComponent(leagueId)}`;

const slotLabel = (slot: string) => (slot === "SUPER_FLEX" ? "SFLEX" : slot);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every open move across the user's leagues, most urgent first within each league (see
 *  compareActionItems); group with groupActionsByLeague / groupActionsByPlayer. */
export function buildActionQueue(input: ActionQueueInput): ActionItem[] {
  const { leagues, leagueOverviewData, lineupStatus, userId, players } = input;
  const lineupPlayers = input.lineupPlayers ?? players;
  const name = (id: string | null) => {
    if (!id) return "—";
    const p = players[id] ?? lineupPlayers[id];
    return p?.full_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || id;
  };
  const statusOf = (map: Record<string, SleeperPlayer>, id: string) =>
    map[id]?.injury_status || map[id]?.status || "";

  const items: ActionItem[] = [];
  for (const league of leagues) {
    const leagueId = league.league_id;
    const leagueName = league.name;
    const base = { leagueId, leagueName };

    // ── Lineup kinds: straight off the Lineup Coach's status for this league ──
    const status = lineupStatus[leagueId];
    if (status) {
      // Below the dot's floor the dot is green — same rule here, so a 0.2-point FLEX tweak
      // doesn't sit on the list.
      if (status.delta >= LINEUP_DELTA_FLOOR) {
        const flaggedDays = new Set(
          status.earlyLocks.filter((e) => e.stake >= LINEUP_DELTA_FLOOR).map((e) => e.day)
        );
        for (const swap of status.swaps) {
          const day = swap.lockAt != null ? getEarlyLockDay(swap.lockAt) : null;
          items.push({
            ...base,
            key: `lineup:${leagueId}:${swap.inId}:${swap.outId ?? "empty"}`,
            kind: "lineup",
            playerIds: swap.outId ? [swap.inId, swap.outId] : [swap.inId],
            title: swap.outId ? `Start ${name(swap.inId)} over ${name(swap.outId)}` : `Start ${name(swap.inId)}`,
            detail: `${slotLabel(swap.slot)} · +${swap.delta.toFixed(1)} pts`,
            deadline: swap.lockAt,
            deadlineLabel: swap.lockAt != null ? "Locks" : null,
            expiresAt: swap.lockAt,
            earlyLockDay: day && flaggedDays.has(day) ? day : null,
            appTab: "STARTERS",
            asOf: status.asOf,
          });
        }
      }
      for (const risk of status.pivotRisks) {
        const word = statusOf(lineupPlayers, risk.playerId) || "Risky";
        items.push({
          ...base,
          key: `pivotRisk:${leagueId}:${risk.playerId}`,
          kind: "pivotRisk",
          playerIds: [risk.playerId],
          title: `${name(risk.playerId)} could sit with no backup`,
          detail: risk.swapBy != null
            ? `${slotLabel(risk.slot)} · ${word} · start an earlier-game player instead, or add a backup who plays later`
            : `${slotLabel(risk.slot)} · ${word} · every bench option plays before inactives — add a backup who plays later`,
          deadline: risk.swapBy ?? risk.decisionAt,
          deadlineLabel: risk.swapBy != null ? "Swap by" : "Inactives",
          expiresAt: risk.decisionAt,
          earlyLockDay: null,
          appTab: "STARTERS",
          asOf: status.asOf,
        });
      }
      const seenSlots = new Map<string, number>();
      for (const empty of status.emptySlots) {
        const slotKey = `${empty.slot}:${empty.playerId ?? "none"}`;
        const n = seenSlots.get(slotKey) ?? 0;
        seenSlots.set(slotKey, n + 1);
        const slot = slotLabel(empty.slot);
        items.push({
          ...base,
          key: `emptySlot:${leagueId}:${slotKey}:${n}`,
          kind: "emptySlot",
          playerIds: empty.playerId ? [empty.playerId] : [],
          title: empty.reason === "none"
            ? `No one to start at ${slot}`
            : empty.reason === "bye"
              ? `${name(empty.playerId)} is on bye at ${slot}`
              : `${name(empty.playerId)} won't play at ${slot}`,
          detail: empty.reason === "none"
            ? "No one on the roster fits this slot — add a player"
            : empty.reason === "bye"
              ? "No one else fits this slot — add a player"
              : `${statusOf(lineupPlayers, empty.playerId ?? "") || "Ruled out"} · no one else fits — add a player`,
          deadline: null,
          deadlineLabel: null,
          expiresAt: null,
          earlyLockDay: null,
          appTab: "STARTERS",
          asOf: status.asOf,
        });
      }
    }

    // ── Roster kinds: Roster Overview's counts, in season and out ─────────────
    const entry = leagueOverviewData[leagueId];
    const myRoster = entry?.rosters.find((r) => r.owner_id === userId);
    if (!entry || !myRoster) continue;
    const slots = getRosterSlotSummary(league, myRoster, players);
    const asOf = entry.rostersAsOf ?? null;
    const rosterBase = {
      ...base, deadline: null, deadlineLabel: null, expiresAt: null, earlyLockDay: null, appTab: "ROSTERS" as const, asOf,
    };

    const over = slots.active.filled - slots.active.cap;
    if (slots.active.cap > 0 && over > 0) {
      items.push({
        ...rosterBase,
        key: `overLimit:${leagueId}`,
        kind: "overLimit",
        playerIds: [],
        title: `Over the roster limit by ${over}`,
        detail: `${slots.active.filled} / ${slots.active.cap} active · drop someone, or move one to IR or taxi`,
      });
    }
    const activeFull = slots.active.cap > 0 && slots.active.filled >= slots.active.cap;
    for (const id of slots.staleIrIds) {
      const word = statusOf(players, id);
      items.push({
        ...rosterBase,
        key: `irStale:${leagueId}:${id}`,
        kind: "irStale",
        playerIds: [id],
        title: `Move ${name(id)} off IR`,
        detail: `Sleeper lists him as ${word || "healthy"}, not IR-eligible here${activeFull ? " · active roster full — drop someone to activate him" : ""}`,
      });
    }
    const openIr = slots.ir.cap - slots.ir.filled;
    for (const id of slots.irEligibleIds) {
      items.push({
        ...rosterBase,
        key: `irEligible:${leagueId}:${id}`,
        kind: "irEligible",
        playerIds: [id],
        title: `Move ${name(id)} to IR`,
        detail: `${statusOf(players, id) || "IR-eligible"} · ${plural(openIr, "open IR slot")}`,
      });
    }
  }
  return items.sort(compareActionItems);
}

/** Earliest deadline first (untimed after), then lineup before roster kinds, then by title. */
export function compareActionItems(a: ActionItem, b: ActionItem): number {
  if (a.deadline !== b.deadline) {
    if (a.deadline == null) return 1;
    if (b.deadline == null) return -1;
    return a.deadline - b.deadline;
  }
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title);
}

// ── Done marks ────────────────────────────────────────────────────────────────

export interface DoneRecord {
  /** When the user marked it done (ms). */
  at: number;
  /** Marked done again after it came back — stays hidden for the rest of the week. */
  final?: boolean;
}

/** open: on the list. done: hidden. stillShowing: marked done, but data fetched after the click
 *  (asOf ≥ the click) still has it — back on the list, flagged. */
export type ActionState = "open" | "done" | "stillShowing";

export function getActionState(item: Pick<ActionItem, "asOf">, record: DoneRecord | undefined): ActionState {
  if (!record) return "open";
  if (record.final) return "done";
  return item.asOf != null && item.asOf >= record.at ? "stillShowing" : "done";
}

export interface VisibleAction {
  item: ActionItem;
  state: ActionState;
}

/** What the hub shows at `now`: `visible` (open or flagged "Still showing") and `hidden` (marked
 *  done). Items past `expiresAt` are in neither — the move can't be made any more. */
export function splitActionsByState(
  items: ActionItem[],
  done: Record<string, DoneRecord>,
  now: number
): { visible: VisibleAction[]; hidden: ActionItem[] } {
  const visible: VisibleAction[] = [];
  const hidden: ActionItem[] = [];
  for (const item of items) {
    if (item.expiresAt != null && now >= item.expiresAt) continue;
    const state = getActionState(item, done[item.key]);
    if (state === "done") hidden.push(item);
    else visible.push({ item, state });
  }
  return { visible, hidden };
}

// ── Views ─────────────────────────────────────────────────────────────────────

export interface LeagueActionGroup {
  league: SleeperLeague;
  items: ActionItem[];
  /** The league's earliest deadline, or null when nothing on it is timed. */
  deadline: number | null;
  /** Where "Open in app" goes: the most urgent item's tab. */
  appTab: ActionAppTab;
}

/** By league: one group per league, earliest deadline first; leagues with only untimed items
 *  after, by name. `items` should already be sorted (buildActionQueue's order). */
export function groupActionsByLeague(items: ActionItem[], leagues: SleeperLeague[]): LeagueActionGroup[] {
  const byLeague = new Map<string, ActionItem[]>();
  for (const item of items) {
    const list = byLeague.get(item.leagueId) ?? [];
    list.push(item);
    byLeague.set(item.leagueId, list);
  }
  const groups: LeagueActionGroup[] = [];
  for (const league of leagues) {
    const list = byLeague.get(league.league_id);
    if (!list?.length) continue;
    const sorted = [...list].sort(compareActionItems);
    groups.push({ league, items: sorted, deadline: sorted[0].deadline, appTab: sorted[0].appTab });
  }
  return groups.sort((a, b) => {
    if (a.deadline !== b.deadline) {
      if (a.deadline == null) return 1;
      if (b.deadline == null) return -1;
      return a.deadline - b.deadline;
    }
    return a.league.name.localeCompare(b.league.name);
  });
}

// ── Stepping through leagues (League Hub bar, [ / ], command palette) ─────────

/** One league to step to and the League Hub tab it opens on. */
export interface LeagueStop {
  leagueId: string;
  appTab: ActionAppTab;
}

/** The leagues needing attention at `now` — every league with a move still on the To-Do list, in
 *  By league order (the same split + grouping the hub renders), each with its Open in app tab. */
export function getAttentionLeagues(
  items: ActionItem[],
  done: Record<string, DoneRecord>,
  leagues: SleeperLeague[],
  now: number
): LeagueStop[] {
  const { visible } = splitActionsByState(items, done, now);
  return groupActionsByLeague(visible.map((v) => v.item), leagues).map((g) => ({
    leagueId: g.league.league_id,
    appTab: g.appTab,
  }));
}

/** A run through the leagues needing attention, fixed when it starts so the order and count don't
 *  shift under the user while projections reload or a roster poll lands. */
export interface LeagueStepSession {
  /** Sleeper user the run belongs to — a different account's run is ignored. */
  userId: string;
  stops: LeagueStop[];
  /** The stop the run last landed on; -1 before the first. */
  cursor: number;
}

/** Index of the stop Prev (-1) / Next (+1) goes to from the selected league: the one before / after
 *  it when it's on the list; off the list, Next goes to the stop after the last one landed on and
 *  Prev back to that stop. Null past either end. */
export function getStepIndex(
  session: Pick<LeagueStepSession, "stops" | "cursor">,
  selectedLeagueId: string | null,
  dir: 1 | -1
): number | null {
  const at = selectedLeagueId ? session.stops.findIndex((s) => s.leagueId === selectedLeagueId) : -1;
  const target = at >= 0 ? at + dir : dir > 0 ? session.cursor + 1 : session.cursor;
  return target >= 0 && target < session.stops.length ? target : null;
}

export interface PlayerActionGroup {
  /** null = league-wide items with no player (over the roster limit). */
  playerId: string | null;
  items: ActionItem[];
  deadline: number | null;
}

/** By player: one group per player an item is about (a swap shows under both players), earliest
 *  deadline first, then most items, then by name; league-wide items last. */
export function groupActionsByPlayer(
  items: ActionItem[],
  players: Record<string, SleeperPlayer>
): PlayerActionGroup[] {
  const byPlayer = new Map<string | null, ActionItem[]>();
  for (const item of items) {
    const ids: (string | null)[] = item.playerIds.length > 0 ? item.playerIds : [null];
    for (const id of ids) {
      const list = byPlayer.get(id) ?? [];
      list.push(item);
      byPlayer.set(id, list);
    }
  }
  const nameOf = (id: string | null) => (id ? players[id]?.full_name ?? id : "");
  return [...byPlayer.entries()]
    .map(([playerId, list]) => {
      const sorted = [...list].sort(compareActionItems);
      return { playerId, items: sorted, deadline: sorted[0].deadline };
    })
    .sort((a, b) => {
      if ((a.playerId == null) !== (b.playerId == null)) return a.playerId == null ? 1 : -1;
      if (a.deadline !== b.deadline) {
        if (a.deadline == null) return 1;
        if (b.deadline == null) return -1;
        return a.deadline - b.deadline;
      }
      return b.items.length - a.items.length || nameOf(a.playerId).localeCompare(nameOf(b.playerId));
    });
}
