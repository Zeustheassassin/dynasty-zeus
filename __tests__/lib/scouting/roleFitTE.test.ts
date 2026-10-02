import { describe, it, expect } from "vitest";
import { teRoleFit, computeTERoleFits, TE_MIN_SNAPS, type TERoleInputs } from "@/lib/scouting/roleFitTE";
import { matchFor } from "@/lib/scouting/roleFit";
import type { Prospect, ScoutingGame, TEPlay } from "@/lib/types";

const play = (over: Partial<TEPlay>): TEPlay => ({
  id: "", user_id: "", game_id: "g", location: "left", positioning: "inline", play_type: "route_run",
  block_type: null, block_success: null, coverage: "zone", route_type: "curl", was_open: true, targeted: false,
  caught: null, dropped: null, contested_target: null, contested_catch: null, broken_tackle: false, play_notes: null,
  created_at: "", ...over,
});
const many = (n: number, over: Partial<TEPlay> = {}) => Array.from({ length: n }, () => play(over));
const block = (over: Partial<TEPlay> = {}): Partial<TEPlay> => ({ play_type: "run_block", block_type: "inline", block_success: true, coverage: null, route_type: null, was_open: null, ...over });

const slice = (ae: number, n: number) => ({ ae, n });
const inputs = (plays: TEPlay[], r: { all?: number; man?: number; flat?: number }, b: { all?: number; inline?: number; movement?: number }, size = { heightIn: 77, weightLb: 250 }): TERoleInputs => ({
  plays,
  route: { all: slice(r.all ?? 0, 60), man: slice(r.man ?? 0, 25), flat: slice(r.flat ?? 0, 10) },
  block: { all: slice(b.all ?? 0, 60), inline: slice(b.inline ?? 0, 40), movement: slice(b.movement ?? 0, 20) },
  ...size,
});

describe("TE role buckets", () => {
  it("makes a route winner who lines up in the slot or wide a Move TE", () => {
    const plays = [...many(70, { positioning: "slot" }), ...many(30, { positioning: "wide" }), ...many(20, block())];
    const f = teRoleFit(inputs(plays, { all: 12, man: 12 }, { all: -4 }))!;
    expect(f.best).toBe("move");
    expect(f.usedAs).toBe("move");
  });

  it("makes an inline TE who blocks well and still wins on routes an Inline Y", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const f = teRoleFit(inputs(plays, { all: 10 }, { all: 10, inline: 10 }))!;
    expect(f.best).toBe("inline_y");
  });

  it("makes an inline blocker with thin receiving a Blocking TE", () => {
    const plays = [...many(25, { positioning: "inline", was_open: false }), ...many(90, block())];
    const f = teRoleFit(inputs(plays, { all: -10, man: -10 }, { all: 14, inline: 14 }))!;
    expect(f.best).toBe("blocking");
  });

  it("makes a wing / fullback who blocks on the move an H-back", () => {
    const plays = [...many(40, { positioning: "wing_back", route_type: "flat" }), ...many(50, block({ positioning: "full_back", block_type: "movement" }))];
    const f = teRoleFit(inputs(plays, { flat: 8 }, { movement: 12 }))!;
    expect(f.best).toBe("h_back");
  });

  it("drops a 6'2\" 230 as an Inline Y", () => {
    const plays = [...many(50, { positioning: "inline" }), ...many(60, block())];
    const m = matchFor(teRoleFit(inputs(plays, {}, {}, { heightIn: 74, weightLb: 230 }))!, "inline_y")!;
    expect(m.sizeDrop).toBeCloseTo(0.06 + 15 * 0.006);
  });

  it(`needs ${TE_MIN_SNAPS} snaps`, () => {
    expect(teRoleFit(inputs(many(TE_MIN_SNAPS - 1), {}, {}))).toBeNull();
  });

  it("scores every TE from the league's plays", () => {
    const prospects = [{ id: "te", position: "TE", height: "6'5\"", weight: 250 }] as unknown as Prospect[];
    const games = [{ id: "g1", prospect_id: "te", season_year: 2025 }] as unknown as ScoutingGame[];
    const plays = [...many(30, { game_id: "g1", positioning: "slot" }), ...many(20, { game_id: "g1", ...block() })];
    expect(computeTERoleFits(prospects, games, plays).get("te")!.sample).toEqual({ n: 50, unit: "snaps" });
  });
});
