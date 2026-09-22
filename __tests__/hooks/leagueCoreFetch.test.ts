import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SleeperRoster, SleeperUser } from "@/lib/types";

// Sept 22 code-review Tier 4 finding #11: useLeagueOverview.ts and useSpyState.ts each
// hand-rolled this exact 4-call fetch + owner-name-map identically, except useSpyState also
// aliased userMap[roster_id] to the owner's name (needed by RosterSelect.tsx) while
// useLeagueOverview did not. Collapsed into fetchLeagueCore with an opts flag preserving both.

type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

import { fetchLeagueCore } from "@/hooks/leagueCoreFetch";

function roster(rosterId: number, ownerId: string): SleeperRoster {
  return {
    roster_id: rosterId, owner_id: ownerId, league_id: "L1", players: [], starters: [],
    reserve: null, taxi: null, co_owners: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
  };
}

function user(userId: string, displayName: string): SleeperUser {
  return { user_id: userId, username: userId, display_name: displayName, avatar: null };
}

beforeEach(() => { api.impl = {}; });

describe("fetchLeagueCore", () => {
  it("builds userMap keyed by owner user_id only when aliasRosterId is omitted", async () => {
    api.impl.getLeagueRosters = vi.fn(async () => [roster(1, "owner-a")]);
    api.impl.getLeagueUsers = vi.fn(async () => [user("owner-a", "Alice")]);

    const { userMap } = await fetchLeagueCore("L1");

    expect(userMap["owner-a"]).toBe("Alice");
    expect(userMap["1"]).toBeUndefined();
  });

  it("also aliases userMap[roster_id] when aliasRosterId is true", async () => {
    api.impl.getLeagueRosters = vi.fn(async () => [roster(1, "owner-a")]);
    api.impl.getLeagueUsers = vi.fn(async () => [user("owner-a", "Alice")]);

    const { userMap } = await fetchLeagueCore("L1", { aliasRosterId: true });

    expect(userMap["owner-a"]).toBe("Alice");
    expect(userMap["1"]).toBe("Alice");
  });

  it("falls back through username then team_name then Team when display_name is missing", async () => {
    api.impl.getLeagueRosters = vi.fn(async () => []);
    api.impl.getLeagueUsers = vi.fn(async () => [
      { user_id: "u1", username: "uname1", display_name: "", avatar: null },
      { user_id: "u2", username: "", display_name: "", avatar: null, metadata: { team_name: "Team Two" } },
      { user_id: "u3", username: "", display_name: "", avatar: null },
    ]);

    const { userMap } = await fetchLeagueCore("L1");

    expect(userMap.u1).toBe("uname1");
    expect(userMap.u2).toBe("Team Two");
    expect(userMap.u3).toBe("Team");
  });

  it("coerces a non-array response to an empty array rather than throwing", async () => {
    api.impl.getLeagueRosters = vi.fn(async () => null as unknown as SleeperRoster[]);

    const result = await fetchLeagueCore("L1");

    expect(result.rosters).toEqual([]);
  });
});
