import { describe, it, expect } from "vitest";
import {
  RUSH_BONUS_MAX, RUSH_SHRINK_GAMES, RUSH_YPG_FULL, RUSH_YPG_START, passingPart, qbRushingByProspect, rushingBonuses, type QBRushing,
} from "@/lib/scouting/qbRushing";
import { buildPositionComposite, type AEComposite } from "@/lib/scouting/aeComposite";
import { scorePieces, type ScoreView } from "@/lib/scouting/prospectScores";
import { SEASON_DECAY } from "@/lib/scouting/seasonWeight";
import { SEASON_DEPTH_SELECT, SEASON_DEPTH_SELECTS, type PffSeasonDepthRow } from "@/lib/scouting/middleUsage";

const row = (prospect_id: string, season: number, fr: Record<string, number> | null): PffSeasonDepthRow => ({
  prospect_id, season, pff_player_id: 1, team_name: "X", fetched_at: "", zone_attempts: {},
  ...(fr ? Object.fromEntries(Object.entries(fr).map(([k, v]) => [`fr_${k}`, v])) : {}),
});

describe("qbRushingByProspect", () => {
  it("blends rushing yards per game over his seasons by games, older ones faded, pulled lightly toward the college median", () => {
    const r = qbRushingByProspect([
      row("Q", 2024, { games: 12, att: 100, yds: 600 }),
      row("Q", 2025, { games: 10, att: 90, yds: 400 }),
      row("Q", 2023, null), // no rushing imported for that season
    ]).get("Q")!;
    const w = SEASON_DECAY;
    expect(r.seasons).toEqual([2024, 2025]);
    expect([r.games, r.attempts, r.yards]).toEqual([22, 190, 1000]);
    expect(r.rawYpg).toBeCloseTo((400 + w * 600) / (10 + w * 12), 12);
    expect(r.ypg).toBeCloseTo((400 + w * 600 + RUSH_SHRINK_GAMES * RUSH_YPG_START) / (10 + w * 12 + RUSH_SHRINK_GAMES), 12);
    expect(qbRushingByProspect([row("N", 2025, null)]).has("N")).toBe(false);
  });

  it("selects PFF's season rushing fields, with a fallback select for each migration not applied yet", () => {
    expect(SEASON_DEPTH_SELECT).toContain("fr_yds:rushing->yards");
    expect(SEASON_DEPTH_SELECT).toContain("fr_games:rushing->player_game_count");
    expect(SEASON_DEPTH_SELECTS).toHaveLength(3);
    expect(SEASON_DEPTH_SELECTS[1]).not.toContain("rushing");
    expect(SEASON_DEPTH_SELECTS[2]).not.toContain("pocket");
  });
});

describe("rushingBonuses (the user's picks, 2026-11-10)", () => {
  const composite = { positions: { QB: buildPositionComposite("QB", [{ key: "aae", label: "AAE", weight: 1, samples: new Map() }]) } } as unknown as AEComposite;
  const qbs = Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, position: "QB" }));
  const live = new Map<string, ScoreView>(qbs.map((q, i) => [q.id, { score: i, components: [] }]));
  const runner = (ypg: number): QBRushing => ({ seasons: [2025], games: 12, attempts: 120, yards: ypg * 12, ypg, rawYpg: ypg });

  it("gates by passing thirds: none in the bottom third, all in the top third, a smooth curve between", () => {
    const b = rushingBonuses(qbs, live, composite, new Map(qbs.map((q) => [q.id, runner(70)])));
    // Passing scores 0–8: thirds cut at 2.67 and 5.33.
    expect(b.get("q0")).toMatchObject({ value: 0, gate: 0 });
    expect(b.get("q8")!.value).toBeCloseTo(RUSH_BONUS_MAX, 12);
    expect(b.get("q4")!.gate).toBeCloseTo(0.5, 12); // the curve's middle
    expect(b.get("q4")!.value).toBeCloseTo(0.15, 12);
    expect(b.get("q3")!.gate).toBeLessThan(0.5);
    expect(b.get("q8")!.label).toContain("top third");
  });

  it("rises evenly from the college median to the top 10% of rushing yards per game, and skips a QB under the median", () => {
    const mid = (RUSH_YPG_START + RUSH_YPG_FULL) / 2;
    const b = rushingBonuses(qbs, live, composite, new Map([["q8", runner(mid)], ["q7", runner(RUSH_YPG_START - 5)]]));
    expect(b.get("q8")!.value).toBeCloseTo(RUSH_BONUS_MAX / 2, 12);
    expect(b.has("q7")).toBe(false);
  });

  it("can't gate without a pool of scored QBs", () => {
    expect(rushingBonuses(qbs.slice(0, 5), live, composite, new Map([["q4", runner(70)]])).size).toBe(0);
  });

  it("reads passing as his AE Score without its rushing pieces", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const sample = (ae: number) => ({ ae, n: 120, variance: 4 });
    const pc = buildPositionComposite("QB", [
      { key: "aae", label: "AAE", weight: 1, samples: new Map(ids.map((id, i) => [id, sample(i * 1.5 - 8)])) },
      { key: "pff_qb_ypc", label: "PFF Rush Y/C", weight: 0.3, perPlayer: true, minVariance: 1e-6, samples: new Map(ids.map((id, i) => [id, { ae: ((i * 7) % 12) * 2, n: 80, variance: 0.01 }])) },
    ]);
    const comp = { positions: { QB: pc } } as unknown as AEComposite;
    const sc = pc.scores.get("p5")!;
    const view: ScoreView = { score: sc.score, components: sc.components.map((c) => ({ ...c, tau: 1 })) };
    const rush = scorePieces(view, pc).find((x) => x.key === "pff_qb_ypc")!.add;
    expect(rush).not.toBe(0);
    expect(passingPart(view, comp)).toBeCloseTo(view.score - rush, 12);
  });
});
