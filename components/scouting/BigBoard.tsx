"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import type { ProspectWithStats, Prospect, RouteType, ScoutingGame, RBPlay, QBPlay, TEPlay, AEScoreLock } from "../../lib/types";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import {
  buildAEComposite, MIN_POOL,
  QB_FULL_TRUST, RB_FULL_TRUST, WR_ALL_FULL_TRUST, WR_CORE_FULL_TRUST, POSITION_BASELINE,
} from "../../lib/scouting/aeComposite";
import {
  PRIME_END_AGE, REFERENCE_ROOKIE_AGE,
  WEIGHT_MIN, WEIGHT_MAX, WEIGHT_STEP,
  type DynastyBreakdown, type DynastyWeights,
} from "../../lib/scouting/dynastyScore";
import { type ProspectAge } from "../../lib/scouting/prospectAge";
import { DRAFT_ROUND_CHOICES, UNDRAFTED_ROUND, draftRoundLabel } from "../../lib/draftRound";
import { classDraftedBy, makeLock } from "../../lib/scouting/scoreLock";
import type { ProspectGameRouteCellsRow } from "../../lib/scouting/aggregateMerge";
import type { MetricContext } from "../../lib/scouting/contextGrading";
import { SEASON_DECAY } from "../../lib/scouting/seasonWeight";
import { POS_COLOR } from "../../lib/uiTheme";
import { levelRuleText, matchFor, noLevelReached, roleFitTooltip, roleLabel, versatileRuleText, type RoleFit } from "../../lib/scouting/roleFit";
import {
  parseGrade, formatGrade, gradeColor, gradeDelta, gradeTier, gradeTierRange,
  GRADE_MIN, GRADE_MAX, GRADE_TIERS, type GradeField,
} from "../../lib/scouting/prospectGrade";
import { fmtVal, type ColDef } from "./stats/StatsTableShell";
import { pffCols, PFF_ALL_TAB_KEY, PFF_BOARD_KEYS } from "./stats/pffCols";
import type { PffTotals, PffValues } from "../../lib/pff/totals";
import { pffPos } from "../../lib/pff/stats";
import { EMPTY_GRADING_DATA, type GradingData } from "../../lib/scouting/aeComponents";
import { traitAverages, traitComponents, traitsFor, TRAIT_WEIGHT, uncoveredTraits, type TraitAverage } from "../../lib/scouting/traits";
import {
  COMPOSITE_HEADLINE, COMPOSITE_POS, isCompositePos, liveScoresFrom, scoreViewsFrom, dynastyScores, aeScoreMissingReason, SAMPLE_UNIT,
  type AEKey, type AEMaps, type ScoreView, type ScoreViewMode,
} from "../../lib/scouting/prospectScores";
import { useProspectScores, useDynastyWeights } from "./shared/hooks/useProspectScores";
import { SAMPLE_TIERS, sampleCeilings, samplePartText, sampleSizes, type SampleSize } from "../../lib/scouting/sampleSize";

type LoadPositionPlaysFn = (pos: "RB" | "QB" | "TE") => void;

type BoardTab = "all" | "QB" | "RB" | "WR" | "TE";

