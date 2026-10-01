"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import type { ProspectWithStats, Prospect, RouteType, ScoutingGame, RBPlay, QBPlay, TEPlay, AESample, AEScoreLock, ScoreComponent } from "../../lib/types";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import {
  computeRBAboveExpectedSamples,
  computeQBAboveExpectedSamples,
  computeTERouteAboveExpectedSamples,
  computeTEBlockAboveExpectedSamples,
  computeQBThrowSliceAAE,
  computeRBRunSliceSRAE,
  aeValues,
  type AESlice,
} from "../../lib/scouting/aboveExpected";
import {
  buildAEComposite, MIN_POOL,
  type AEComposite, type CompositePos,
} from "../../lib/scouting/aeComposite";
import {
  scoreDynasty, PRIME_END_AGE, REFERENCE_ROOKIE_AGE,
  DEFAULT_DYNASTY_WEIGHTS, WEIGHT_MIN, WEIGHT_MAX, WEIGHT_STEP,
  type DynastyBreakdown, type DynastyWeights,
} from "../../lib/scouting/dynastyScore";
import { prospectAgeAt, rookieSeasonAge, parseHeightInches, type ProspectAge } from "../../lib/scouting/prospectAge";
import { DRAFT_ROUND_CHOICES, UNDRAFTED_ROUND, draftRoundLabel } from "../../lib/draftRound";
import { useRecruitIndex } from "../../hooks/useRecruitIndex";
import { tierGames, type OpponentTier } from "../../lib/scouting/opponentTier";
import { applyOpponentStrength, type OpponentAdjusted } from "../../lib/scouting/opponentAdjust";
import { classDraftedBy, makeLock, activeLock } from "../../lib/scouting/scoreLock";
import { buildWRTierSplits, type ProspectGameRouteCellsRow } from "../../lib/scouting/aggregateMerge";
import { POS_COLOR } from "../../lib/uiTheme";
import {
  parseGrade, formatGrade, gradeColor, gradeDelta, gradeTier, gradeTierRange,
  GRADE_MIN, GRADE_MAX, GRADE_TIERS, type GradeField,
} from "../../lib/scouting/prospectGrade";

type LoadPositionPlaysFn = (pos: "RB" | "QB" | "TE") => void;

type BoardTab = "all" | "QB" | "RB" | "WR" | "TE";

// One column per Above-Expected metric. The All tab shows every headline
// column (a row fills only its own position's); a position tab shows its own
// headline metrics plus, for QB and RB, the Analysis tables' breakdown columns
// (`breakdown: true`, never on All). `group` is the header band each column sits
// under. Tooltips match the Analysis tables' so the two describe each metric
// the same way.
type AEKey =
  | "aae" | "srae" | "sae" | "csae" | "te_saer" | "te_saeb"
  | "aae_out" | "aae_in" | "aae_deep" | "aae_mid" | "aae_short"
  | "srae_out" | "srae_in" | "srae_zone" | "srae_mg";
interface AEColumn {
  key: AEKey;
  label: string;
  pos: "QB" | "RB" | "WR" | "TE";
  group: "Above Exp" | "AAE Breakdown" | "SRAE Breakdown";
  breakdown?: true;
  tooltip: string;
}
const AE_COLUMNS: AEColumn[] = [
  { key: "aae",     label: "AAE",     pos: "QB", group: "Above Exp", tooltip: "Accuracy Above Expected — each throw judged against throws like it (all situation tags stacked). Min. 25 graded passes." },
  { key: "srae",    label: "SRAE",    pos: "RB", group: "Above Exp", tooltip: "Success Rate Above Expected — each run judged against runs like it (formation, loaded box, unblocked defender stacked). Min. 15 runs." },
  { key: "sae",     label: "SAE",     pos: "WR", group: "Above Exp", tooltip: "Success (Open) Rate Above Expected — each route judged against routes like it (route, coverage incl. press, slot/outside, on/off line stacked). Min. 15 routes." },
  { key: "csae",    label: "cSAE",    pos: "WR", group: "Above Exp", tooltip: "Core-Route SAE — same as SAE, but excludes Go (Nine) and Screen routes. Min. 15 core routes." },
  { key: "te_saer", label: "TE-SAER", pos: "TE", group: "Above Exp", tooltip: "Route SAE — Open Rate Above Expected, each route judged against routes like it (route, coverage incl. press, positioning stacked). Min. 15 rated routes." },
  { key: "te_saeb", label: "TE-SAEB", pos: "TE", group: "Above Exp", tooltip: "Block SAE — Block Success Above Expected, each block judged against blocks like it (run/pass, movement/inline, positioning stacked). Min. 15 rated blocks." },
  { key: "aae_out",   label: "Outside",      pos: "QB", group: "AAE Breakdown", breakdown: true, tooltip: "AAE on outside throws (left or right third of the field), each judged against throws like it. Min. 10 such throws." },
  { key: "aae_in",    label: "Inside",       pos: "QB", group: "AAE Breakdown", breakdown: true, tooltip: "AAE on inside throws (middle third of the field), each judged against throws like it. Min. 10 such throws." },
  { key: "aae_deep",  label: "Deep",         pos: "QB", group: "AAE Breakdown", breakdown: true, tooltip: "AAE on deep throws (20+ yds), each judged against throws like it. Min. 10 such throws." },
  { key: "aae_mid",   label: "Intermediate", pos: "QB", group: "AAE Breakdown", breakdown: true, tooltip: "AAE on intermediate throws (10–20 yds), each judged against throws like it. Min. 10 such throws." },
  { key: "aae_short", label: "Short",        pos: "QB", group: "AAE Breakdown", breakdown: true, tooltip: "AAE on short throws (under 10 yds), each judged against throws like it. Min. 10 such throws." },
  { key: "srae_out",  label: "Outside",      pos: "RB", group: "SRAE Breakdown", breakdown: true, tooltip: "SRAE on outside runs (outside zone + outside man gap), each judged against outside runs like it (formation, loaded box, unblocked defender stacked). Min. 10 such runs." },
  { key: "srae_in",   label: "Inside",       pos: "RB", group: "SRAE Breakdown", breakdown: true, tooltip: "SRAE on inside runs (inside zone + inside man gap), each judged against inside runs like it (formation, loaded box, unblocked defender stacked). Min. 10 such runs." },
  { key: "srae_zone", label: "Zone",         pos: "RB", group: "SRAE Breakdown", breakdown: true, tooltip: "SRAE on zone runs (outside + inside zone), each judged against zone runs like it (formation, loaded box, unblocked defender stacked). Min. 10 such runs." },
  { key: "srae_mg",   label: "Man Gap",      pos: "RB", group: "SRAE Breakdown", breakdown: true, tooltip: "SRAE on man gap runs (outside + inside man gap), each judged against man gap runs like it (formation, loaded box, unblocked defender stacked). Min. 10 such runs." },
];
type AEMaps = Record<AEKey, Map<string, number | null>>;

