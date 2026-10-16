// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import RosterOverviewTab from "@/components/LeagueHub/RosterOverviewTab";
import { PlayersProvider } from "@/lib/PlayersContext";
import type {
  LeagueOverviewEntry,
  SleeperLeague,
  SleeperLeagueSettings,
  SleeperPlayer,
  SleeperRoster,
  TeamGameState,
} from "@/lib/types";

// Pins Roster Overview's IR-Eligible / IR Stale counts — who Sleeper will let the user put on
// (or must take off) each league's IR. Both columns run isReserveEligible over Sleeper's own
// player designations (the raw PlayersContext map, never the ESPN-overlaid gameday map) gated
// by each league's reserve_allow_* settings. Written before the Sleeper call-budget Stage 1
// changes (10/10) so the refresh/caching work can't move these numbers.

// This project doesn't set `test.globals: true`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

const ME = "me";

function p(id: string, injury_status: string | null, status = "Active"): SleeperPlayer {
  return { player_id: id, full_name: `Player ${id}`, position: "RB", team: "KC", injury_status, status } as SleeperPlayer;
}

const PLAYERS: Record<string, SleeperPlayer> = {
  ir: p("ir", "IR"),
  pup: p("pup", "PUP"),
  out: p("out", "Out"),
  doubtful: p("doubtful", "Doubtful"),
  questionable: p("questionable", "Questionable"),
  sus: p("sus", "Sus"),
  na: p("na", "NA"),
  healthy: p("healthy", null),
  healthy2: p("healthy2", null),
  irTaxi: p("irTaxi", "IR"),
  irReserve: p("irReserve", "IR"),
  outReserve: p("outReserve", "Out"),
  // Not in the map at all: "ghost".
};

function settings(extra: Partial<SleeperLeagueSettings>): SleeperLeagueSettings {
  return { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, taxi_slots: 3, ...extra } as SleeperLeagueSettings;
}

function league(id: string, name: string, s: SleeperLeagueSettings): SleeperLeague {
  return {
    league_id: id, name, season: "2026", season_type: "regular", status: "in_season", sport: "nfl",
    total_rosters: 12, roster_positions: ["QB", "RB", "WR", "BN"], settings: s, scoring_settings: {},
    avatar: null, draft_id: null, previous_league_id: null,
  } as SleeperLeague;
}

function roster(owner: string, players: string[], reserve: string[] = [], taxi: string[] = []): SleeperRoster {
  return {
    roster_id: owner === ME ? 1 : 2, owner_id: owner, league_id: "x", players, starters: [],
    reserve, taxi, co_owners: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
  } as SleeperRoster;
}

function entry(l: SleeperLeague, rosters: SleeperRoster[]): LeagueOverviewEntry {
  return { league: l, rosters, picks: [], userMap: {} };
}

// Every league shares this active roster: ir, pup, out, doubtful, sus and na are each IR-eligible
// somewhere; questionable and healthy2 never are; "ghost" isn't in the player map at all.
const ACTIVE = ["ir", "pup", "out", "doubtful", "questionable", "sus", "na", "healthy2", "ghost"];

// A: soft statuses all allowed, one open IR slot of two (IR holds "healthy").
//    IR-Eligible: ir, pup, out, doubtful, sus, na + "irReserve" (IR-tagged, on the active roster
//    here) = 7. The IR-tagged taxi player never counts. IR Stale: "healthy" = 1.
const A = league("A", "Alpha", settings({
  reserve_slots: 2, reserve_allow_out: 1, reserve_allow_doubtful: 1, reserve_allow_sus: 1, reserve_allow_na: 1,
}));
// B: no soft statuses allowed — only IR/PUP qualify, so "outReserve" sitting on IR is stale.
//    IR-Eligible: ir, pup = 2. IR Stale: outReserve = 1.
const B = league("B", "Bravo", settings({ reserve_slots: 3 }));
// C: IR already full — nothing more can be claimed, even an IR-tagged player.
//    IR-Eligible: — . IR Stale: "healthy" = 1 ("irReserve" still qualifies).
const C = league("C", "Charlie", settings({ reserve_slots: 2, reserve_allow_out: 1 }));
// D: no IR slots at all. IR-Eligible: — (0 of 0 counts as full). IR Stale: — .
const D = league("D", "Delta", settings({ reserve_slots: 0, reserve_allow_out: 1 }));
// E: I have no roster here — no row.
const E = league("E", "Echo", settings({ reserve_slots: 2 }));

