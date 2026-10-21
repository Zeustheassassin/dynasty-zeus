// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CompareProspectsTab from "@/components/scouting/stats/CompareProspectsTab";
import { buildTEStatRows, TE_STAT_COLS } from "@/components/scouting/stats/TEStatsTable";
import type { Prospect, ScoutingGame, TEPlay } from "@/lib/types";

// The Compare tab's TE route and blocking rows show the counts behind each %
// ("2/3"), so a 100% on one rep reads differently from a 100% on 50.

afterEach(cleanup);

const prospect = (id: string, name: string) =>
  ({ id, name, position: "TE", school: "State", draft_class_year: 2027 }) as Prospect;
const game = (id: string, prospect_id: string) =>
  ({ id, prospect_id, season_year: 2026, opponent: "Rival", created_at: "2026-10-01T00:00:00Z", trait_grades: null }) as unknown as ScoutingGame;

let seq = 0;
const play = (game_id: string, p: Partial<TEPlay>): TEPlay =>
  ({
    id: `p${seq++}`, user_id: "u", game_id, location: "left", positioning: "inline", play_type: "route_run",
    block_type: null, block_success: null, coverage: "zone", route_type: null, was_open: null, targeted: false,
    caught: null, dropped: null, contested_target: null, contested_catch: null, broken_tackle: false,
    play_notes: null, created_at: "2026-10-01T00:00:00Z", ...p,
  }) as TEPlay;
const route = (game_id: string, route_type: TEPlay["route_type"], was_open: boolean | null) => play(game_id, { route_type, was_open });
const block = (game_id: string, play_type: "run_block" | "pass_block", block_type: "movement" | "inline", block_success: boolean | null) =>
  play(game_id, { play_type, block_type, block_success, coverage: null });

const PROSPECTS = [prospect("a", "Alpha Tight"), prospect("b", "Bravo Tight")];
const GAMES = [game("ga", "a"), game("gb", "b")];
const PLAYS: TEPlay[] = [
  route("ga", "curl", true), route("ga", "curl", false), route("ga", "curl", true), route("ga", "curl", null),
  route("ga", "flat", true),
  block("ga", "run_block", "inline", true), block("ga", "run_block", "movement", false),
  block("ga", "pass_block", "inline", true), block("ga", "run_block", "inline", null),
  route("gb", "curl", true),
  block("gb", "pass_block", "movement", true),
];

describe("TE stat rows: counts behind the route and blocking %s", () => {
  const rows = buildTEStatRows(PROSPECTS, GAMES, PLAYS);
  const a = rows.find((r) => r.id === "a")!;

  it("counts open of rated routes per route type; an unrated route counts in neither", () => {
    expect([a.rt_curl, a.rt_curl_open_n, a.rt_curl_rated_n]).toEqual([66.7, 2, 3]);
    expect([a.rt_flat, a.rt_flat_open_n, a.rt_flat_rated_n]).toEqual([100, 1, 1]);
    expect([a.rt_post, a.rt_post_open_n, a.rt_post_rated_n]).toEqual([null, 0, 0]);
  });

  it("counts won of rated blocks per group; a block with no outcome counts in neither", () => {
    expect([a.blk_succ, a.blk_won_n, a.blk_rated_n]).toEqual([66.7, 2, 3]);
    expect([a.run_blk_succ, a.run_blk_won_n, a.run_blk_rated_n]).toEqual([50, 1, 2]);
    expect([a.pass_blk_succ, a.pass_blk_won_n, a.pass_blk_rated_n]).toEqual([100, 1, 1]);
    expect([a.mvmt_blk_succ, a.mvmt_blk_won_n, a.mvmt_blk_rated_n]).toEqual([0, 0, 1]);
    expect([a.inln_blk_succ, a.inln_blk_won_n, a.inln_blk_rated_n]).toEqual([100, 2, 2]);
    // The League row's weights are unchanged: every block of the type, rated or not.
    expect(a.run_blk_n).toBe(3);
  });

  it("gives every route and blocking column counts the rows carry", () => {
    const counted = TE_STAT_COLS.filter((c) => c.group === "Open% by Route" || c.group === "Blocking");
    expect(counted.length).toBe(15);
    for (const c of counted) {
      expect(c.counts, c.key).toBeDefined();
      expect(typeof a[c.counts!.hit], c.counts!.hit).toBe("number");
      expect(typeof a[c.counts!.of], c.counts!.of).toBe("number");
    }
  });
});

describe("Compare tab: TE counts beside the %", () => {
  it("shows hit/of next to each side's %, and nothing beside a —", () => {
    render(
      <CompareProspectsTab
        prospects={PROSPECTS} prospectsWithStats={[]} games={GAMES}
        rbPlays={[]} qbPlays={[]} tePlays={PLAYS} loadPositionPlays={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Tight End/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Alpha Tight/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Bravo Tight/ }));

    const curl = screen.getByTitle("Curl").parentElement!;
    expect(curl.textContent).toBe("66.7%2/3Curl1/1100.0%");
    const flat = screen.getByTitle("Flat").parentElement!;
    expect(flat.textContent).toBe("100.0%1/1Flat—");
    const mvmt = screen.getByTitle("Movement block success%").parentElement!;
    expect(mvmt.textContent).toBe("0.0%0/1MvmtBlk%1/1100.0%");
    // A column without counts renders as before.
    const snaps = screen.getByTitle("Snaps").parentElement!;
    expect(snaps.textContent).toBe("9Snaps2");
  });
});
