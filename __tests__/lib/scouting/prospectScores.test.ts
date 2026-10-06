import { describe, it, expect } from "vitest";
import type { AEScoreLock, ProspectWithStats, ScoutingGame } from "../../../lib/types";
import {
  scoreViewsFrom, dynastyScores, gamesByTierFrom, defenseFacedFrom, scorePieces, type ScoreView,
} from "../../../lib/scouting/prospectScores";
import { buildPositionComposite } from "../../../lib/scouting/aeComposite";
import { DEFAULT_DYNASTY_WEIGHTS } from "../../../lib/scouting/dynastyScore";
import type { GameContext } from "../../../lib/scouting/gameContext";
import type { OpponentTier } from "../../../lib/scouting/opponentTier";

const prospect = (id: string, position: string, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name: id, position, school: "State", draft_class_year: 2027,
    height: "", weight: null, birthday: null, draft_round: null, ae_score_lock: null,
    ...extra,
  }) as ProspectWithStats;

const live = (score: number): ScoreView => ({ score, components: [] });
const lock = (score: number): AEScoreLock => ({ score, components: [], locked_at: "2026-05-02T00:00:00.000Z" });
const game = (id: string, prospect_id: string) => ({ id, prospect_id }) as ScoutingGame;

describe("scoreViewsFrom", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const drafted = prospect("d", "WR", { draft_class_year: 2026, ae_score_lock: lock(1.1) });
  const upcoming = prospect("u", "WR", { ae_score_lock: lock(0.4) });
  const snapshotOnly = prospect("s", "QB", { draft_class_year: 2026, ae_score_lock: lock(-0.3) });
  const scores = new Map([["d", live(1.4)], ["u", live(0.9)]]);
  const all = [drafted, upcoming, snapshotOnly];

  it("shows live scores, quoting a drafted class's draft-day snapshot", () => {
    const m = scoreViewsFrom(all, scores, "live", now);
    expect(m.get("d")).toMatchObject({ score: 1.4, atDraft: { score: 1.1 } });
    expect(m.get("d")!.lockedAt).toBeUndefined();
    // Not drafted yet: a stray snapshot is ignored.
    expect(m.get("u")).toEqual(live(0.9));
  });

  it("swaps in the snapshot as of the draft, and falls back to it with no live score", () => {
    const m = scoreViewsFrom(all, scores, "draft", now);
    expect(m.get("d")).toMatchObject({ score: 1.1, lockedAt: "2026-05-02T00:00:00.000Z" });
    expect(m.get("u")).toEqual(live(0.9));
    expect(scoreViewsFrom(all, scores, "live", now).get("s")).toMatchObject({ score: -0.3 });
  });
});

describe("dynastyScores", () => {
  it("scores only prospects with an AE Score at a scored position", () => {
    const ps = [prospect("a", "WR", { draft_round: 1 }), prospect("b", "RB"), prospect("k", "K")];
    const views = new Map([["a", live(1)], ["k", live(2)]]);
    const m = dynastyScores(ps, views, new Map(), DEFAULT_DYNASTY_WEIGHTS);
    expect([...m.keys()]).toEqual(["a"]);
    // No age known: Dynasty = the AE Score; Plus adds the 1st round at the default 2× weight.
    expect(m.get("a")!.dynasty).toBeCloseTo(1);
    expect(m.get("a")!.plus).toBeCloseTo(3);
  });
});

describe("gamesByTierFrom / defenseFacedFrom", () => {
  const games = [game("g1", "a"), game("g2", "a"), game("g3", "a"), game("g4", "b")];

  it("counts each prospect's charted games by opponent tier, skipping untiered ones", () => {
    const tiers = new Map<string, OpponentTier>([["g1", "P4"], ["g2", "G5"], ["g3", "P4"]]);
    const m = gamesByTierFrom(games, tiers);
    expect(m.get("a")).toEqual({ P4: 2, G5: 1, FCS: 0 });
    expect(m.has("b")).toBe(false);
  });

  it("averages the opponents' defensive SP+ over the games that have it", () => {
    const ctx = (oppDefSp: number | null) => ({ oppDefSp }) as GameContext;
    const contexts = new Map([["g1", ctx(20)], ["g2", ctx(30)], ["g3", ctx(null)], ["g4", ctx(18)]]);
    const m = defenseFacedFrom(games, contexts);
    expect(m.get("a")).toEqual({ avg: 25, games: 2 });
    expect(m.get("b")).toEqual({ avg: 18, games: 1 });
  });
});

describe("scorePieces", () => {
  // Twelve prospects on a primary metric, a secondary one (WR SAE-like, where a
  // missing sample counts 0 at full weight) and a per-player component.
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const sample = (ae: number, n = 120, variance = 4) => ({ ae, n, variance });
  const primary = { key: "csae", label: "cSAE", weight: 0.7, samples: new Map(ids.map((id, i) => [id, sample(i * 1.5 - 8)])) };
  const secondary = { key: "sae", label: "SAE", weight: 0.3, samples: new Map(ids.map((id, i) => [id, i === 0 ? null : sample(i - 5)])) };
  const extra = {
    key: "yprr", label: "YPRR", weight: 0.5, perPlayer: true as const, minVariance: 1e-6,
    samples: new Map(ids.slice(0, 11).map((id, i) => [id, sample(i * 0.2, 80, 0.01)])),
    describe: (_id: string, s: { ae: number }) => `${s.ae.toFixed(2)} yds`,
  };

  it("adds up to the AE Score, alignment and baseline included", () => {
    const pc = buildPositionComposite("WR", [primary, secondary, extra], -0.2);
    for (const id of ["p0", "p5", "p11"]) {
      const sc = pc.scores.get(id)!;
      const view: ScoreView = {
        score: sc.score - 0.18,
        components: sc.components.map((c) => ({ ...c, tau: 1 })),
        alignment: { label: "85% of snaps on the right side", value: -0.18 },
        baseline: sc.baseline,
      };
      const pieces = scorePieces(view, pc);
      expect(pieces.reduce((s, x) => s + x.add, 0)).toBeCloseTo(view.score, 10);
      expect(pieces.map((x) => x.key)).toContain("baseline");
      expect(pieces.at(-2)).toMatchObject({ key: "alignment", add: -0.18 });
      // p11 has no YPRR sample: no per-player piece, and his score is still the sum.
      expect(pieces.some((x) => x.key === "yprr")).toBe(id !== "p11");
    }
  });

  it("describes each piece: AE sample, per-player weight after trust", () => {
    const pc = buildPositionComposite("WR", [primary, secondary, extra]);
    const sc = pc.scores.get("p5")!;
    const pieces = scorePieces({ score: sc.score, components: sc.components.map((c) => ({ ...c, tau: 1 })) }, pc);
    expect(pieces[0]).toMatchObject({ key: "csae", value: "-0.5 on 120 core routes", weight: "0.7" });
    const y = pieces.find((x) => x.key === "yprr")!;
    expect(y.value).toBe("1.00 yds");
    expect(y.weight).toMatch(/^0\.5 × \d+% = 0\.\d\d$/);
  });
});