const OVERVIEW: Record<string, LeagueOverviewEntry> = {
  A: entry(A, [
    roster(ME, [...ACTIVE, "irReserve", "irTaxi", "healthy"], ["healthy"], ["irTaxi"]),
    roster("other", ["out"]),
  ]),
  B: entry(B, [roster(ME, [...ACTIVE, "outReserve"], ["outReserve"])]),
  C: entry(C, [roster(ME, [...ACTIVE, "irReserve", "healthy"], ["irReserve", "healthy"])]),
  D: entry(D, [roster(ME, ACTIVE)]),
  E: entry(E, [roster("other", ACTIVE)]),
};
const EXPECTED: Record<string, { eligible: string; stale: string }> = {
  Alpha: { eligible: "7", stale: "1" },
  Bravo: { eligible: "2", stale: "1" },
  Charlie: { eligible: "—", stale: "1" },
  Delta: { eligible: "—", stale: "—" },
};

function renderTab(
  players: Record<string, SleeperPlayer> = PLAYERS,
  props: {
    onRefresh?: () => Promise<void>;
    loadLeagueOverview?: () => Promise<void>;
    refreshing?: boolean;
    scheduleByTeam?: Record<string, TeamGameState>;
  } = {}
) {
  return render(
    <PlayersProvider players={players}>
      <RosterOverviewTab
        leagues={[A, B, C, D, E]}
        user={{ user_id: ME, username: "me", display_name: "Me", avatar: null } as never}
        leagueOverviewData={OVERVIEW}
        loadingLeagueOverview={false}
        leagueOverviewLoaded={true}
        leagueOverviewUpdatedAt={Date.now()}
        loadLeagueOverview={props.loadLeagueOverview ?? vi.fn(async () => {})}
        onRefresh={props.onRefresh ?? vi.fn(async () => {})}
        refreshing={props.refreshing ?? false}
        loadRoster={vi.fn()}
        setLeagueHubTab={vi.fn()}
        personalOrdering={[]}
        scheduleByTeam={props.scheduleByTeam ?? {}}
      />
    </PlayersProvider>
  );
}

// Columns: League, Active, IR, Taxi, IR-Eligible, IR Stale, Top FAs.
function cellsFor(leagueName: string): string[] {
  const row = screen.getByText(leagueName).parentElement!;
  return Array.from(row.children).map((c) => c.textContent ?? "");
}

