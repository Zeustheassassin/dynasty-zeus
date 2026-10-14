import { describe, it, expect } from "vitest";
import { buildLeagueLineupStatus, type LeagueLineupStatusInput } from "@/lib/helpers/lineupStatus";
import { computeSuggestedLineup, type SuggestedLineupInput } from "@/lib/helpers/lineup";
import { INACTIVES_LEAD_MS } from "@/lib/helpers/lineupAvailability";
import type { SleeperPlayer } from "@/lib/types";

// The per-league lineup status behind the League Overview dot and the To-Do hub's lineup items
// (extracted from useAppState's leagueLineupStatus 10/14). It must stay one Lineup Coach run:
// swapCount / delta are exactly computeSuggestedLineup's, and the To-Do lists ride along.

const mk = (id: string, position: string, injury: string | null = null): SleeperPlayer =>
  ({ player_id: id, full_name: `Player ${id}`, position, team: "T", injury_status: injury } as SleeperPlayer);

// Week of Thu 2026-10-15 (US Eastern, UTC-4): TNF 8:15 PM ET, Sunday 1 PM ET and SNF 8:20 PM ET.
const THU = Date.parse("2026-10-16T00:15:00Z");
const SUN_EARLY = Date.parse("2026-10-18T17:00:00Z");
const SUN_LATE = Date.parse("2026-10-19T00:20:00Z");
const NOW = Date.parse("2026-10-15T12:00:00Z");

function input(
  players: Record<string, SleeperPlayer>,
  lineup: Partial<SuggestedLineupInput> & Pick<SuggestedLineupInput, "rosterPositions" | "starters" | "playerIds">,
  opts: {
    scores: Record<string, number>;
    kickoffs?: Record<string, number>;
    risky?: string[];
    asOf?: number | null;
  }
): LeagueLineupStatusInput {
  const kickoffs = opts.kickoffs ?? {};
  return {
    lineup: {
      players,
      scoreFn: (id) => opts.scores[id] ?? 0,
      hasKickoffData: false,
      isLockedFn: () => false,
      ...lineup,
    },
    upcomingKickoffFn: (id) => (kickoffs[id] != null && kickoffs[id] > NOW ? kickoffs[id] : null),
    scheduledKickoffFn: (id) => kickoffs[id] ?? null,
    isRiskFn: (id) => (opts.risky ?? []).includes(id),
    isUnavailableFn: (id) => !!players[id]?.injury_status && /out|doubtful|ir/i.test(players[id].injury_status ?? ""),
    asOf: opts.asOf ?? null,
  };
}

describe("buildLeagueLineupStatus — swaps", () => {
  const players = {
    rbOut: mk("rbOut", "RB", "Out"),
    rbThu: mk("rbThu", "RB"),
    wrSun: mk("wrSun", "WR"),
  };
  const statusInput = input(
    players,
    { rosterPositions: ["RB", "FLEX"], starters: ["rbOut", "wrSun"], playerIds: ["rbOut", "rbThu", "wrSun"] },
    { scores: { rbOut: 14, rbThu: 10, wrSun: 12 }, kickoffs: { rbOut: SUN_EARLY, rbThu: THU, wrSun: SUN_EARLY }, asOf: 123 }
  );

  it("lists each suggested swap with the first kickoff that locks it", () => {
    const status = buildLeagueLineupStatus(statusInput, NOW);
    expect(status.swaps).toEqual([{ slot: "RB", inId: "rbThu", outId: "rbOut", delta: 10, lockAt: THU }]);
    expect(status.asOf).toBe(123);
  });

  it("keeps the dot's numbers exactly the Lineup Coach's", () => {
    const status = buildLeagueLineupStatus(statusInput, NOW);
    const coach = computeSuggestedLineup(statusInput.lineup, NOW);
    expect(status.swapCount).toBe(coach.swaps.length);
    expect(status.isOptimal).toBe(false);
    expect(status.delta).toBe(coach.suggestedLineupScore - coach.currentLineupScore);
  });

  it("prices the Thursday game's share of the change (T flag)", () => {
    const status = buildLeagueLineupStatus(statusInput, NOW);
    // Only the Thursday-game player is named; rbOut plays Sunday.
    expect(status.earlyLocks).toEqual([{ day: "Thu", stake: 10, moves: ["Player rbThu"] }]);
  });

  it("is optimal with nothing to list once the lineup matches", () => {
    const status = buildLeagueLineupStatus({
      ...statusInput,
      lineup: { ...statusInput.lineup, starters: ["rbThu", "wrSun"] },
    }, NOW);
    expect(status).toMatchObject({ isOptimal: true, swapCount: 0, swaps: [], earlyLocks: [], emptySlots: [] });
  });
});

