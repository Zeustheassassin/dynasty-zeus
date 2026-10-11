import { describe, it, expect, vi, beforeEach } from "vitest";
import { LEAGUEMATES_LEAGUE_CONCURRENCY, LEAGUEMATES_OWNER_CONCURRENCY } from "@/lib/constants";
import { CURRENT_YEAR } from "@/lib/helpers";

// Sleeper call-budget Stage 3 (10/10): the Leaguemates tab used to Promise.all one getUserLeagues
// per owner (~450 at 50 leagues) at once — most 429'd and silently showed 0 leagues. Now both
// passes are capped, and the tab gets a progress count.

const h = vi.hoisted(() => ({
  open: { league: 0, owner: 0 },
  maxOpen: { league: 0, owner: 0 },
  failOwners: new Set<string>(),
}));

const tick = () => new Promise((r) => setTimeout(r, 1));
async function track<T>(kind: "league" | "owner", value: () => T): Promise<T> {
  h.open[kind]++;
  h.maxOpen[kind] = Math.max(h.maxOpen[kind], h.open[kind]);
  await tick();
  h.open[kind]--;
  return value();
}

// League L has owners me + o{L}a..o{L}d; owner "shared" is in every league.
const leagueOwners = (leagueId: string) => ["me", "shared", ...["a", "b", "c", "d"].map((s) => `o${leagueId}${s}`)];

vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: {
    getLeagueRosters: vi.fn((leagueId: string) =>
      track("league", () => leagueOwners(leagueId).map((owner_id, i) => ({ roster_id: i + 1, owner_id })))),
    getLeagueUsers: vi.fn((leagueId: string) =>
      track("league", () => leagueOwners(leagueId).map((user_id) => ({ user_id, display_name: `Name ${user_id}` })))),
    getUserLeagues: vi.fn((ownerId: string, year: string) =>
      track("owner", () => {
        if (h.failOwners.has(ownerId)) throw new Error("429");
        expect(year).toBe(CURRENT_YEAR);
        return [{ settings: { best_ball: 0 } }, { settings: { best_ball: 0 } }, { settings: { best_ball: 1 } }];
      })),
  },
}));

import { loadLeagueMateStats } from "@/components/DataHub/leaguemateStats";

const leagues = Array.from({ length: 6 }, (_, i) => ({ league_id: String(i + 1), name: `L${i + 1}` })) as never[];

beforeEach(() => {
  h.open = { league: 0, owner: 0 };
  h.maxOpen = { league: 0, owner: 0 };
  h.failOwners = new Set();
});

describe("loadLeagueMateStats", () => {
  it("caps both passes instead of firing every lookup at once", async () => {
    await loadLeagueMateStats(leagues, "me");
    // Two calls (rosters + users) per league in flight.
    expect(h.maxOpen.league).toBe(LEAGUEMATES_LEAGUE_CONCURRENCY * 2);
    expect(h.maxOpen.owner).toBe(LEAGUEMATES_OWNER_CONCURRENCY);
  });

  it("counts every other owner once, with their leagues and how many they share with me", async () => {
    const stats = await loadLeagueMateStats(leagues, "me");
    expect(stats).toHaveLength(1 + 6 * 4); // "shared" + 4 per league; never me
    expect(stats.find((s) => s.userId === "me")).toBeUndefined();
    expect(stats.find((s) => s.userId === "shared")).toEqual({
      userId: "shared", displayName: "Name shared", totalLeagues: 2, bestBallLeagues: 1, sharedLeagues: 6,
    });
    expect(stats.find((s) => s.userId === "o3b")).toMatchObject({ sharedLeagues: 1, totalLeagues: 2 });
  });

  it("an owner whose lookup fails still shows, with 0 leagues", async () => {
    h.failOwners.add("o2a");
    const stats = await loadLeagueMateStats(leagues, "me");
    expect(stats.find((s) => s.userId === "o2a")).toMatchObject({ totalLeagues: 0, bestBallLeagues: 0, sharedLeagues: 1 });
  });

  it("reports owner progress from 0 to the total", async () => {
    const progress = vi.fn();
    await loadLeagueMateStats(leagues, "me", progress);
    const calls = progress.mock.calls.map(([p]) => p);
    expect(calls[0]).toEqual({ done: 0, total: 25 });
    expect(calls.at(-1)).toEqual({ done: 25, total: 25 });
    expect(calls).toHaveLength(26);
  });
});