describe("RosterOverviewTab — IR-Eligible / IR Stale counts", () => {
  it("counts each league with its own reserve_allow_* settings and open IR slots", () => {
    renderTab();
    for (const [name, want] of Object.entries(EXPECTED)) {
      const cells = cellsFor(name);
      expect({ name, eligible: cells[4], stale: cells[5] }).toEqual({ name, ...want });
    }
  });

  it("lists only leagues where I have a roster", () => {
    renderTab();
    expect(screen.queryByText("Echo")).toBeNull();
    expect(Object.keys(EXPECTED).map((n) => !!screen.getByText(n))).toEqual([true, true, true, true]);
  });

  it("shows IR utilization alongside the flags", () => {
    renderTab();
    expect(cellsFor("Alpha")[2]).toBe("1 / 2");
    expect(cellsFor("Charlie")[2]).toBe("2 / 2");
    expect(cellsFor("Delta")[2]).toBe("—");
  });

  it("reads Sleeper's designation from the players map — a cleared tag flips IR-Eligible to IR Stale", () => {
    // Same rosters, but Sleeper has since cleared "irReserve"'s IR tag: in Charlie (on IR) it's now
    // a second stale player, and in Alpha (on the active roster) it stops counting as eligible.
    renderTab({ ...PLAYERS, irReserve: p("irReserve", null) });
    expect(cellsFor("Charlie")[5]).toBe("2");
    expect(cellsFor("Alpha")[4]).toBe("6");
  });

  // User 10/15: once a player's game has kicked off Sleeper locks him for the week — the IR window
  // was missed, so he isn't IR-eligible anywhere until the week turns over.
  // User 10/16: Sleeper locks moving him OFF IR too — a stale player stays counted but is marked.
  it("leaves out players whose game this week has kicked off; a stale one stays, marked locked", () => {
    const game = (state: TeamGameState["state"]) => ({ KC: { kickoffAt: Date.parse("2026-10-18T17:00:00Z"), state } });
    for (const state of ["Live", "Final"] as const) {
      cleanup();
      renderTab(PLAYERS, { scheduleByTeam: game(state) });
      expect(cellsFor("Alpha")[4]).toBe("—");
      expect(cellsFor("Bravo")[4]).toBe("—");
      expect(cellsFor("Alpha")[5]).toBe("1 · 1 locked");
      expect(cellsFor("Bravo")[5]).toBe("1 · 1 locked");
    }
    cleanup();
    renderTab(PLAYERS, { scheduleByTeam: game("Upcoming") });
    expect(cellsFor("Alpha")[4]).toBe("7");
    expect(cellsFor("Alpha")[5]).toBe("1");
  });

  it("marks only the stale players whose own game started", () => {
    // Charlie's IR: "healthy" (stale, KC) and "irReserve" (still eligible). Move "healthy" to BUF,
    // still to play: nothing locked. Add a second stale KC player: 2, 1 of them locked.
    const schedule = {
      KC: { kickoffAt: Date.parse("2026-10-18T17:00:00Z"), state: "Live" as const },
      BUF: { kickoffAt: Date.parse("2026-10-18T20:25:00Z"), state: "Upcoming" as const },
    };
    renderTab({ ...PLAYERS, healthy: { ...PLAYERS.healthy, team: "BUF" } }, { scheduleByTeam: schedule });
    expect(cellsFor("Charlie")[5]).toBe("1");
    cleanup();
    renderTab({ ...PLAYERS, healthy: { ...PLAYERS.healthy, team: "BUF" }, irReserve: p("irReserve", null) }, { scheduleByTeam: schedule });
    expect(cellsFor("Charlie")[5]).toBe("2 · 1 locked");
  });

  it("only locks the players on the team whose game started", () => {
    // "out" moves to BUF, still to play; everyone else is KC, already kicked off.
    renderTab(
      { ...PLAYERS, out: { ...PLAYERS.out, team: "BUF" } },
      { scheduleByTeam: {
        KC: { kickoffAt: Date.parse("2026-10-18T17:00:00Z"), state: "Live" },
        BUF: { kickoffAt: Date.parse("2026-10-18T20:25:00Z"), state: "Upcoming" },
      } }
    );
    expect(cellsFor("Alpha")[4]).toBe("1");
  });

  it("uses status when injury_status is empty (Sleeper puts some designations there)", () => {
    renderTab({ ...PLAYERS, healthy: p("healthy", null, "Injured Reserve") });
    // "healthy" (on IR in Alpha and Charlie) now qualifies via status, so neither is stale.
    expect(cellsFor("Alpha")[5]).toBe("—");
    expect(cellsFor("Charlie")[5]).toBe("—");
  });
});

describe("RosterOverviewTab — Refresh", () => {
  // Stage 1 (10/10): Refresh used to call the plain cached overview load, so the IR columns could
  // sit on 10-min-old rosters and a day-old player map. It now calls onRefresh, which useAppState
  // wires to rosters past every cache + /api/players?fresh=1 (covered in rosterRefresh.test.ts).
  it("calls onRefresh, not the cached overview load", () => {
    const onRefresh = vi.fn(async () => {});
    const loadLeagueOverview = vi.fn(async () => {});
    renderTab(PLAYERS, { onRefresh, loadLeagueOverview });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(loadLeagueOverview).not.toHaveBeenCalled();
  });

  it("is disabled and labelled while a refresh runs", () => {
    renderTab(PLAYERS, { refreshing: true });
    const button = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