describe("buildLeagueLineupStatus — slots only a pickup can fill", () => {
  const players = {
    qbBye: mk("qbBye", "QB"),
    rbOut: mk("rbOut", "RB", "Out"),
    wrMarked: mk("wrMarked", "WR"),
    teLive: mk("teLive", "TE", "Out"),
  };

  it("flags a slot left with a bye, an out player, a marked-out player or no one; skips started games", () => {
    const status = buildLeagueLineupStatus(input(
      players,
      {
        rosterPositions: ["QB", "RB", "WR", "TE", "K"],
        starters: ["qbBye", "rbOut", "wrMarked", "teLive", "0"],
        playerIds: ["qbBye", "rbOut", "wrMarked", "teLive"],
        isByeFn: (id) => id === "qbBye",
        isExcludedFn: (id) => id === "wrMarked",
        // teLive's game has kicked off — past fixing.
        isLockedFn: (id) => id === "teLive",
      },
      { scores: { qbBye: 18, rbOut: 12, wrMarked: 9, teLive: 3 } }
    ), NOW);
    expect(status.emptySlots).toEqual([
      { slot: "QB", playerId: "qbBye", reason: "bye" },
      { slot: "RB", playerId: "rbOut", reason: "out" },
      { slot: "WR", playerId: "wrMarked", reason: "out" },
      { slot: "K", playerId: null, reason: "none" },
    ]);
  });

  it("doesn't flag a slot a healthy bench player can take (that's a swap)", () => {
    const status = buildLeagueLineupStatus(input(
      { ...players, rb2: mk("rb2", "RB") },
      { rosterPositions: ["RB"], starters: ["rbOut"], playerIds: ["rbOut", "rb2"] },
      { scores: { rbOut: 12, rb2: 6 } }
    ), NOW);
    expect(status.emptySlots).toEqual([]);
    expect(status.swaps.map((s) => s.inId)).toEqual(["rb2"]);
  });
});

describe("buildLeagueLineupStatus — late-game risks with no backup", () => {
  const players = {
    wrQ: mk("wrQ", "WR", "Questionable"),
    wrEarly: mk("wrEarly", "WR"),
    wrLate: mk("wrLate", "WR"),
  };
  const kickoffs = { wrQ: SUN_LATE, wrEarly: SUN_EARLY, wrLate: SUN_LATE };

  it("lists the risky starter with his inactive call and the last earlier-game swap", () => {
    const status = buildLeagueLineupStatus(input(
      players,
      { rosterPositions: ["WR"], starters: ["wrQ"], playerIds: ["wrQ", "wrEarly"] },
      { scores: { wrQ: 15, wrEarly: 8 }, kickoffs, risky: ["wrQ"] }
    ), NOW);
    expect(status.pivotRiskCount).toBe(1);
    expect(status.pivotRisks).toEqual([
      { slot: "WR", playerId: "wrQ", kickoffAt: SUN_LATE, decisionAt: SUN_LATE - INACTIVES_LEAD_MS, swapBy: SUN_EARLY },
    ]);
  });

  it("leaves him off when a later-game bench player can still go in", () => {
    const status = buildLeagueLineupStatus(input(
      players,
      { rosterPositions: ["WR"], starters: ["wrQ"], playerIds: ["wrQ", "wrEarly", "wrLate"] },
      { scores: { wrQ: 15, wrEarly: 8, wrLate: 6 }, kickoffs, risky: ["wrQ"] }
    ), NOW);
    expect(status.pivotRiskCount).toBe(0);
    expect(status.pivotRisks).toEqual([]);
  });
});
