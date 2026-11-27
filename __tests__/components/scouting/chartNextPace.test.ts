import { describe, it, expect, beforeEach, vi } from "vitest";

// Chart Next's pace: count-only reads of each play table's sample plays saved
// in the last 4 weeks, filtered like prospect_sample_counts (migration 102).

const { CALLS, COUNTS, FAIL } = vi.hoisted(() => ({
  CALLS: [] as { table: string; ops: unknown[][] }[],
  COUNTS: {} as Record<string, number>,
  FAIL: { table: null as string | null },
}));

vi.mock("@/lib/supabaseclient", () => {
  const from = (table: string) => {
    const call = { table, ops: [] as unknown[][] };
    CALLS.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "gte", "neq", "not", "in", "eq"]) {
      chain[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return chain; };
    }
    chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve(FAIL.table === table
        ? { count: null, error: { message: "boom", code: "500" } }
        : { count: COUNTS[table] ?? 0, error: null }).then(ok, bad);
    return chain;
  };
  return { supabase: { from } };
});

import { fetchChartingPace } from "@/components/scouting/chartNextPace";

beforeEach(() => {
  CALLS.length = 0;
  FAIL.table = null;
  Object.assign(COUNTS, { qb_plays: 268, rb_plays: 1054, route_plays: 1527, te_plays: 10 });
});

describe("fetchChartingPace", () => {
  it("counts each position's sample plays saved since 28 days ago", async () => {
    const now = new Date("2026-11-27T12:00:00Z");
    expect(await fetchChartingPace(now)).toEqual({ QB: 268, RB: 1054, WR: 1527, TE: 10 });
    const since = "2026-10-30T12:00:00.000Z";
    const ops = Object.fromEntries(CALLS.map((c) => [c.table, c.ops]));
    for (const table of ["qb_plays", "rb_plays", "route_plays", "te_plays"]) {
      expect(ops[table][0]).toEqual(["select", "id", { count: "exact", head: true }]);
      expect(ops[table]).toContainEqual(["gte", "created_at", since]);
    }
    expect(ops.qb_plays).toEqual(expect.arrayContaining([
      ["neq", "play_type", "run"], ["not", "accuracy", "is", null], ["neq", "accuracy", "tipped_ball"],
    ]));
    expect(ops.rb_plays).toEqual(expect.arrayContaining([
      ["in", "run_type", ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"]], ["not", "success", "is", null],
    ]));
    expect(ops.route_plays).toContainEqual(["eq", "no_route_run", false]);
    expect(ops.te_plays).toEqual(expect.arrayContaining([["eq", "play_type", "route_run"], ["not", "was_open", "is", null]]));
  });

  it("gives up (null) when any count fails", async () => {
    FAIL.table = "te_plays";
    expect(await fetchChartingPace()).toBeNull();
  });
});