// What each AE Score metric counts, for the cell tooltips.
const SAMPLE_UNIT: Record<string, string> = {
  aae: "throws", srae: "runs", sae: "routes", csae: "core routes", te_saer: "routes", te_saeb: "blocks",
};
const COMPOSITE_POS: CompositePos[] = ["QB", "RB", "WR", "TE"];
const isCompositePos = (pos: string): pos is CompositePos => (COMPOSITE_POS as string[]).includes(pos);
const signed = (v: number, dp: number) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

// The Dynasty sliders, persisted per browser (a viewing preference).
const DYNASTY_WEIGHTS_KEY = "dynastyScoreWeights";
const WEIGHT_SLIDERS: { key: keyof DynastyWeights; label: string; hint: string }[] = [
  { key: "age",   label: "Age",   hint: "How much the career window (prime seasons left) counts" },
  { key: "size",  label: "Size",  hint: "How much size counts: RBs and WRs carrying more weight for their height gain, lean and very light ones lose" },
  { key: "draft", label: "Draft", hint: "How much draft round counts in Dynasty Score Plus" },
];

// The AE Score a cell shows: the saved lock for a drafted class, else live.
// Each part carries the position spread it was scored against.
interface ScoreView {
  score: number;
  components: (ScoreComponent & { tau: number })[];
  /** Set when this is a saved lock. */
  lockedAt?: string;
}

// Derived per-prospect values the sort reads.
interface SortContext {
  aeScores: Map<string, ScoreView>;
  dynasty: Map<string, DynastyBreakdown>;
  ages: Map<string, ProspectAge>;
}

type SortKey =
  | "pre_draft_grade" | "post_draft_grade" | "grade_delta"
  | "personal_rank" | "overall_rank" | "ae_score" | "dynasty" | "dynasty_plus" | "name" | "school" | "conference" | "draft_class_year" | "height" | "weight" | "age" | "position"
  | "total_routes" | "total_games" | "targets" | "catches" | "drops" | "contested" | "contested_catches"
  | "success_rate" | "target_rate" | "adj_success_above_exp" | `ae_${AEKey}`
  | "pct_left" | "pct_right" | "pct_slot" | "pct_backfield"
  | "depth_behind_los" | "depth_on_los" | "total_snaps"
  | "cvg_man" | "cvg_man_catch" | "cvg_zone" | "cvg_zone_catch"
  | "cvg_double" | "cvg_double_catch" | "cvg_press" | "cvg_press_catch"
  | `rt_${RouteType}_count` | `rt_${RouteType}_targets` | `rt_${RouteType}_catches` | `rt_${RouteType}_rate`
  | "cvg_man_rate" | "cvg_zone_rate" | "cvg_press_rate"
  | "open_pct_slot" | "open_pct_slot_on" | "open_pct_slot_off"
  | "open_pct_right" | "open_pct_right_on" | "open_pct_right_off"
  | "open_pct_left" | "open_pct_left_on" | "open_pct_left_off"
  | "open_pct_backfield"
;

interface Props {
  prospects: ProspectWithStats[];
  loading: boolean;
  onSelectProspect: (p: Prospect) => void;
  onUpdateRank: (id: string, rank: number) => Promise<void>;
  onUpdateOverallRank: (id: string, rank: number) => Promise<void>;
  /** Persist a pre/post draft grade (1.0-100.0, one decimal) or null to clear it. */
  onUpdateGrade: (id: string, field: GradeField, grade: number | null) => Promise<void>;
  /** Persist the NFL draft round (1–7, UNDRAFTED_ROUND) or null; false if the write failed. */
  onUpdateDraftRound: (id: string, round: number | null) => Promise<boolean>;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  // Raw plays + games are lazy-loaded by ScoutingHub. The board triggers
  // load via loadPositionPlays on mount and uses the resulting plays to
  // compute the Above-Expected columns (AAE / SRAE / TE-SAER / TE-SAEB; WR's
  // SAE / cSAE arrive pre-aggregated on the prospect).
  games: ScoutingGame[];
  rbPlays: RBPlay[];
  qbPlays: QBPlay[];
  tePlays: TEPlay[];
  loadPositionPlays: LoadPositionPlaysFn;
  /** Per-game WR route cells (migration 058), for the AE Score's opponent
   *  adjustment. Null until loaded, or when the view isn't available. */
  gameRouteCells?: ProspectGameRouteCellsRow[] | null;
  loadGameRouteCells?: () => void;
  /** Every lazy input has loaded, so a score is safe to freeze. */
  scoresReady?: boolean;
  /** Save a drafted prospect's frozen AE Score; false if the write failed. */
  onLockAEScore?: (id: string, lock: AEScoreLock) => Promise<boolean>;
}

function getSortValue(
  p: ProspectWithStats,
  key: SortKey,
  aeMaps: AEMaps,
  ctx: SortContext,
): number | string | null {
  const BIG = 99999;
  // Ungraded sorts to the bottom in both directions' natural reading: -BIG keeps
  // it off the top of a descending (best-first) grade sort.
  if (key === "pre_draft_grade") return p.pre_draft_grade ?? -BIG;
  if (key === "post_draft_grade") return p.post_draft_grade ?? -BIG;
  if (key === "grade_delta") return gradeDelta(p.pre_draft_grade, p.post_draft_grade) ?? -BIG;
  if (key === "personal_rank") return p.personal_rank ?? BIG;
  if (key === "overall_rank") return p.overall_rank ?? BIG;
  if (key === "name") return p.name;
  // Unscored (under the floor, or a position not in the score yet) sinks both ways.
  if (key === "ae_score") return ctx.aeScores.get(p.id)?.score ?? null;
  if (key === "dynasty") return ctx.dynasty.get(p.id)?.dynasty ?? null;
  if (key === "dynasty_plus") return ctx.dynasty.get(p.id)?.plus ?? null;
  // null, not -BIG: on the All tab most rows have no value for a given AE
  // column (other positions), and the sort sinks those in both directions.
  if (key.startsWith("ae_")) return aeMaps[key.slice(3) as AEKey].get(p.id) ?? null;
  if (key === "school") return p.school;
  if (key === "conference") return p.conference ?? "";
  if (key === "position") return p.position;
  if (key === "draft_class_year") return p.draft_class_year;
  if (key === "height") return p.height || "ZZZ";
  if (key === "weight") return p.weight ?? BIG;
  if (key === "age") return ctx.ages.get(p.id)?.years ?? BIG;
  if (key === "total_routes") return p.total_routes;
  if (key === "total_games") return p.total_games;
  if (key === "targets") return p.targets;
  if (key === "catches") return p.catches;
  if (key === "drops") return p.drops;
  if (key === "contested") return p.contested;
  if (key === "contested_catches") return p.contested_catches;
  if (key === "success_rate") return p.success_rate ?? -BIG;
  if (key === "target_rate") return p.target_rate ?? -BIG;
  if (key === "adj_success_above_exp") return p.adj_success_above_exp ?? -BIG;
  if (key === "pct_left") return p.pct_left ?? -BIG;
  if (key === "pct_right") return p.pct_right ?? -BIG;
  if (key === "pct_slot") return p.pct_slot ?? -BIG;
  if (key === "pct_backfield") return p.pct_backfield ?? -BIG;
  if (key === "depth_behind_los") return p.depth_behind_los;
  if (key === "depth_on_los") return p.depth_on_los;
  if (key === "total_snaps") return p.total_snaps;
  if (key === "cvg_man") return p.coverage_stats.man.count;
  if (key === "cvg_man_catch") return p.coverage_stats.man.catches;
  if (key === "cvg_zone") return p.coverage_stats.zone.count;
  if (key === "cvg_zone_catch") return p.coverage_stats.zone.catches;
  if (key === "cvg_double") return p.coverage_stats.double.count;
  if (key === "cvg_double_catch") return p.coverage_stats.double.catches;
  if (key === "cvg_press") return p.coverage_stats.press.count;
  if (key === "cvg_press_catch") return p.coverage_stats.press.catches;
  if (key === "cvg_man_rate") { const s = p.coverage_stats.man; return s.count > 0 ? s.open / s.count : -BIG; }
  if (key === "cvg_zone_rate") { const s = p.coverage_stats.zone; return s.count > 0 ? s.open / s.count : -BIG; }
  if (key === "cvg_press_rate") { const s = p.coverage_stats.press; return s.count > 0 ? s.open / s.count : -BIG; }
  if (key === "open_pct_slot") return p.open_pct_slot ?? -BIG;
  if (key === "open_pct_slot_on") return p.open_pct_slot_on_line ?? -BIG;
  if (key === "open_pct_slot_off") return p.open_pct_slot_off_line ?? -BIG;
  if (key === "open_pct_right") return p.open_pct_right ?? -BIG;
  if (key === "open_pct_right_on") return p.open_pct_right_on_line ?? -BIG;
  if (key === "open_pct_right_off") return p.open_pct_right_off_line ?? -BIG;
  if (key === "open_pct_left") return p.open_pct_left ?? -BIG;
  if (key === "open_pct_left_on") return p.open_pct_left_on_line ?? -BIG;
  if (key === "open_pct_left_off") return p.open_pct_left_off_line ?? -BIG;
  if (key === "open_pct_backfield") return p.open_pct_backfield ?? -BIG;
  if (key.startsWith("rt_")) {
    const parts = key.split("_");
    const stat = parts[parts.length - 1] as "count" | "targets" | "catches" | "rate";
    const rt = parts.slice(1, -1).join("_") as RouteType;
    if (stat === "rate") { const rs = p.route_stats[rt]; return rs && rs.count > 0 ? rs.open / rs.count : -BIG; }
    return p.route_stats[rt]?.[stat as "count" | "targets" | "catches"] ?? 0;
  }
  return 0;
}

