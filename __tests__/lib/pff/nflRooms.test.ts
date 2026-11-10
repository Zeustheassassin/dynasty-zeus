// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { PffError, type PffClient } from "@/lib/pff/client";
import { loadNflRooms } from "@/lib/pff/nflRooms";

/** A fake PFF client answering by path; a function answer can throw. */
function fakeClient(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: { path: string; params: Record<string, unknown> }[] = [];
  const client: PffClient = {
    get: vi.fn(async (path: string, params?: Record<string, unknown>) => {
      calls.push({ path, params: params ?? {} });
      const a = answers[path];
      if (!a) throw new PffError("not found", 404, "not_found");
      return a(params ?? {});
    }) as PffClient["get"],
  };
  return { client, calls };
}

const base = {
  "/v2/nfl/teams": () => ({ rows: [{ franchiseId: 24, name: "Philadelphia Eagles" }, { franchiseId: 16, name: "Kansas City Chiefs" }] }),
  "/v2/nfl/teams/stats": () => ({ rows: [{ teamId: 24, name: "Philadelphia Eagles", isPassOe: 0.04 }] }),
  "/v1/facet/offense/summary": () => ({ offense_summary: [{ player_id: 1, franchise_id: 24, position: "WR", grades_offense: 80, snap_counts_total: 900 }] }),
};

describe("loadNflRooms", () => {
  it("reads the prior season's tables and each team's chart for the draft year", async () => {
    const { client, calls } = fakeClient({
      ...base,
      "/v2/nfl/teams/24/roster": () => ({ rows: [{ playerId: 1, name: "Wide One", position: "WR", depthOrder: 1, eligibilityYear: 2022 }] }),
      "/v2/nfl/teams/16/roster": () => ({ rows: [] }),
    });
    const r = await loadNflRooms(client, 2027, new Date("2027-05-01T00:00:00Z"));
    expect(r).toMatchObject({ year: 2027, season: 2026, asOf: "2027-05-01T00:00:00.000Z", missing: [] });
    expect(r.teams[0].players[0]).toMatchObject({ name: "Wide One", grade: 80, share: 1 });
    expect(calls.find((c) => c.path === "/v2/nfl/teams")!.params).toEqual({ season: 2026 });
    expect(calls.find((c) => c.path === "/v2/nfl/teams/stats")!.params).toEqual({ season: 2026, category: "offense-passing", weekGroup: "REG" });
    expect(calls.find((c) => c.path === "/v1/facet/offense/summary")!.params).toEqual({ league: "nfl", season: 2026 });
    expect(calls.find((c) => c.path === "/v2/nfl/teams/24/roster")!.params).toEqual({ season: 2027 });
  });

  it("falls back to the prior season's chart when the draft year's isn't there, and lists a team it can't read", async () => {
    const { client } = fakeClient({
      ...base,
      "/v2/nfl/teams/24/roster": (p) => {
        if (p.season === 2027) throw new PffError("no such season", 404, "not_found");
        return { rows: [{ playerId: 1, name: "Wide One", position: "WR", depthOrder: 1 }] };
      },
      "/v2/nfl/teams/16/roster": () => { throw new PffError("boom", 500); },
    });
    const r = await loadNflRooms(client, 2027);
    expect(r.teams.map((t) => t.name)).toEqual(["Philadelphia Eagles"]);
    expect(r.missing).toEqual(["Kansas City Chiefs"]);
  });

  it("stops on a spent read budget, and when the season has no grades", async () => {
    const spent = fakeClient({ ...base, "/v2/nfl/teams/24/roster": () => { throw new PffError("rate limited", 429, "rate_limited"); } });
    await expect(loadNflRooms(spent.client, 2027)).rejects.toMatchObject({ status: 429 });
    const empty = fakeClient({ ...base, "/v1/facet/offense/summary": () => ({ offense_summary: [] }) });
    await expect(loadNflRooms(empty.client, 2027)).rejects.toThrow(/no 2026 NFL grades/);
  });
});