// One column per Above-Expected metric (AEKey, prospectScores.ts). The All tab
// shows every headline column (a row fills only its own position's); a
// position tab shows its own headline metrics plus, for QB and RB, the
// Analysis tables' breakdown columns (`breakdown: true`, never on All). `group`
// is the header band each column sits under. Tooltips match the Analysis
// tables' so the two describe each metric the same way.
interface AEColumn {
  key: AEKey;
  label: string;
  pos: "QB" | "RB" | "WR" | "TE";
  group: "Above Exp" | "AAE Breakdown" | "SRAE Breakdown";
  breakdown?: true;
  tooltip: string;
}
const AE_COLUMNS: AEColumn[] = [
  { key: "aae",     label: "AAE",     pos: "QB", group: "Above Exp", tooltip: "Accuracy Above Expected — each throw judged against throws like it (all situation tags stacked). Min. 25 graded passes. Older seasons count a little less." },
  { key: "srae",    label: "SRAE",    pos: "RB", group: "Above Exp", tooltip: "Success Rate Above Expected — each run judged against runs like it (formation, loaded box, unblocked defender stacked). Min. 15 runs. Older seasons count a little less." },
  { key: "sae",     label: "SAE",     pos: "WR", group: "Above Exp", tooltip: "Success (Open) Rate Above Expected — each route judged against routes like it (route, coverage incl. press, slot/outside, on/off line stacked). Min. 15 routes. Older seasons count a little less." },
  { key: "csae",    label: "cSAE",    pos: "WR", group: "Above Exp", tooltip: "Core-Route SAE — same as SAE, but excludes Go (Nine) and Screen routes. Min. 15 core routes. Older seasons count a little less." },
  { key: "te_saer", label: "TE-SAER", pos: "TE", group: "Above Exp", tooltip: "Route SAE — Open Rate Above Expected, each route judged against routes like it (route, coverage incl. press, positioning stacked). Min. 15 rated routes. Older seasons count a little less." },
  { key: "te_saeb", label: "TE-SAEB", pos: "TE", group: "Above Exp", tooltip: "Block SAE — Block Success Above Expected, each block judged against blocks like it (run/pass, movement/inline, positioning stacked). Min. 15 rated blocks. Older seasons count a little less." },
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

const PFF_BAND_TOOLTIP =
  "PFF's numbers over exactly the games you charted (never season totals). Counts add up game by game; " +
  "rates come from those sums (YPRR = PFF yards ÷ PFF routes); grades are PFF's own grade for those games. " +
  "Import or refresh in Scouting → PFF Links. The results you don't chart yourself (BTT%, TWP%, QB rushing, " +
  "YCO/A, YPRR, YAC) are part of the AE Score; grades aren't.";

const signed = (v: number, dp: number) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

// Live scores, or a drafted class's scores as they stood at the draft
// (lib/scouting/scoreLock.ts). Per browser, a viewing preference.
const SCORE_VIEW_KEY = "bigBoardScoreView";
const SCORE_TRAITS_KEY = "bigBoardScoreTraits";

const TRAIT_AVG_KEY = "trait_avg";
const UNCOVERED_TRAITS_TEXT = (["QB", "RB", "WR", "TE"] as const)
  .map((pos) => [pos, uncoveredTraits(pos).map((t) => t.label.toLowerCase())] as const)
  .filter(([, ts]) => ts.length)
  .map(([pos, ts]) => `${pos} ${ts.join(", ")}`)
  .join("; ");
const TRAITS_BAND_TOOLTIP =
  "Your per-game trait grades (1–10), on games charted since traits began; averaged, older seasons a little less. " +
  "Beside the AE Score: the \"With traits\" toggle adds the traits nothing else measures.";
/** A prospect's mean over his position's graded traits. */
function traitMean(t: Record<string, TraitAverage>, pos: string): number | null {
  const xs = traitsFor(pos).map((x) => t[x.key]?.avg).filter((v): v is number => v != null);
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

const WEIGHT_SLIDERS: { key: keyof DynastyWeights; label: string; hint: string }[] = [
  { key: "age",   label: "Age",   hint: "How much the career window (prime seasons left) counts" },
  { key: "size",  label: "Size",  hint: "How much size counts: RBs and WRs carrying more weight for their height gain, lean and very light ones lose" },
  { key: "draft", label: "Draft", hint: "How much draft round counts in Dynasty Score Plus" },
];

// Derived per-prospect values the sort reads.
interface SortContext {
  aeScores: Map<string, ScoreView>;
  dynasty: Map<string, DynastyBreakdown>;
  ages: Map<string, ProspectAge>;
  roles: Map<string, RoleFit>;
  pff: Map<string, PffValues>;
  traits: Map<string, Record<string, TraitAverage>>;
  samples: Map<string, SampleSize>;
}

type SortKey =
  | "pre_draft_grade" | "post_draft_grade" | "grade_delta"
  | "personal_rank" | "overall_rank" | "sample" | "ae_score" | "dynasty" | "dynasty_plus" | "role" | "name" | "school" | "conference" | "draft_class_year" | "height" | "weight" | "age" | "position"
  | "total_routes" | "total_games" | "targets" | "catches" | "drops" | "contested" | "contested_catches"
  | "success_rate" | "target_rate" | "adj_success_above_exp" | `ae_${AEKey}` | `trait_${string}`
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
  | `pff_${string}`
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
   *  adjustment. Null when the view didn't load. */
  gameRouteCells?: ProspectGameRouteCellsRow[] | null;
  /** Every lazy input has loaded, so a score is safe to freeze. */
  scoresReady?: boolean;
  /** Save a drafted prospect's frozen AE Score; false if the write failed. */
  onLockAEScore?: (id: string, lock: AEScoreLock) => Promise<boolean>;
  /** PFF over each prospect's charted games (ScoutingHub). */
  pffTotals?: Map<string, PffTotals>;
  /** PFF game rows and the migration-064 views, for the AE Score's per-player
   *  components (lib/scouting/aeComponents.ts). */
  gradingData?: GradingData;
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
  // Share of a full sample; a position without one (none charted) sinks both ways.
  if (key === "sample") return ctx.samples.get(p.id)?.share ?? null;
  // Unscored (under the floor, or a position not in the score yet) sinks both ways.
  if (key === "ae_score") return ctx.aeScores.get(p.id)?.score ?? null;
  if (key === "dynasty") return ctx.dynasty.get(p.id)?.dynasty ?? null;
  if (key === "dynasty_plus") return ctx.dynasty.get(p.id)?.plus ?? null;
  // Groups each role together; no role (under the floor) sinks both ways.
  if (key === "role") { const f = ctx.roles.get(p.id); return f ? roleLabel(f) : null; }
  // null, not -BIG: on the All tab most rows have no value for a given AE
  // column (other positions), and the sort sinks those in both directions.
  if (key.startsWith("ae_")) return aeMaps[key.slice(3) as AEKey].get(p.id) ?? null;
  // PFF over the charted games; none sinks both ways.
  if (key.startsWith("pff_")) return ctx.pff.get(p.id)?.[key] ?? null;
  // The user's trait grades (average over graded games); ungraded sinks both ways.
  if (key.startsWith("trait_")) {
    const t = ctx.traits.get(p.id);
    if (!t) return null;
    if (key === TRAIT_AVG_KEY) return traitMean(t, p.position);
    return t[key.slice("trait_".length)]?.avg ?? null;
  }
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
  scoresReady = false,
  onLockAEScore,
  pffTotals,
  gradingData = EMPTY_GRADING_DATA,
}: Props) {
  // Trigger lazy load of all three position plays the first time the
  // board renders. ScoutingHub no-ops if a position is already loaded
  // for the current games key, so this is safe to call repeatedly.
  useEffect(() => {
    loadPositionPlays("RB");
    loadPositionPlays("QB");
    loadPositionPlays("TE");
  }, [loadPositionPlays]);

  // Every score the board shows, computed by the same hook the prospect
  // Overview page uses (lib/scouting/prospectScores.ts), so the two always agree.
  // The AE columns keep the unadjusted values; the AE Score (and the Dynasty
  // scores built on it) take the opponent-strength and context adjustments.
  const {
    aeMaps, composite, compositeInputs, opponent, contextInfo,
    gameTiers, contextCov, liveScores, gamesByTier, defenseFaced, hsClass, ages, roleFits, pffVals,
  } = useProspectScores({ prospects, games, rbPlays, qbPlays, tePlays, gameRouteCells, gradingData, pffTotals });

  const [scoreMode, setScoreMode] = useState<ScoreViewMode>(() =>
    getLocalStorageItem<ScoreViewMode>(SCORE_VIEW_KEY, "live") === "draft" ? "draft" : "live");
  function chooseScoreMode(mode: ScoreViewMode) {
    setScoreMode(mode);
    setLocalStorageItem(SCORE_VIEW_KEY, mode);
  }

  // Traits (the user's per-game 1–10 grades, new games only) sit beside the
  // AE Score. The toggle shows the same scores with the uncovered traits
  // added (traits.ts); off by default, and draft-day snapshots never use it.
  const [withTraits, setWithTraits] = useState<boolean>(() => getLocalStorageItem<boolean>(SCORE_TRAITS_KEY, false) === true);
  function chooseTraits(on: boolean) {
    setWithTraits(on);
    setLocalStorageItem(SCORE_TRAITS_KEY, on);
  }
  const traitAvgs = useMemo(() => traitAverages(prospects, games), [prospects, games]);
  const traitComposite = useMemo(() => {
    if (!withTraits) return null;
    const t = traitComponents(prospects, games);
    const extra = compositeInputs.extra;
    return buildAEComposite({
      ...compositeInputs,
      extra: {
        QB: [...(extra?.QB ?? []), ...t.QB], RB: [...(extra?.RB ?? []), ...t.RB],
        WR: [...(extra?.WR ?? []), ...t.WR], TE: [...(extra?.TE ?? []), ...t.TE],
      },
    });
  }, [withTraits, compositeInputs, prospects, games]);
  const shownComposite = traitComposite ?? composite;

  // The live AE Score: the composite, plus a WR's alignment penalty
  // (alignmentPenalty.ts). The penalty is part of the AE Score, so Dynasty and
  // Dynasty+ carry it. `liveScores` (never with traits, from the hook) is what
  // draft-day snapshots save; `shownLive` follows the traits toggle.
  const shownLive = useMemo(
    () => (traitComposite ? liveScoresFrom(prospects, traitComposite) : liveScores),
    [prospects, traitComposite, liveScores],
  );

  // AE Score per prospect: live, or "As of draft" (prospectScores.ts scoreViewsFrom).
  const scoreViews = useMemo(
    () => scoreViewsFrom(prospects, shownLive, scoreMode, new Date()),
    [prospects, shownLive, scoreMode],
  );

  // Snapshot each drafted prospect's AE Score the first time it's scored, once
  // every lazy input has landed: the draft-day record behind "As of draft".
  // One attempt per prospect per visit; a failed write (migration 059 not
  // applied) just means no snapshot.
  const lockAttemptedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!scoresReady || !onLockAEScore) return;
    const now = new Date();
    const toLock = prospects.filter((p) =>
      classDraftedBy(p.draft_class_year, now) && !p.ae_score_lock && !lockAttemptedRef.current.has(p.id)
      && liveScores.has(p.id));
    if (toLock.length === 0) return;
    for (const p of toLock) lockAttemptedRef.current.add(p.id);
    void (async () => {
      for (const p of toLock) {
        const live = liveScores.get(p.id)!;
        await onLockAEScore(p.id, makeLock({ score: live.score, components: live.components, alignment: live.alignment, baseline: live.baseline }, now));
      }
    })();
  }, [scoresReady, prospects, liveScores, onLockAEScore]);

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


  // The Dynasty sliders, saved per browser; the Overview page reads the same weights.
  const { weights, setWeight, reset: resetWeights } = useDynastyWeights();

  // Dynasty Score (+ Plus) for every prospect with an AE Score.
  const dynasty = useMemo(
    () => dynastyScores(prospects, scoreViews, hsClass, weights),
    [prospects, scoreViews, hsClass, weights],
  );

  // Each prospect's charted sample against the AE Score's full-trust ceilings
  // (sampleSize.ts): the dot beside the rank. Always live, in either score view.
  const samples = useMemo(
    () => sampleSizes(prospects, compositeInputs, composite),
    [prospects, compositeInputs, composite],
  );

  const sortCtx = useMemo<SortContext>(
    () => ({ aeScores: scoreViews, dynasty, ages, roles: roleFits, pff: pffVals, traits: traitAvgs, samples }),
    [scoreViews, dynasty, ages, roleFits, pffVals, traitAvgs, samples],
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
    // AE, PFF and the Composite scores open best-first; every other column
    // opens ascending. (A PFF column where lower is better, e.g. TWP%, opens ascending.)
    else {
      setSortKey(k);
      const pffLowerBetter = k.startsWith("pff_") && pffColumnDefs.find((c) => c.key === k)?.colorDir === -1;
      setSortDir(pffLowerBetter ? "asc" : k === "sample" || k.startsWith("ae_") || k.startsWith("dynasty") || k.startsWith("pff_") || k.startsWith("trait_") ? "desc" : "asc");
    }
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

  function stickyTh(label: string, key: SortKey, leftPx: number, widthPx: number, title?: string, padX = "px-1.5") {
    const active = sortKey === key;
    return (
      <th
        key={key}
        title={title}
        onClick={() => toggleSort(key)}
        style={{ left: leftPx, minWidth: widthPx, width: widthPx }}
        className={`sticky z-20 bg-slate-950 ${padX} py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none border-r border-slate-800 ${
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

  // ── PFF cells ─────────────────────────────────────────────────
  // PFF's numbers over exactly the charted games. "—" says why it's empty.
  function pffCell(p: ProspectWithStats, c: ColDef, cls: string) {
    const v = pffVals.get(p.id)?.[c.key];
    if (v == null) {
      const t = pffTotals?.get(p.id);
      const why = !t ? "No charted games linked to PFF (Scouting → PFF Links)"
        : t.games === 0 ? "PFF stats not imported yet (Scouting → PFF Links)"
        : t.seasonsCurrent < t.seasons ? "PFF stats out of date (a game link changed): refresh in Scouting → PFF Links"
        : "No PFF data for this";
      return <td key={c.key} className={`${tdBase} text-slate-600 ${cls}`} title={why}>—</td>;
    }
    const t = pffTotals?.get(p.id);
    const title = t ? `${c.tooltip ?? c.label} · ${t.games} of ${t.linked} linked charted game${t.linked === 1 ? "" : "s"}` : c.tooltip;
    return <td key={c.key} className={`${tdBase} text-slate-300 ${cls}`} title={title}>{fmtVal(v, c.fmt)}</td>;
  }

  // ── Trait cells ───────────────────────────────────────────────
  // The user's per-game trait grades (1–10, new games only), averaged.
  function traitCell(p: ProspectWithStats, c: ColDef, cls: string) {
    const t = traitAvgs.get(p.id);
    const isAvg = c.key === TRAIT_AVG_KEY;
    const traitKey = c.key.slice("trait_".length);
    if (!isAvg && !traitsFor(p.position).some((x) => x.key === traitKey)) return <td key={c.key} className={`${tdBase} ${cls}`} />;
    const v = t ? (isAvg ? traitMean(t, p.position) : t[traitKey]?.avg ?? null) : null;
    if (v == null) {
      return <td key={c.key} className={`${tdBase} text-slate-600 ${cls}`} title="Not graded yet (new games only: grade traits in the board's Games tab)">—</td>;
    }
    const title = isAvg
      ? traitsFor(p.position).filter((x) => t![x.key]).map((x) => `${x.label} ${t![x.key].avg.toFixed(1)} (${t![x.key].games} g)`).join(" · ")
      : `${t![traitKey].games} graded game${t![traitKey].games === 1 ? "" : "s"}`;
    return <td key={c.key} className={`${tdBase} text-fuchsia-300 ${cls}`} title={title}>{v.toFixed(1)}</td>;
  }

  // ── AE Score cell ─────────────────────────────────────────────
  // "—" for a prospect under the position's sample floor, or at a position
  // without enough charted prospects to join the score yet; the tooltip says
  // which. A scored cell's tooltip walks through the math.
  function scoreCell(p: ProspectWithStats) {
    const cls = `${tdBase} border-l border-slate-800`;
    if (!isCompositePos(p.position)) return <td className={cls} />;
    const sc = scoreViews.get(p.id);
    if (!sc) {
      return <td className={`${cls} text-slate-600`} title={aeScoreMissingReason(shownComposite, p.position)}>—</td>;
    }
    const lines = sc.components.map((c) => {
      // An additive piece (fumbles): added on top, 0 at the pool's rate.
      if (c.additive) {
        return `${c.label} ${c.text ?? signed(c.ae, 2)} · ${Math.round(c.reliability * 100)}% taken as real · ` +
          `added on top: ${c.weight} × ${signed(c.z, 2)} = ${signed(c.weight * c.z, 2)}`;
      }
      // A per-player component (PFF result, charted rate, tag stat): its value
      // as shown, and its weight after trust.
      if (c.perPlayer) {
        return `${c.label} ${c.text ?? signed(c.ae, 2)} · ${Math.round(c.reliability * 100)}% taken as real · ` +
          `weight ${c.weight} × ${Math.round(c.reliability * 100)}% = ${(c.effectiveWeight ?? 0).toFixed(2)} → ${signed(c.z, 2)}`;
      }
      const ctx = contextInfo[COMPOSITE_HEADLINE[c.key] ?? "qb_aae"];
      const what = !COMPOSITE_HEADLINE[c.key] ? "opponents" : ctx.weather ? "opponents and weather" : ctx.opponent === "sp" && ctx.fit ? "opponent defenses" : "opponents";
      const ae = c.rawAe != null
        ? `${signed(c.rawAe, 1)} (${signed(c.ae - c.rawAe, 1)} for ${what}) = ${signed(c.ae, 1)}`
        : signed(c.ae, 1);
      return `${c.label} ${ae} on ${c.n} ${SAMPLE_UNIT[c.key] ?? "plays"} · ` +
        `${Math.round(c.reliability * 100)}% taken as real${fullAt(p.position, c.key)} · ${p.position} spread ±${c.tau.toFixed(1)} → ${signed(c.z, 2)}`;
    });
    if (sc.lockedAt) {
      lines.push(`As of draft: frozen ${new Date(sc.lockedAt).toLocaleDateString()}, the ${p.draft_class_year} class's draft-day score`);
    } else if (sc.atDraft) {
      lines.push(`At draft: ${signed(sc.atDraft.score, 2)} (locked ${new Date(sc.atDraft.lockedAt).toLocaleDateString()})`);
    }
    if (sc.alignment) lines.push(`Alignment: ${sc.alignment.label} → ${signed(sc.alignment.value, 2)}`);
    if (sc.baseline) lines.push(`${p.position} baseline: every ${p.position} sits ${Math.abs(sc.baseline).toFixed(1)} ${sc.baseline < 0 ? "lower" : "higher"} → ${signed(sc.baseline, 2)}`);
    const mix = gamesByTier.get(p.id);
    if (mix && p.position !== "QB") lines.push(`Charted opponents: ${mix.P4} P4 · ${mix.G5} G5 · ${mix.FCS} FCS`);
    const sos = defenseFaced.get(p.id);
    if (sos) lines.push(`Opponent defenses: SP+ ${sos.avg.toFixed(1)} allowed per game on average (charted pool ${contextCov.spRef.toFixed(1)}; lower is tougher), ${sos.games} game${sos.games === 1 ? "" : "s"}`);
    const after = [sc.alignment && "the alignment penalty", sc.baseline && `the ${p.position} baseline`].filter(Boolean).join(" and ");
    const head = `${signed(sc.score, 2)} true-talent SDs vs the average charted ${p.position}${after ? `, after ${after}` : ""}`;
    const title = [head, ...lines].join("\n");
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
  // ── Role cell ─────────────────────────────────────────────────
  // The best-case role ("X", or "X / Y" on a near tie) with a V for
  // Versatile; the tooltip lists every role's match and why.
  function roleCell(p: ProspectWithStats) {
    const cls = `${tdBase} border-l border-r border-slate-800`;
    const fit = roleFits.get(p.id);
    if (!fit) {
      return <td className={`${cls} text-slate-600`} title={isCompositePos(p.position) ? "Not enough tape for a role yet" : undefined}>—</td>;
    }
    // Greyed when it's uncertain: little tape, a headline not proven yet ("X?",
    // an X without in-app press reps), or an RB who reached no level.
    const weak = fit.confidence === "low" || matchFor(fit, fit.best)?.proven === false || noLevelReached(fit);
    return (
      <td className={`${cls} font-medium ${weak ? "text-slate-500" : "text-slate-200"}`} title={roleFitTooltip(fit)}>
        {roleLabel(fit)}
        {fit.versatile && <span className="ml-1 px-1 rounded bg-teal-900/60 text-teal-300 text-[9px] font-semibold">V</span>}
      </td>
    );
  }
  // ── Sample dot ────────────────────────────────────────────────
  // How much of a full sample is charted (sampleSize.ts): green full, yellow
  // 50–99.9%, orange 25–49.9%, red under 25%. The tooltip gives the counts.
  const mixText = (cs: { weight: number }[]) => (cs.length > 1 ? ` (${cs.map((c) => Math.round(c.weight * 100)).join("/")})` : "");
  function sampleCell(p: ProspectWithStats) {
    const s = samples.get(p.id);
    const style = { left: 68, minWidth: 40, width: 40 };
    const cls = "sticky z-10 bg-slate-950 border-r border-slate-800 text-center";
    if (!s) return <td style={style} className={cls} />;
    const t = SAMPLE_TIERS.find((x) => x.tier === s.tier)!;
    const how = s.tier === "full" ? "full" : `${Math.floor(s.share * 100)}% of full`;
    return (
      <td style={style} className={cls} title={`Sample ${how}: ${s.parts.map(samplePartText).join(" · ")}${mixText(s.parts)}`}>
        <span role="img" aria-label={`Sample: ${t.label}`} className={`inline-block w-2.5 h-2.5 rounded-full align-middle ${t.dot}`} />
      </td>
    );
  }
  const teMatched = composite.positions.TE.metrics.some((m) => !m.perPlayer && m.fullTrustAt != null);
  const ceilingText = COMPOSITE_POS.map((pos) => {
    const cs = sampleCeilings(pos, composite);
    const plays = cs.map((c) => `${c.full} ${SAMPLE_UNIT[c.key] ?? "plays"}`).join(" + ");
    const note = pos !== "TE" ? "" : teMatched ? ", matched to WR's" : ", WR's until TEs join the AE Score";
    return `${pos} ${plays}${mixText(cs)}${note}`;
  }).join(" · ");
  const sampleTooltip =
    "Sample: how much of a full sample you've charted. Full is where the AE Score counts a sample at face value: " +
    `${ceilingText}. Green full · yellow 50–99.9% · orange 25–49.9% · red under 25%. Always the live charting, in either score view.`;

  const roleTooltip =
    "Role: the best-case NFL role from the charting plus height and weight (Analysis → Role Fit has every role's match %). " +
    "WR / TE / QB: two roles within 5 points read \"A / B\", the higher-ceiling one first. \"?\" = not proven yet (an X needs 10+ in-app press reps). " +
    `RB: ${levelRuleText("RB")} ` +
    `V = Versatile: a WR ${versatileRuleText("WR")}, a TE ${versatileRuleText("TE")} (none for RB or QB: Three-down, Creator and Dual-threat already mean all-round). Greyed = little tape, or not proven yet. Feeds none of the scores.`;

  const dynastyTooltip =
    "Dynasty Score: the AE Score plus a career-window adjustment for age (prime seasons left at rookie " +
    `age vs a typical ${REFERENCE_ROOKIE_AGE}-year-old rookie; primes end RB ${PRIME_END_AGE.RB}, WR ${PRIME_END_AGE.WR}, ` +
    `TE ${PRIME_END_AGE.TE}, QB ${PRIME_END_AGE.QB}) and size (RB and WR pounds per inch of height vs the position's typical, plus WRs under 175 lb). Weighted by the sliders.`;
  const dynastyPlusTooltip =
    "Dynasty Score Plus: the Dynasty Score plus draft capital (initial opportunity), from 1st round +2.0 " +
    "to Undrafted −2.0 at the default 2× weight. Shows once the NFL draft round is set.";

  // Where a metric's sample counts in full (aeComposite.ts trustAt), for the tooltip.
  function fullAt(pos: string, key: string): string {
    if (!isCompositePos(pos)) return "";
    const m = composite.positions[pos].metrics.find((x) => x.key === key);
    return m?.fullTrustAt != null ? ` (full at ${m.fullTrustAt} ${SAMPLE_UNIT[key] ?? "plays"})` : "";
  }

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
  // Headline metrics judged against opponent defense SP+ instead (contextGrading.ts).
  const spText = (Object.values(contextInfo) as MetricContext[])
    .filter((c) => c.opponent === "sp" && c.fit && c.fit.beta.opp_def_sp != null)
    .map((c) => `${c.key === "wr_csae" ? "WR cSAE" : c.key} by opp. defense SP+ (${(c.fit!.beta.opp_def_sp * 100).toFixed(2)} pts per SP+ pt)`);
  const opponentStatus = !gameRouteCells
    ? "the per-game WR route data (migration 058) didn't load"
    : [...spText, effectText("WR"), effectText("TE"), effectText("RB"), "QB not adjusted"].filter(Boolean).join(" · ") || "not enough games vs G5/FCS yet";
  const unrecognized = [...gameTiers.unrecognized].map(([name, n]) => `${name}${n > 1 ? ` (${n})` : ""}`);

  const compositeTooltip =
    "AE Score: each prospect's headline Above-Expected, discounted for sample size and put in " +
    "true-talent SDs vs the average charted prospect at the position, so it compares across " +
    "positions. WR blends cSAE 70% and SAE 30%; TE blends TE-SAER 80% and TE-SAEB 20%. " +
    "Each position's score also takes in, per player and weighted by how far his sample is trusted: your charting no AE reads " +
    "(QB sacks under pressure; RB pass pro, drops, open on routes; WR drops, contested catches), " +
    "PFF's results over the charted games where you don't chart (QB BTT%, TWP%, rushing; RB YCO/A, missed tackles, 10+ yard runs, 15+ of 10+, YPRR; WR/TE YPRR, YAC; RB and QB fumbles), " +
    "and the tag-only stats once enough tagged plays exist. A player without one keeps his score as it was. " +
    "Opponent strength is taken out (the AE columns keep it): WR cSAE, QB sacks under pressure and WR PFF YPRR by the opponent's defensive SP+, " +
    "everything else by the opponent's P4 / G5 / FCS tier; WR contested catches and RB PFF YPRR by the game's weather too. " +
    "Each passed a held-out test (Analysis → Grading checks); supporting cast is shown, never scored. " +
    `Older seasons count a little less, here and in the AE columns (each season back ×${SEASON_DECAY}). ` +
    "WRs lined up 75%+ on one side (or, milder, in the slot) lose up to 0.5 (0.2), most at 95%. " +
    `Small samples are discounted until full trust: WR at ${WR_ALL_FULL_TRUST} total / ${WR_CORE_FULL_TRUST} core routes, ` +
    `QB at ${QB_FULL_TRUST} throws, RB at ${RB_FULL_TRUST} runs (TE's ceiling is matched to WR's). ` +
    `RBs sit ${Math.abs(POSITION_BASELINE.RB ?? 0).toFixed(1)} lower across the board, to keep them from crowding the top. ` +
    `True spread: ${compositeStatus}.`;

  // The Traits band: a position tab's traits, or their average on All.
  const traitColumnDefs: ColDef[] = boardTab === "all"
    ? [{ key: TRAIT_AVG_KEY, label: "Traits", tooltip: "Average of a prospect's trait grades (1–10, your per-game grades on new games). Beside the AE Score." } as ColDef]
    : traitsFor(boardTab).map((t) => ({
      key: `trait_${t.key}`,
      label: t.short,
      tooltip: `${t.label}: your 1–10 grade${t.hint ? ` (${t.hint})` : ""}, averaged over graded new games (older seasons count a little less). ` +
        (t.coveredBy
          ? `Beside the AE Score: ${t.coveredBy} already measures it.`
          : `Uncovered: counts in the AE Score with "With traits" on (weight ${TRAIT_WEIGHT} at full trust).`),
    } as ColDef));

  // The PFF band: a position tab's key PFF numbers, or the offense grade on All.
  const pffColumnDefs: ColDef[] = (() => {
    const pos = boardTab === "all" ? null : pffPos(boardTab);
    if (!pos) {
      const grade = pffCols("WR").find((c) => c.key === PFF_ALL_TAB_KEY)!;
      return [{ ...grade, label: "PFF Grade" }];
    }
    const cols = pffCols(pos);
    return PFF_BOARD_KEYS[pos]
      .map((k) => cols.find((c) => c.key === k)!)
      .filter(Boolean)
      .map((c) => (c.key === PFF_ALL_TAB_KEY ? { ...c, label: "Grade" } : c));
  })();

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
        {sampleCell(p)}
        <td style={{ left: 108, minWidth: 140, width: 140 }}
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
    const pffBorder = (i: number, n: number) => `${i === 0 ? "border-l border-slate-800" : ""} ${i === n - 1 ? "border-r border-slate-800" : ""}`;
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
            <th style={{ left: 68, minWidth: 40 }} className="sticky z-20 bg-slate-950" />
            <th style={{ left: 108, minWidth: 140 }} className="sticky z-20 bg-slate-950 border-r border-slate-800" />
            <th colSpan={3} className="px-2 py-1 text-center text-amber-900 font-medium border-r border-slate-800">Grade</th>
            <th colSpan={1} className="px-2 py-1 text-center text-indigo-900 font-medium border-r border-slate-800">NFL Draft</th>
            <th colSpan={1} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">{secondaryGroup}</th>
            <th colSpan={identitySpan} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">Identity</th>
            <th colSpan={3} className="px-2 py-1 text-center text-teal-900 font-medium border-r border-slate-800">Composite</th>
            <th colSpan={1} className="px-2 py-1 text-center text-violet-900 font-medium border-r border-slate-800">Role Fit</th>
            {aeGroups.map((g) => (
              <th key={g.group} colSpan={g.span} className="px-2 py-1 text-center text-emerald-900 font-medium border-r border-slate-800 whitespace-nowrap">{g.group}</th>
            ))}
            {pffColumnDefs.length > 0 && (
              <th colSpan={pffColumnDefs.length} title={PFF_BAND_TOOLTIP} className="px-2 py-1 text-center text-sky-900 font-medium border-r border-slate-800 whitespace-nowrap">PFF (charted games)</th>
            )}
            <th colSpan={traitColumnDefs.length} title={TRAITS_BAND_TOOLTIP} className="px-2 py-1 text-center text-fuchsia-900 font-medium border-r border-slate-800 whitespace-nowrap">Traits (your grades)</th>
          </tr>
          <tr className="border-b border-slate-800 bg-slate-950">
            <th className="sticky left-0 z-20 bg-slate-950 w-6 text-slate-700 text-center px-1">⠿</th>
            {stickyTh(primaryLabel, primaryKey, 24, 44)}
            {stickyTh("Smp", "sample", 68, 40, sampleTooltip, "px-0.5")}
            {stickyTh("Name", "name", 108, 140)}
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
            {th("Role", "role", "border-l border-r border-slate-800 text-violet-500", roleTooltip)}
            {aeCols.map((c, i) => th(c.label, `ae_${c.key}`, `${aeBorder[i]} text-emerald-700`, c.tooltip))}
            {pffColumnDefs.map((c, i) => th(c.label, c.key as SortKey, `${pffBorder(i, pffColumnDefs.length)} text-sky-600`, c.tooltip))}
            {traitColumnDefs.map((c, i) => th(c.label, c.key as SortKey, `${pffBorder(i, traitColumnDefs.length)} text-fuchsia-600`, c.tooltip))}
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
                {roleCell(p)}
                {aeCols.map((c, i) => aeCell(p, c, aeBorder[i]))}
                {pffColumnDefs.map((c, i) => pffCell(p, c, pffBorder(i, pffColumnDefs.length)))}
                {traitColumnDefs.map((c, i) => traitCell(p, c, pffBorder(i, traitColumnDefs.length)))}
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
      {/* Sample legend — the Smp column's dots. */}
      <ul aria-label="Sample size" title={sampleTooltip} className="flex flex-wrap justify-center gap-x-4 gap-y-1 mb-2 text-xs">
        <li className="text-slate-500 whitespace-nowrap">Smp (sample charted):</li>
        {SAMPLE_TIERS.map((t) => (
          <li key={t.tier} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${t.dot}`} />
            <span className="text-slate-400">{t.label}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600 mb-2 text-center">Drag rows to reorder · Click rank or a grade to edit (1.0–100.0) · Click any column header to sort</p>
      <p className="text-xs text-slate-600 mb-2 text-center">AE Score true spread: {compositeStatus}</p>
      <p className="text-xs text-slate-600 mb-2 text-center">
        Opponent strength (scores only): {opponentStatus}
        {unrecognized.length > 0 && (
          <span className="text-amber-700" title="Rename the opponent, or link the game in Scouting → PFF Links: a name matched to a PFF game there is remembered for your other games.">
            {" "}· Unrecognized opponents: {unrecognized.join(", ")}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-3 text-xs text-slate-400">
        <div role="group" aria-label="Score view" className="inline-flex rounded border border-slate-700 overflow-hidden"
          title="Live: scores sharpen as you chart more. As of draft: a drafted class's scores as they stood at its draft (🔒).">
          {(["live", "draft"] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={scoreMode === mode}
              onClick={() => chooseScoreMode(mode)}
              className={`px-2 py-0.5 ${scoreMode === mode ? "bg-teal-800 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800"}`}
            >{mode === "live" ? "Live" : "As of draft"}</button>
          ))}
        </div>
        <div role="group" aria-label="Traits in the AE Score" className="inline-flex rounded border border-slate-700 overflow-hidden"
          title={`Traits sit beside the AE Score. "With traits" shows the same live scores with the traits no charted or PFF stat already measures (${UNCOVERED_TRAITS_TEXT}) added at ${TRAIT_WEIGHT} each × trust; a prospect without grades keeps his score. Draft-day snapshots never include traits.`}>
          {([false, true] as const).map((on) => (
            <button
              key={String(on)}
              aria-pressed={withTraits === on}
              onClick={() => chooseTraits(on)}
              className={`px-2 py-0.5 ${withTraits === on ? "bg-fuchsia-900 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800"}`}
            >{on ? "With traits" : "Without traits"}</button>
          ))}
        </div>
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
          onClick={resetWeights}
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