export default function BigBoard({
  prospects,
  loading,
  onSelectProspect,
  onUpdateRank,
  onUpdateOverallRank,
  onUpdateGrade,
  onUpdateDraftRound,
  draftYearFilter,
  setDraftYearFilter,
  games,
  rbPlays,
  qbPlays,
  tePlays,
  loadPositionPlays,
  gameRouteCells = null,
  loadGameRouteCells,
  scoresReady = false,
  onLockAEScore,
}: Props) {
  // Trigger lazy load of all three position plays the first time the
  // board renders. ScoutingHub no-ops if a position is already loaded
  // for the current games key, so this is safe to call repeatedly.
  useEffect(() => {
    loadPositionPlays("RB");
    loadPositionPlays("QB");
    loadPositionPlays("TE");
  }, [loadPositionPlays]);
  useEffect(() => { loadGameRouteCells?.(); }, [loadGameRouteCells]);

  // Each game's opponent tier (P4 / G5 / FCS), for the opponent adjustment.
  const gameTiers = useMemo(() => tierGames(games), [games]);

  // One map per Above-Expected column, each holding only its own position's
  // prospects. null = under that metric's min-sample threshold. The headline
  // samples also feed the cross-position AE Score, so each model is fit once.
  // The AE Score (and the Dynasty scores built on it) take the samples after
  // the opponent-strength adjustment (opponentAdjust.ts). The AE columns keep
  // the unadjusted values, by the user's call.
  const { aeMaps, composite, opponent } = useMemo<{ aeMaps: AEMaps; composite: AEComposite; opponent: OpponentAdjusted["effects"] }>(() => {
    const sae = new Map<string, number | null>();
    const csae = new Map<string, number | null>();
    const wr = new Map<string, AESample | null>();
    const wrCore = new Map<string, AESample | null>();
    for (const p of prospects) {
      if (p.position !== "WR") continue;
      sae.set(p.id, p.adj_success_above_exp);
      csae.set(p.id, p.core_sae);
      wr.set(p.id, p.sae_sample);
      wrCore.set(p.id, p.core_sae_sample);
    }
    const tiers = gameTiers.byGame;
    const qb = computeQBAboveExpectedSamples(prospects, games, qbPlays);
    const rb = computeRBAboveExpectedSamples(prospects, games, rbPlays, tiers);
    const teRoute = computeTERouteAboveExpectedSamples(prospects, games, tePlays, tiers);
    const teBlock = computeTEBlockAboveExpectedSamples(prospects, games, tePlays, tiers);
    // WR's tier splits come from the per-game cells; without them WR (and so
    // RB and TE, which borrow WR's effect) stays unadjusted.
    const splits = gameRouteCells ? buildWRTierSplits(gameRouteCells, (id) => tiers.get(id)) : null;
    const withSplits = (m: Map<string, AESample | null>, by: Map<string, NonNullable<AESample["byTier"]>> | undefined) =>
      by ? new Map([...m].map(([id, smp]) => [id, smp ? { ...smp, byTier: by.get(id) ?? {} } : smp])) : m;
    const opp = applyOpponentStrength({
      rb,
      wr: withSplits(wr, splits?.all),
      wrCore: withSplits(wrCore, splits?.core),
      teRoute,
      teBlock,
    });
    // Breakdown slices come back as one record per prospect; split each slice
    // out into its own column map.
    const sliceCol = <K extends string>(m: Map<string, Record<K, AESlice>>, k: K) =>
      new Map([...m].map(([id, s]) => [id, s[k].ae]));
    const qbSlices = computeQBThrowSliceAAE(prospects, games, qbPlays);
    const rbSlices = computeRBRunSliceSRAE(prospects, games, rbPlays);
    return {
      aeMaps: {
        aae: aeValues(qb),
        srae: aeValues(rb),
        sae,
        csae,
        te_saer: aeValues(teRoute),
        te_saeb: aeValues(teBlock),
        aae_out: sliceCol(qbSlices, "outside"),
        aae_in: sliceCol(qbSlices, "inside"),
        aae_deep: sliceCol(qbSlices, "deep"),
        aae_mid: sliceCol(qbSlices, "intermediate"),
        aae_short: sliceCol(qbSlices, "short"),
        srae_out: sliceCol(rbSlices, "outside"),
        srae_in: sliceCol(rbSlices, "inside"),
        srae_zone: sliceCol(rbSlices, "zone"),
        srae_mg: sliceCol(rbSlices, "man_gap"),
      },
      composite: buildAEComposite({ qb, rb: opp.rb, wr: opp.wr, wrCore: opp.wrCore, teRoute: opp.teRoute, teBlock: opp.teBlock }),
      opponent: opp.effects,
    };
  }, [prospects, games, rbPlays, qbPlays, tePlays, gameTiers, gameRouteCells]);

  // Each prospect's charted games by opponent tier, for the AE Score tooltip.
  const gamesByTier = useMemo(() => {
    const m = new Map<string, Record<OpponentTier, number>>();
    for (const g of games) {
      const t = gameTiers.byGame.get(g.id);
      if (!t) continue;
      const r = m.get(g.prospect_id) ?? { P4: 0, G5: 0, FCS: 0 };
      r[t]++;
      m.set(g.prospect_id, r);
    }
    return m;
  }, [games, gameTiers]);

  // AE Score per prospect: the saved lock once the draft class is drafted
  // (lib/scouting/scoreLock.ts), else the live score.
  const scoreViews = useMemo(() => {
    const now = new Date();
    const m = new Map<string, ScoreView>();
    for (const p of prospects) {
      const lock = activeLock(p, now);
      if (lock) { m.set(p.id, { score: lock.score, components: lock.components, lockedAt: lock.locked_at }); continue; }
      const sc = composite.scores.get(p.id);
      if (!sc || !isCompositePos(p.position)) continue;
      const pc = composite.positions[p.position];
      m.set(p.id, {
        score: sc.score,
        components: sc.components.map((c) => ({ ...c, tau: pc.metrics.find((x) => x.key === c.key)?.tau ?? 0 })),
      });
    }
    return m;
  }, [prospects, composite]);

  // Freeze each drafted prospect's AE Score the first time it's scored, once
  // every lazy input has landed. One attempt per prospect per visit: if the
  // write fails (migration 059 not applied), the prospect is just scored live.
  const lockAttemptedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!scoresReady || !onLockAEScore) return;
    const now = new Date();
    const toLock = prospects.filter((p) =>
      classDraftedBy(p.draft_class_year, now) && !p.ae_score_lock && !lockAttemptedRef.current.has(p.id)
      && isCompositePos(p.position) && composite.scores.has(p.id));
    if (toLock.length === 0) return;
    for (const p of toLock) lockAttemptedRef.current.add(p.id);
    void (async () => {
      for (const p of toLock) {
        const pos = p.position as CompositePos;
        await onLockAEScore(p.id, makeLock(composite.scores.get(p.id)!, composite.positions[pos], now));
      }
    })();
  }, [scoresReady, prospects, composite, onLockAEScore]);

  const [boardTab, setBoardTab] = useState<BoardTab>("all");
  // All board sorts by overall_rank; position boards sort by personal_rank
  const [sortKey, setSortKey] = useState<SortKey>("overall_rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const [editingRankId, setEditingRankId] = useState<string | null>(null);
  const [rankInput, setRankInput] = useState("");
  const [savingRankId, setSavingRankId] = useState<string | null>(null);

  // Grade editing is keyed by (id, field) because a row has two gradeable
  // cells — keying by id alone would open both at once.
  const [editingGrade, setEditingGrade] = useState<{ id: string; field: GradeField } | null>(null);
  const [gradeInput, setGradeInput] = useState("");
  const [savingGradeId, setSavingGradeId] = useState<string | null>(null);

  // The Round column used to keep a per-device projected round in
  // localStorage ("nflDraftRound", or rounds inside the older "nflDraftInfo"
  // map). It now reads and writes prospects.draft_round, so a round is the same
  // on every device and feeds Dynasty Score Plus. This moves any old local
  // rounds into the database once. A prospect that already has a database
  // round keeps it. Written entries leave localStorage; a failed write stays
  // for the next visit. "nflDraftInfo" is left alone: the Rookie Big Board
  // keeps its own Sleeper-id entries under that key.
  const migratedRoundsRef = useRef(false);
  useEffect(() => {
    if (loading || prospects.length === 0 || migratedRoundsRef.current) return;
    migratedRoundsRef.current = true;
    const direct = getLocalStorageItem<Record<string, number>>("nflDraftRound", {});
    const local: Record<string, number> = { ...direct };
    if (Object.keys(direct).length === 0) {
      const legacy = getLocalStorageItem<Record<string, { round?: number | null }>>("nflDraftInfo", {});
      for (const [id, v] of Object.entries(legacy)) if (v && typeof v.round === "number") local[id] = v.round;
    }
    const byId = new Map(prospects.map((p) => [p.id, p]));
    const pending = Object.entries(local).filter(([id, rd]) =>
      byId.get(id)?.draft_round == null && byId.has(id) && DRAFT_ROUND_CHOICES.includes(rd));
    if (pending.length === 0 && Object.keys(direct).length === 0) return;
    void (async () => {
      const keep: Record<string, number> = {};
      for (const [id, rd] of pending) if (!(await onUpdateDraftRound(id, rd))) keep[id] = rd;
      setLocalStorageItem("nflDraftRound", keep);
    })();
  }, [loading, prospects, onUpdateDraftRound]);

  // Age: the birthday when there is one, else estimated from the 247 HS class
  // year (prospectAge.ts). The estimate covers 2027-28 prospects, whose
  // birthdates no public source carries.
  const { matchProspect } = useRecruitIndex();
  const hsClass = useMemo(
    () => new Map(prospects.map((p) => [p.id, matchProspect(p)?.year ?? null])),
    [prospects, matchProspect],
  );
  const ages = useMemo(() => {
    const now = new Date();
    const m = new Map<string, ProspectAge>();
    for (const p of prospects) {
      const a = prospectAgeAt(now, p.birthday, hsClass.get(p.id));
      if (a) m.set(p.id, a);
    }
    return m;
  }, [prospects, hsClass]);

  const [weights, setWeights] = useState<DynastyWeights>(() => ({
    ...DEFAULT_DYNASTY_WEIGHTS,
    ...getLocalStorageItem<Partial<DynastyWeights>>(DYNASTY_WEIGHTS_KEY, {}),
  }));
  function setWeight(key: keyof DynastyWeights, value: number) {
    const next = { ...weights, [key]: value };
    setWeights(next);
    setLocalStorageItem(DYNASTY_WEIGHTS_KEY, next);
  }

  // Dynasty Score (+ Plus) for every prospect with an AE Score.
  const dynasty = useMemo(() => {
    const m = new Map<string, DynastyBreakdown>();
    for (const p of prospects) {
      const sc = scoreViews.get(p.id);
      if (!sc || !isCompositePos(p.position)) continue;
      m.set(p.id, scoreDynasty({
        pos: p.position,
        aeScore: sc.score,
        rookieAge: rookieSeasonAge(p.draft_class_year, p.birthday, hsClass.get(p.id)),
        heightIn: parseHeightInches(p.height),
        weightLb: p.weight,
        draftRound: p.draft_round,
      }, weights));
    }
    return m;
  }, [prospects, scoreViews, hsClass, weights]);
  const sortCtx = useMemo<SortContext>(
    () => ({ aeScores: scoreViews, dynasty, ages }),
    [scoreViews, dynasty, ages],
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => {
    const s = new Set(prospects.map((p) => p.draft_class_year));
    return Array.from(s).sort((a, b) => a - b);
  }, [prospects]);

  const sorted = useMemo(() => {
    let list = prospects;
    if (boardTab !== "all") list = list.filter((p) => p.position === boardTab);
    if (draftYearFilter) list = list.filter((p) => p.draft_class_year === draftYearFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const va = getSortValue(a, sortKey, aeMaps, sortCtx);
      const vb = getSortValue(b, sortKey, aeMaps, sortCtx);
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number")
        return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [prospects, boardTab, draftYearFilter, search, sortKey, sortDir, aeMaps, sortCtx]);

  useEffect(() => {
    const table = tableScrollRef.current;
    if (!table || !topSpacerRef.current) return;
    topSpacerRef.current.style.width = `${table.scrollWidth}px`;
    const ro = new ResizeObserver(() => {
      if (topSpacerRef.current) topSpacerRef.current.style.width = `${table.scrollWidth}px`;
    });
    ro.observe(table);
    return () => ro.disconnect();
  }, [sorted]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    // AE columns and the Composite scores open best-first; every other column
    // opens ascending.
    else { setSortKey(k); setSortDir(k.startsWith("ae_") || k.startsWith("dynasty") ? "desc" : "asc"); }
  }

  function th(label: string, key: SortKey, cls = "", title?: string) {
    const active = sortKey === key;
    return (
      <th
        key={key}
        title={title}
        onClick={() => toggleSort(key)}
        className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none ${
          active ? "text-blue-400" : "text-slate-500"
        } ${cls}`}
      >
        {label}{active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  function stickyTh(label: string, key: SortKey, leftPx: number, widthPx: number) {
    const active = sortKey === key;
    return (
      <th
        key={key}
        onClick={() => toggleSort(key)}
        style={{ left: leftPx, minWidth: widthPx, width: widthPx }}
        className={`sticky z-20 bg-slate-950 px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none border-r border-slate-800 ${
          active ? "text-blue-400" : "text-slate-500"
        }`}
      >
        {label}{active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  // ── Above-Expected cell renderer ──────────────────────────────
  // Color-coded green/red on sign. A metric that doesn't apply to the row's
  // position stays blank, so "—" keeps meaning "applies, but under the sample
  // floor". `cls` carries the column's border so cells line up with headers.
  function aeCell(p: ProspectWithStats, col: AEColumn, cls: string) {
    if (p.position !== col.pos) return <td key={col.key} className={`${tdBase} ${cls}`} />;
    const v = aeMaps[col.key].get(p.id);
    if (v == null) {
      return <td key={col.key} className={`${tdBase} text-slate-600 ${cls}`}>—</td>;
    }
    const color = v >= 0 ? "text-emerald-400" : "text-red-400";
    return (
      <td key={col.key} className={`${tdBase} ${color} font-medium ${cls}`}>
        {v >= 0 ? "+" : ""}{v.toFixed(1)}
      </td>
    );
  }

  // ── AE Score cell ─────────────────────────────────────────────
  // "—" for a prospect under the position's sample floor, or at a position
  // without enough charted prospects to join the score yet; the tooltip says
  // which. A scored cell's tooltip walks through the math.
  function scoreCell(p: ProspectWithStats) {
    const cls = `${tdBase} border-l border-slate-800`;
    if (!isCompositePos(p.position)) return <td className={cls} />;
    const pc = composite.positions[p.position];
    const primary = pc.metrics[0];
    const sc = scoreViews.get(p.id);
    if (!sc) {
      const why = pc.ready
        ? `Under the ${primary.label} sample floor`
        : primary.qualified >= MIN_POOL
          ? `${p.position}s are out of the AE Score: their ${primary.label}s don't spread more than sample noise yet`
          : `${p.position}s join the AE Score once ${MIN_POOL} clear the ${primary.label} sample floor (${primary.qualified} now)`;
      return <td className={`${cls} text-slate-600`} title={why}>—</td>;
    }
    const lines = sc.components.map((c) => {
      const ae = c.rawAe != null
        ? `${signed(c.rawAe, 1)} (${signed(c.ae - c.rawAe, 1)} for opponents) = ${signed(c.ae, 1)}`
        : signed(c.ae, 1);
      return `${c.label} ${ae} on ${c.n} ${SAMPLE_UNIT[c.key] ?? "plays"} · ` +
        `${Math.round(c.reliability * 100)}% taken as real · ${p.position} spread ±${c.tau.toFixed(1)} → ${signed(c.z, 2)}`;
    });
    if (sc.lockedAt) lines.push(`Locked ${new Date(sc.lockedAt).toLocaleDateString()}: the ${p.draft_class_year} class has been drafted, so later charting won't move it`);
    const mix = gamesByTier.get(p.id);
    if (mix && p.position !== "QB") lines.push(`Charted opponents: ${mix.P4} P4 · ${mix.G5} G5 · ${mix.FCS} FCS`);
    const title = [`${signed(sc.score, 2)} true-talent SDs vs the average charted ${p.position}`, ...lines].join("\n");
    const color = sc.score >= 0 ? "text-emerald-400" : "text-red-400";
    return (
      <td className={`${cls} ${color} font-semibold`} title={title}>
        {signed(sc.score, 2)}
        {sc.lockedAt && <span className="ml-0.5 text-[9px] opacity-70" aria-label="locked">🔒</span>}
      </td>
    );
  }

  // ── Dynasty / Dynasty Plus cells ──────────────────────────────
  // "—" without an AE Score (the skill base), or for Plus before a round is
  // set. The tooltip walks through each piece at the current slider weights.
  function dynastyCell(p: ProspectWithStats, plus: boolean) {
    const cls = `${tdBase} ${plus ? "border-r border-slate-800" : ""}`;
    if (!isCompositePos(p.position)) return <td className={cls} />;
    const d = dynasty.get(p.id);
    if (!d) return <td className={`${cls} text-slate-600`} title="Needs an AE Score first">—</td>;
    if (plus && d.plus == null) {
      return <td className={`${cls} text-slate-600`} title="Set the NFL draft round to see Dynasty Score Plus">—</td>;
    }
    const pos = p.position;
    const lines = [`AE Score ${signed(d.aeScore, 2)}`];
    if (d.rookieAge && d.window != null) {
      const left = Math.max(0, PRIME_END_AGE[pos] - d.rookieAge.years);
      lines.push(
        `Age ${d.rookieAge.years.toFixed(1)} as a rookie${d.rookieAge.estimated ? " (est. from HS class)" : ""}: ` +
        `${left.toFixed(1)} prime seasons left vs ${PRIME_END_AGE[pos] - REFERENCE_ROOKIE_AGE} typical → ${signed(weights.age * d.window, 2)}`,
      );
    } else {
      lines.push("Age unknown → +0.00");
    }
    if (d.flags.length) for (const f of d.flags) lines.push(`Size: ${f.label} → ${signed(weights.size * f.value, 2)}`);
    else lines.push("Size: no flag → +0.00");
    lines.push(`= Dynasty ${signed(d.dynasty, 2)}`);
    if (plus && d.draftCapital != null) {
      lines.push(`Drafted: ${draftRoundLabel(p.draft_round!)} → ${signed(weights.draft * d.draftCapital, 2)}`);
      lines.push(`= Dynasty+ ${signed(d.plus!, 2)}`);
    }
    const v = plus ? d.plus! : d.dynasty;
    const color = v >= 0 ? "text-emerald-400" : "text-red-400";
    return <td className={`${cls} ${color} font-semibold`} title={lines.join("\n")}>{signed(v, 2)}</td>;
  }
  const dynastyTooltip =
    "Dynasty Score: the AE Score plus a career-window adjustment for age (prime seasons left at rookie " +
    `age vs a typical ${REFERENCE_ROOKIE_AGE}-year-old rookie; primes end RB ${PRIME_END_AGE.RB}, WR ${PRIME_END_AGE.WR}, ` +
    `TE ${PRIME_END_AGE.TE}, QB ${PRIME_END_AGE.QB}) and size (RB and WR pounds per inch of height vs the position's typical, plus WRs under 175 lb). Weighted by the sliders.`;
  const dynastyPlusTooltip =
    "Dynasty Score Plus: the Dynasty Score plus draft capital (initial opportunity), from 1st round +2.0 " +
    "to Undrafted −2.0 at the default 2× weight. Shows once the NFL draft round is set.";

  // Each position's true spread, or how far it is from joining the score.
  const compositeStatus = COMPOSITE_POS.map((pos) => {
    const pc = composite.positions[pos];
    const m = pc.metrics[0];
    if (pc.ready) return `${pos} ±${m.tau!.toFixed(1)} pts (${m.qualified})`;
    return m.qualified >= MIN_POOL ? `${pos} out, no spread beyond noise (${m.qualified})` : `${pos} joins at ${MIN_POOL} (${m.qualified} now)`;
  }).join(" · ");
  // Opponent-strength status: how much easier a G5 / FCS rep counts, by
  // position, and any opponent names that couldn't be matched to a team.
  const pts = (x: number) => (x * 100).toFixed(1);
  const effectText = (pos: "WR" | "TE" | "RB") => {
    const e = opponent[pos];
    if (e.source === "none") return null;
    const size = e.effects.G5 === e.effects.FCS ? `${pts(e.effects.G5)}` : `G5 ${pts(e.effects.G5)} / FCS ${pts(e.effects.FCS)}`;
    const how = e.source === "measured" ? `measured, ${e.prospects} players` : e.source;
    return `${pos} −${size} pts per G5/FCS rep (${how})`;
  };
  const opponentStatus = !gameRouteCells
    ? "waiting on the per-game WR route data (migration 058)"
    : [effectText("WR"), effectText("TE"), effectText("RB"), "QB not adjusted"].filter(Boolean).join(" · ") || "not enough games vs G5/FCS yet";
  const unrecognized = [...gameTiers.unrecognized].map(([name, n]) => `${name}${n > 1 ? ` (${n})` : ""}`);

  const compositeTooltip =
    "AE Score: each prospect's headline Above-Expected, discounted for sample size and put in " +
    "true-talent SDs vs the average charted prospect at the position, so it compares across " +
    "positions. WR blends cSAE 70% and SAE 30%; TE blends TE-SAER 80% and TE-SAEB 20%. " +
    "Reps against G5 and FCS opponents are discounted (the AE columns are not). " +
    `True spread: ${compositeStatus}.`;

  const rankUpdater = boardTab === "all" ? onUpdateOverallRank : onUpdateRank;
  const rankField = (p: ProspectWithStats) => boardTab === "all" ? p.overall_rank : p.personal_rank;

  async function commitRank(id: string) {
    const nr = parseInt(rankInput, 10);
    if (!rankInput || isNaN(nr) || nr < 1) { setEditingRankId(null); return; }
    setSavingRankId(id);
    await rankUpdater(id, nr);
    setSavingRankId(null);
    setEditingRankId(null);
  }

  // ── Grade cells (pre-draft / post-draft, 1.0-100.0) ──────────
  // Click to edit, Enter or blur to commit, Escape to cancel, empty to clear
  // back to ungraded. Parsing, clamping and the one-decimal rounding all live
  // in lib/scouting/prospectGrade, so whatever is written already satisfies the
  // numeric(4,1) 1-100 CHECK on the column rather than bouncing off it.
  async function commitGrade(id: string, field: GradeField, current: number | null) {
    const parsed = parseGrade(gradeInput);
    setEditingGrade(null);
    // undefined = unparseable text; equal value = nothing to write.
    if (parsed === undefined || parsed === current) return;
    setSavingGradeId(id);
    await onUpdateGrade(id, field, parsed);
    setSavingGradeId(null);
  }

  function gradeCell(p: ProspectWithStats, field: GradeField) {
    const value = p[field];
    const isEditing = editingGrade?.id === p.id && editingGrade.field === field;
    const label = field === "pre_draft_grade" ? "Pre-draft" : "Post-draft";
    const tier = gradeTier(value);
    return (
      <td
        className={`${tdBase} border-r border-slate-800`}
        onClick={(e) => {
          e.stopPropagation();
          setEditingGrade({ id: p.id, field });
          setGradeInput(value != null ? `${value}` : "");
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* The editor is type=text, not number: a number input reports "" for a
            half-typed "88.", so mirroring e.target.value into state loses the
            decimal mid-entry and a blur right then would clear the grade. */}
        {isEditing ? (
          <input
            autoFocus type="text" inputMode="decimal"
            aria-label={`${label} grade for ${p.name} (${GRADE_MIN}-${GRADE_MAX})`}
            className="w-14 px-0.5 py-0.5 bg-slate-800 border border-blue-500 rounded text-white font-semibold text-xs focus:outline-none text-center"
            value={gradeInput}
            onChange={(e) => setGradeInput(e.target.value)}
            onBlur={() => commitGrade(p.id, field, value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitGrade(p.id, field, value);
              if (e.key === "Escape") setEditingGrade(null);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            title={tier ? `${tier.label} (${gradeTierRange(tier)})` : undefined}
            className={`cursor-text hover:bg-slate-800 px-1 rounded font-semibold ${gradeColor(value)} ${savingGradeId === p.id ? "animate-pulse" : ""}`}
          >
            {formatGrade(value)}
          </span>
        )}
      </td>
    );
  }

  // How far the landing spot moved him: post - pre, blank until both exist.
  function gradeDeltaCell(p: ProspectWithStats) {
    const d = gradeDelta(p.pre_draft_grade, p.post_draft_grade);
    if (d == null) return <td className={`${tdBase} text-slate-600 border-r border-slate-800`}>—</td>;
    const color = d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-slate-400";
    return (
      <td className={`${tdBase} border-r border-slate-800 font-medium ${color}`}>
        {d > 0 ? "+" : ""}{d.toFixed(1)}
      </td>
    );
  }

  // NFL Draft cell: the round the player was drafted in (1st–7th or
  // Undrafted), saved to prospects.draft_round. "—" clears it.
  function draftCell(p: ProspectWithStats) {
    const rd = p.draft_round;
    return (
      <td
        className="px-1.5 py-1 text-center whitespace-nowrap border-r border-slate-800"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <select
          aria-label={`NFL draft round for ${p.name}`}
          value={rd ?? ""}
          onChange={(e) => { void onUpdateDraftRound(p.id, e.target.value ? Number(e.target.value) : null); }}
          className={`bg-slate-950 text-xs rounded px-1 py-0.5 cursor-pointer focus:outline-none border ${
            rd == null ? "text-slate-600 border-transparent hover:border-slate-700"
              : rd === UNDRAFTED_ROUND ? "text-slate-400 font-medium border-slate-700"
              : "text-indigo-300 font-medium border-indigo-700/50"
          }`}
        >
          <option value="">—</option>
          {DRAFT_ROUND_CHOICES.map((r) => (
            <option key={r} value={r}>{draftRoundLabel(r)}</option>
          ))}
        </select>
      </td>
    );
  }

  async function handleDrop(targetId: string, targetIndex: number) {
    if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return; }
    const draggedP = prospects.find((p) => p.id === draggingId);
    const targetP = prospects.find((p) => p.id === targetId);
    if (!draggedP || !targetP) return;
    setSavingRankId(draggingId);
    // Fall back to the TARGET row's own on-screen position (not the dragged
    // item's rank) when the target is unranked — using the dragged item's own
    // rank here made dropping onto an unranked row a silent no-op, since that
    // "fallback" was just re-assigning the dragged item its existing rank.
    await rankUpdater(draggingId, rankField(targetP) ?? targetIndex + 1);
    setSavingRankId(null);
    setDraggingId(null);
    setDragOverId(null);
  }

  const tdBase = "px-1.5 py-1.5 text-center whitespace-nowrap text-xs";

  // Shared sticky row cells (drag handle + rank + name)
  function stickyRowCells(p: ProspectWithStats) {
    const isSaving = savingRankId === p.id;
    const rank = rankField(p);
    return (
      <>
        <td className="sticky left-0 z-10 bg-slate-950 px-1 text-slate-700 cursor-grab active:cursor-grabbing text-center w-6"
          onClick={(e) => e.stopPropagation()}>⠿</td>
        <td style={{ left: 24, minWidth: 44, width: 44 }}
          className="sticky z-10 bg-slate-950 border-r border-slate-800 text-center"
          onClick={(e) => { e.stopPropagation(); setEditingRankId(p.id); setRankInput(rank ? `${rank}` : ""); }}>
          {editingRankId === p.id ? (
            <input autoFocus type="number" min={1}
              className="w-10 px-0.5 py-0.5 bg-slate-800 border border-blue-500 rounded text-yellow-400 font-bold text-xs focus:outline-none text-center"
              value={rankInput}
              onChange={(e) => setRankInput(e.target.value)}
              onBlur={() => commitRank(p.id)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRank(p.id); if (e.key === "Escape") setEditingRankId(null); }}
              onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className={`cursor-text hover:bg-slate-800 px-1 rounded text-yellow-400 font-bold ${isSaving ? "animate-pulse" : ""}`}>
              {rank ? `#${rank}` : "—"}
            </span>
          )}
        </td>
        <td style={{ left: 68, minWidth: 140, width: 140 }}
          className="sticky z-10 bg-slate-950 border-r border-slate-800 px-1.5 py-1.5 text-center text-white font-medium whitespace-nowrap">
          {p.name}
        </td>
      </>
    );
  }

  function rowProps(p: ProspectWithStats, i: number) {
    const isDragging = draggingId === p.id;
    const isDragOver = dragOverId === p.id;
    const rowBg = isDragOver ? "bg-blue-900/30" : i % 2 === 0 ? "bg-slate-950" : "bg-slate-900/30";
    return {
      draggable: true,
      onDragStart: () => setDraggingId(p.id),
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverId(p.id); },
      onDragLeave: () => setDragOverId(null),
      onDrop: () => handleDrop(p.id, i),
      onDragEnd: () => { setDraggingId(null); setDragOverId(null); },
      onClick: () => onSelectProspect(p),
      className: `cursor-pointer transition hover:bg-slate-800/60 ${isDragging ? "opacity-40" : ""} ${isDragOver ? "border-t-2 border-blue-500" : ""} ${rowBg}`,
    };
  }

  const scrollWrapper = (tableNode: React.ReactNode) => (
    <div className="mx-auto w-fit max-w-full">
      <div
        ref={topScrollRef}
        className="overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
        onScroll={() => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = topScrollRef.current!.scrollLeft; }}
      >
        <div ref={topSpacerRef} style={{ height: 1 }} />
      </div>
      <div
        ref={tableScrollRef}
        className="overflow-x-auto rounded border border-slate-800 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
        onScroll={() => { if (topScrollRef.current) topScrollRef.current.scrollLeft = tableScrollRef.current!.scrollLeft; }}
      >
        {tableNode}
      </div>
    </div>
  );

  // ── Unified board (All + each position tab) ────────────────
  // Every tab shares this layout. The All tab adds a Pos column and ranks by
  // overall_rank (OVR), showing PosRk as a read-only readout; each position tab
  // ranks by personal_rank (POS), showing OVR as the read-only readout. The
  // Above Exp group shows every headline AE column on All; a position tab shows
  // its own headline columns plus its breakdown group (QB, RB).
  function renderStandardTable() {
    const isAll = boardTab === "all";
    const primaryLabel = isAll ? "OVR" : "POS";
    const primaryKey: SortKey = isAll ? "overall_rank" : "personal_rank";
    const secondaryLabel = isAll ? "PosRk" : "OVR";
    const secondaryGroup = isAll ? "Pos Rank" : "OVR";
    const secondaryKey: SortKey = isAll ? "personal_rank" : "overall_rank";
    const secondaryValue = (p: ProspectWithStats) => (isAll ? p.personal_rank : p.overall_rank);
    const identitySpan = isAll ? 6 : 5; // Pos column shows only on the All tab
    const aeCols = isAll
      ? AE_COLUMNS.filter((c) => !c.breakdown)
      : AE_COLUMNS.filter((c) => c.pos === boardTab);
    // A border opens each position's cluster and each header band (and closes
    // the last), so WR's and TE's pairs read as one group on the All tab and a
    // breakdown sits apart from its headline metric.
    const aeBorder = aeCols.map((c, i) => {
      const prev = aeCols[i - 1];
      const first = !prev || prev.pos !== c.pos || prev.group !== c.group;
      const last = i === aeCols.length - 1;
      return `${first ? "border-l border-slate-800" : ""} ${last ? "border-r border-slate-800" : ""}`;
    });
    // Header bands: one cell per run of consecutive columns sharing a group.
    const aeGroups: { group: AEColumn["group"]; span: number }[] = [];
    for (const c of aeCols) {
      const g = aeGroups[aeGroups.length - 1];
      if (g?.group === c.group) g.span++;
      else aeGroups.push({ group: c.group, span: 1 });
    }
    return scrollWrapper(
      <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
        <thead>
          <tr className="border-b border-slate-700 bg-slate-950">
            <th className="sticky left-0 z-20 bg-slate-950 w-6" />
            <th style={{ left: 24, minWidth: 44 }} className="sticky z-20 bg-slate-950" />
            <th style={{ left: 68, minWidth: 140 }} className="sticky z-20 bg-slate-950 border-r border-slate-800" />
            <th colSpan={3} className="px-2 py-1 text-center text-amber-900 font-medium border-r border-slate-800">Grade</th>
            <th colSpan={1} className="px-2 py-1 text-center text-indigo-900 font-medium border-r border-slate-800">NFL Draft</th>
            <th colSpan={1} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">{secondaryGroup}</th>
            <th colSpan={identitySpan} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">Identity</th>
            <th colSpan={3} className="px-2 py-1 text-center text-teal-900 font-medium border-r border-slate-800">Composite</th>
            {aeGroups.map((g) => (
              <th key={g.group} colSpan={g.span} className="px-2 py-1 text-center text-emerald-900 font-medium border-r border-slate-800 whitespace-nowrap">{g.group}</th>
            ))}
          </tr>
          <tr className="border-b border-slate-800 bg-slate-950">
            <th className="sticky left-0 z-20 bg-slate-950 w-6 text-slate-700 text-center px-1">⠿</th>
            {stickyTh(primaryLabel, primaryKey, 24, 44)}
            {stickyTh("Name", "name", 68, 140)}
            {th("Pre", "pre_draft_grade", "border-l border-slate-800 text-amber-700")}
            {th("Post", "post_draft_grade", "text-amber-700")}
            {th("Δ", "grade_delta", "border-r border-slate-800 text-amber-700")}
            <th className="px-1.5 py-1.5 text-center text-indigo-700 whitespace-nowrap text-xs border-r border-slate-800 select-none">Round</th>
            {th(secondaryLabel, secondaryKey, "border-l border-r border-slate-800 text-slate-400")}
            {isAll && th("Pos", "position", "border-l border-slate-800")}
            {th("School", "school", isAll ? "" : "border-l border-slate-800")}
            {th("Yr", "draft_class_year")}
            {th("Age", "age")}
            {th("Ht", "height")}
            {th("Wt", "weight", "border-r border-slate-800")}
            {th("AE Score", "ae_score", "border-l border-slate-800 text-teal-600", compositeTooltip)}
            {th("Dynasty", "dynasty", "text-teal-600", dynastyTooltip)}
            {th("Dynasty+", "dynasty_plus", "border-r border-slate-800 text-teal-600", dynastyPlusTooltip)}
            {aeCols.map((c, i) => th(c.label, `ae_${c.key}`, `${aeBorder[i]} text-emerald-700`, c.tooltip))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-900">
          {sorted.map((p, i) => {
            const age = ages.get(p.id);
            const sv = secondaryValue(p);
            return (
              <tr key={p.id} {...rowProps(p, i)}>
                {stickyRowCells(p)}
                {gradeCell(p, "pre_draft_grade")}
                {gradeCell(p, "post_draft_grade")}
                {gradeDeltaCell(p)}
                {draftCell(p)}
                <td className={`${tdBase} text-slate-500 border-l border-r border-slate-800`}>{sv ? `#${sv}` : "—"}</td>
                {isAll && (
                  <td className={`${tdBase} font-semibold border-l border-slate-800 ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</td>
                )}
                <td className={`${tdBase} text-slate-400 ${isAll ? "" : "border-l border-slate-800"}`}>{p.school}</td>
                <td className={`${tdBase} text-slate-400`}>{p.draft_class_year}</td>
                <td className={`${tdBase} text-slate-400`} title={age?.estimated ? "Estimated from the HS class year" : undefined}>
                  {age ? `${age.estimated ? "~" : ""}${Math.floor(age.years)}` : "—"}
                </td>
                <td className={`${tdBase} text-slate-400`}>{p.height || "—"}</td>
                <td className={`${tdBase} text-slate-400 border-r border-slate-800`}>{p.weight ?? "—"}</td>
                {scoreCell(p)}
                {dynastyCell(p, false)}
                {dynastyCell(p, true)}
                {aeCols.map((c, i) => aeCell(p, c, aeBorder[i]))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const BOARD_TABS: { key: BoardTab; label: string; accent: string }[] = [
    { key: "all",  label: "All",  accent: "border-slate-400 text-slate-300" },
    { key: "QB",   label: "QB",   accent: "border-blue-500 text-blue-400" },
    { key: "RB",   label: "RB",   accent: "border-green-500 text-green-400" },
    { key: "WR",   label: "WR",   accent: "border-yellow-500 text-yellow-400" },
    { key: "TE",   label: "TE",   accent: "border-orange-500 text-orange-400" },
  ];

  return (
    <div>
      {/* Position board tabs */}
      <div className="flex justify-center gap-1 mb-4 border-b border-slate-800">
        {BOARD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setBoardTab(t.key); setSortKey(t.key === "all" ? "overall_rank" : "personal_rank"); setSortDir("asc"); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              boardTab === t.key ? t.accent : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="ml-1.5 text-xs text-slate-600">
                {prospects.filter((p) => p.position === t.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
        <input
          className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48"
          placeholder="Search name / school…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-slate-400">Class:</span>
        <button
          onClick={() => setDraftYearFilter(null)}
          className={`px-3 py-1 rounded text-xs font-medium transition ${!draftYearFilter ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
        >All</button>
        {years.map((y) => (
          <button key={y} onClick={() => setDraftYearFilter(y)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${draftYearFilter === y ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >{y}</button>
        ))}
        <span className="text-xs text-slate-500">{sorted.length} prospects</span>
      </div>
      {/* Grade tier legend — the colours the Pre / Post grade cells use. */}
      <ul aria-label="Grade tiers" className="flex flex-wrap justify-center gap-x-4 gap-y-1 mb-2 text-xs">
        {GRADE_TIERS.map((t) => (
          <li key={t.label} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${t.swatch}`} />
            <span className={`font-semibold ${t.text}`}>{t.label}</span>
            <span className="text-slate-500">{gradeTierRange(t)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600 mb-2 text-center">Drag rows to reorder · Click rank or a grade to edit (1.0–100.0) · Click any column header to sort</p>
      <p className="text-xs text-slate-600 mb-2 text-center">AE Score true spread: {compositeStatus}</p>
      <p className="text-xs text-slate-600 mb-2 text-center">
        Opponent strength (scores only): {opponentStatus}
        {unrecognized.length > 0 && <span className="text-amber-700"> · Unrecognized opponents: {unrecognized.join(", ")}</span>}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-3 text-xs text-slate-400">
        <span className="text-slate-500">Dynasty weights</span>
        {WEIGHT_SLIDERS.map((w) => (
          <label key={w.key} className="flex items-center gap-1.5" title={w.hint}>
            <span>{w.label}</span>
            <input
              type="range" min={WEIGHT_MIN} max={WEIGHT_MAX} step={WEIGHT_STEP}
              value={weights[w.key]}
              onChange={(e) => setWeight(w.key, Number(e.target.value))}
              aria-label={`${w.label} weight`}
              className="w-20 accent-teal-500"
            />
            <span className="w-9 tabular-nums text-slate-300">{weights[w.key].toFixed(2)}×</span>
          </label>
        ))}
        <button
          onClick={() => { setWeights(DEFAULT_DYNASTY_WEIGHTS); setLocalStorageItem(DYNASTY_WEIGHTS_KEY, DEFAULT_DYNASTY_WEIGHTS); }}
          className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:bg-slate-700"
        >Reset</button>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm text-center py-12">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-12">No prospects match your filters.</div>
      ) : (
        renderStandardTable()
      )}
    </div>
  );
}
