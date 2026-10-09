"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import { useLatestRequest } from "../hooks/useLatestRequest";
import type {
  AEScoreLock,
  BoardScores,
  Prospect,
  ProspectWithStats,
  ScoutingGame,
  RBPlay,
  QBPlay,
  TEPlay,
  QBDepthZoneStat,
  RBRunTypeStat,
  TEBlockStat,
  CoverageStat,
} from "../lib/types";
import type { GradeField } from "../lib/scouting/prospectGrade";
import {
  buildProspectsWithStats,
  buildWRModel,
  type ProspectRouteStatsRow,
  type ProspectGameRouteCellsRow,
  type ProspectGameAlignmentRow,
  type ProspectGameRouteTagCellsRow,
} from "../lib/scouting/aggregateMerge";
import type { ProspectGameRouteCountsRow } from "../lib/scouting/chartedComponents";
import type { GradingData } from "../lib/scouting/aeComponents";
import { buildPffTotals } from "../lib/pff/totals";
import { fetchPffRows, isMissingPffTables, type PffRows } from "./scouting/pff/pffClient";
import { fetchGameContextData, isMissingContextTables } from "./scouting/context/contextClient";
import { EMPTY_CONTEXT_DATA, type GameContextData } from "../lib/scouting/gameContext";
import type { OverviewData } from "./scouting/overview/ProspectOverview";

const log = logger("ScoutingHub");

export interface GameSnapStatsRow {
  game_id: string;
  prospect_id: string;
  snaps_charted: number;
}

export type LazyPosition = "RB" | "QB" | "TE";
export type LoadPositionPlaysFn = (pos: LazyPosition) => void;

interface PosSnapsRow {
  prospect_id: string;
  total_snaps: number;
}

type QBZoneKey = "short" | "mid" | "deep";
type RBRunTypeKey = "outside_zone" | "inside_zone" | "outside_man_gap" | "inside_man_gap";
type TECoverageKey = "man" | "zone" | "press" | "double";
type TEBlockKey = "inline" | "movement";

interface QbThresholdRow {
  prospect_id: string;
  total_snaps: number;
  total_throws: number;
  // jsonb_object_agg only includes keys that had at least one play — partial, not full.
  depth_zone_stats_raw: Partial<Record<QBZoneKey, QBDepthZoneStat>> | null;
}

interface TeThresholdRow {
  prospect_id: string;
  total_snaps: number;
  total_routes: number;
  coverage_stats_raw: Partial<Record<TECoverageKey, CoverageStat>> | null;
  block_stats_raw: Partial<Record<TEBlockKey, TEBlockStat>> | null;
}

interface RbRunTypeRow {
  prospect_id: string;
  run_type_stats_raw: Partial<Record<RBRunTypeKey, RBRunTypeStat>> | null;
}

const fillZoneStats = (raw: Partial<Record<QBZoneKey, QBDepthZoneStat>> | null | undefined): Record<QBZoneKey, QBDepthZoneStat> => ({
  short: raw?.short ?? { count: 0, onTarget: 0 },
  mid:   raw?.mid   ?? { count: 0, onTarget: 0 },
  deep:  raw?.deep  ?? { count: 0, onTarget: 0 },
});

const fillRunTypeStats = (raw: Partial<Record<RBRunTypeKey, RBRunTypeStat>> | null | undefined): Record<RBRunTypeKey, RBRunTypeStat> => ({
  outside_zone:    raw?.outside_zone    ?? { count: 0, success: 0 },
  inside_zone:     raw?.inside_zone     ?? { count: 0, success: 0 },
  outside_man_gap: raw?.outside_man_gap ?? { count: 0, success: 0 },
  inside_man_gap:  raw?.inside_man_gap  ?? { count: 0, success: 0 },
});

const fillTeCoverageStats = (raw: Partial<Record<TECoverageKey, CoverageStat>> | null | undefined): Record<TECoverageKey, CoverageStat> => ({
  man:    raw?.man    ?? { count: 0, open: 0, catches: 0 },
  zone:   raw?.zone   ?? { count: 0, open: 0, catches: 0 },
  press:  raw?.press  ?? { count: 0, open: 0, catches: 0 },
  double: raw?.double ?? { count: 0, open: 0, catches: 0 },
});

const fillBlockStats = (raw: Partial<Record<TEBlockKey, TEBlockStat>> | null | undefined): Record<TEBlockKey, TEBlockStat> => ({
  inline:   raw?.inline   ?? { count: 0, success: 0 },
  movement: raw?.movement ?? { count: 0, success: 0 },
});

// Paginate a *_plays table by game_id IN (...) until exhausted. Used by
// the lazy-fetch hook below — these are the same fetches that previously
// ran inside AnalysisHub. Lifting them up so GamesLog can also share the
// loaded data without each tab paying its own round-trip.
async function fetchPlaysByGame<T>(
  table: "rb_plays" | "qb_plays" | "te_plays",
  gameIds: string[],
): Promise<T[]> {
  if (gameIds.length === 0) return [];
  // Chunk the game-id IN list so the request URL stays well under the
  // gateway's URI-length limit. With hundreds of 36-char UUIDs a single
  // .in() produces a >20k-char URL that PostgREST/Kong intermittently
  // rejects (414), which is why QB/RB/TE analysis used to load blank.
  const CHUNK = 80;
  const PAGE = 1000;
  const all: T[] = [];
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    const idsChunk = gameIds.slice(i, i + CHUNK);
    let from = 0;
    while (true) {
      const { data, error } = await supabase.from(table).select("*").in("game_id", idsChunk).range(from, from + PAGE - 1);
      if (error) { log.error(`${table} load`, { msg: error.message }); throw error; }
      all.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  return all;
}

// prospect_game_route_cells (migration 058), paged. Throws on error, which
// includes the view not existing.
async function fetchGameRouteCells(): Promise<ProspectGameRouteCellsRow[]> {
  const PAGE = 1000;
  const all: ProspectGameRouteCellsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("prospect_game_route_cells")
      .select("prospect_id,game_id,cells")
      .order("game_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as ProspectGameRouteCellsRow[]));
    if (!data || data.length < PAGE) return all;
  }
}

// prospect_game_alignment (migration 060), paged. Throws on error, which
// includes the view not existing.
async function fetchGameAlignment(): Promise<ProspectGameAlignmentRow[]> {
  const PAGE = 1000;
  const all: ProspectGameAlignmentRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("prospect_game_alignment")
      .select("prospect_id,game_id,snaps,slot_on,slot_off,left_on,left_off,right_on,right_off,backfield")
      .order("game_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as ProspectGameAlignmentRow[]));
    if (!data || data.length < PAGE) return all;
  }
}

// A per-game view (migration 064: prospect_game_route_counts /
// prospect_game_route_tag_cells), paged. Throws on error, which includes the
// view not existing.
async function fetchGameView<T>(view: string, select: string): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(view)
      .select(select)
      .order("game_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return all;
  }
}

// A 064 view failed to load: before the migration is applied that's expected
// (warn), anything else is an error. Either way only its numbers go blank.
function logView064(what: string, error: { message?: string; code?: string }) {
  const missing = error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find/i.test(error.message ?? "");
  if (missing) log.warn(`${what} view missing (apply migration 064); ${what === "prospect_game_route_counts" ? "charted WR hands / contested components" : "WR tag stats and tag correction"} blank`);
  else log.error(`${what} load`, { msg: error.message, code: error.code });
}

const WRHub = dynamic(() => import("./scouting/wr/WRHub"), { ssr: false });
const RBHub = dynamic(() => import("./scouting/rb/RBHub"), { ssr: false });
const QBHub = dynamic(() => import("./scouting/qb/QBHub"), { ssr: false });
const TEHub = dynamic(() => import("./scouting/te/TEHub"), { ssr: false });
const BigBoard = dynamic(() => import("./scouting/BigBoard"), { ssr: false });
const GamesLog = dynamic(() => import("./scouting/GamesLog"), { ssr: false });
const AnalysisHub = dynamic(() => import("./scouting/stats/AnalysisHub"), { ssr: false });
const CompareProspectsTab = dynamic(() => import("./scouting/stats/CompareProspectsTab"), { ssr: false });
const RecruitsTab = dynamic(() => import("./scouting/RecruitsTab"), { ssr: false });
const RecruitStatsTab = dynamic(() => import("./scouting/RecruitStatsTab"), { ssr: false });
const PffLinksTab = dynamic(() => import("./scouting/pff/PffLinksTab"), { ssr: false });

type HubTab = "prospects" | "big_board" | "games_log" | "analysis" | "compare" | "recruits" | "recruit_stats" | "pff_links";
type PositionTab = "WR" | "RB" | "QB" | "TE";

const POSITIONS: PositionTab[] = ["QB", "RB", "WR", "TE"];
const POSITION_LABELS: Record<PositionTab, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
};

export default function ScoutingHub() {
  const [tab, setTab] = useState<HubTab>("prospects");
  const [positionTab, setPositionTab] = useState<PositionTab>("WR");
  const [pendingProspect, setPendingProspect] = useState<Prospect | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [routeStatsRows, setRouteStatsRows] = useState<ProspectRouteStatsRow[]>([]);
  const [gameSnapStatsRows, setGameSnapStatsRows] = useState<GameSnapStatsRow[]>([]);
  const [posSnapsRows, setPosSnapsRows] = useState<PosSnapsRow[]>([]);
  const [qbThrowsByProspect, setQbThrowsByProspect] = useState<Map<string, number>>(new Map());
  const [teRoutesByProspect, setTeRoutesByProspect] = useState<Map<string, number>>(new Map());
  // Full-career success-rate breakdowns for the Prospects-list badges (Phase 3) —
  // side-channel Maps mirroring qbThrowsByProspect/teRoutesByProspect above, kept
  // out of ProspectWithStats/buildProspectsWithStats (that pipeline is WR-specific).
  const [qbDepthZoneStatsByProspect, setQbDepthZoneStatsByProspect] =
    useState<Map<string, Record<QBZoneKey, QBDepthZoneStat>>>(new Map());
  const [rbRunTypeStatsByProspect, setRbRunTypeStatsByProspect] =
    useState<Map<string, Record<RBRunTypeKey, RBRunTypeStat>>>(new Map());
  const [teCoverageStatsByProspect, setTeCoverageStatsByProspect] =
    useState<Map<string, Record<TECoverageKey, CoverageStat>>>(new Map());
  const [teBlockStatsByProspect, setTeBlockStatsByProspect] =
    useState<Map<string, Record<TEBlockKey, TEBlockStat>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [draftYearFilter, setDraftYearFilter] = useState<number | null>(null);

  // Lazy-loaded raw plays for RB/QB/TE. Triggered by AnalysisHub or
  // GamesLog when they need the data — fetched at most once per parent
  // reload (cache key = joined game ids string).
  const [rbPlays, setRbPlays] = useState<RBPlay[]>([]);
  const [qbPlays, setQbPlays] = useState<QBPlay[]>([]);
  const [tePlays, setTePlays] = useState<TEPlay[]>([]);
  const fetchedPlaysRef = useRef<{ RB: string | null; QB: string | null; TE: string | null }>({ RB: null, QB: null, TE: null });
  // Per-game WR route cells (migration 058). They feed WR SAE / cSAE (each
  // route season-weighted by its game, see seasonWeight.ts) and the AE Score's
  // opponent adjustment, so they load with everything else. Null after a
  // failed load: WR SAE / cSAE show "—" and WR isn't opponent-adjusted.
  const [gameRouteCells, setGameRouteCells] = useState<ProspectGameRouteCellsRow[] | null>(null);
  // Per-game WR alignment over every play (migration 060), for the WR stats'
  // Lined Up columns. Empty after a failed load: those columns show "—".
  const [gameAlignment, setGameAlignment] = useState<ProspectGameAlignmentRow[]>([]);
  // The user's PFF stats for charted games (migration 063). Empty after a failed
  // load (or before 063 is applied): the PFF columns show "—".
  const [pffRows, setPffRows] = useState<PffRows>({ games: [], seasons: [] });
  // Migration 064: each WR game's charted receiving counts (the AE Score's
  // charted hands / contested components) and its TAGGED routes by situation
  // and tag (WR tag stats, the WR tag correction, the Grading checks). Empty
  // after a failed load (or before 064 is applied): only those go blank.
  const [routeCounts, setRouteCounts] = useState<ProspectGameRouteCountsRow[]>([]);
  const [routeTagCells, setRouteTagCells] = useState<ProspectGameRouteTagCellsRow[]>([]);
  // Migration 065: each charted game's CFD game, weather, SP+ and supporting cast.
  const [contextData, setContextData] = useState<GameContextData>(EMPTY_CONTEXT_DATA);
  // Whether each lazy play load has landed. The Big Board only snapshots a
  // drafted prospect's AE Score once all three have, so it never saves a
  // half-computed score. (The route cells arrive with the hub's own load.)
  const [playsLoaded, setPlaysLoaded] = useState({ RB: false, QB: false, TE: false });
  const scoresReady = playsLoaded.RB && playsLoaded.QB && playsLoaded.TE;
  // No load in the last loadAll failed. A failed load blanks only what it
  // feeds, but the scores then differ from a full load's, so the Big Board
  // doesn't save the draft board's scores from them.
  const [inputsComplete, setInputsComplete] = useState(false);
  const { begin: beginLoad, isCurrent: isLoadCurrent } = useLatestRequest();
  const mountedRef = useRef(false);

  const loadAll = useCallback(async () => {
    // Reloads come from several places (initial mount, list edits, a charting board flushing its
    // writes) and can overlap. Only the newest may commit — otherwise a slow older reload lands
    // last and overwrites fresher rows.
    const seq = beginLoad();
    setLoading(true);
    try {
      const [
        { data: pData, error: pErr },
        { data: gData, error: gErr },
        { data: rsData, error: rsErr },
        { rows: cellData, error: cellErr },
        { rows: alignData, error: alignErr },
        { data: gssData, error: gssErr },
        { data: rbStatsData, error: rbStatsErr },
        { data: qbStatsData, error: qbStatsErr },
        { data: teStatsData, error: teStatsErr },
        { rows: pffData, error: pffErr },
        { rows: countData, error: countErr },
        { rows: tagCellData, error: tagCellErr },
        { rows: contextRows, error: contextErr },
      ] = await Promise.all([
        supabase.from("prospects").select("*").order("personal_rank", { ascending: true, nullsFirst: false }),
        supabase.from("scouting_games").select("*").order("season_year", { ascending: false }),
        supabase.from("prospect_route_stats").select("*"),
        // WR SAE / cSAE, per game (migration 058). Its own query, so a failure only
        // blanks SAE / cSAE instead of failing prospect_route_stats too.
        fetchGameRouteCells().then(
          (rows) => ({ rows, error: null }),
          (error: { message?: string; code?: string }) => ({ rows: null, error }),
        ),
        // WR alignment over every play (migration 060). Its own query too, so a
        // failure only blanks the Lined Up columns.
        fetchGameAlignment().then(
          (rows) => ({ rows, error: null }),
          (error: { message?: string; code?: string }) => ({ rows: [] as ProspectGameAlignmentRow[], error }),
        ),
        supabase.from("prospect_game_snap_stats").select("*"),
        supabase.from("prospect_rb_stats").select("prospect_id,total_snaps,run_type_stats_raw"),
        supabase.from("prospect_qb_stats").select("prospect_id,total_snaps,total_throws,depth_zone_stats_raw"),
        supabase.from("prospect_te_stats").select("prospect_id,total_snaps,total_routes,coverage_stats_raw,block_stats_raw"),
        // PFF stats (migration 063). Its own query, so a failure only blanks the PFF columns.
        fetchPffRows().then(
          (rows) => ({ rows, error: null }),
          (error: unknown) => ({ rows: { games: [], seasons: [] } as PffRows, error }),
        ),
        // Migration 064, each its own query (a failure only blanks what it feeds).
        fetchGameView<ProspectGameRouteCountsRow>("prospect_game_route_counts", "prospect_id,game_id,routes,targets,catches,drops,contested,contested_catches").then(
          (rows) => ({ rows, error: null }),
          (error: { message?: string; code?: string }) => ({ rows: [] as ProspectGameRouteCountsRow[], error }),
        ),
        fetchGameView<ProspectGameRouteTagCellsRow>("prospect_game_route_tag_cells", "prospect_id,game_id,cells").then(
          (rows) => ({ rows, error: null }),
          (error: { message?: string; code?: string }) => ({ rows: [] as ProspectGameRouteTagCellsRow[], error }),
        ),
        // Game context (migration 065). Its own query, so a failure only blanks the context.
        fetchGameContextData().then(
          (rows) => ({ rows, error: null }),
          (error: unknown) => ({ rows: EMPTY_CONTEXT_DATA, error }),
        ),
      ]);
      if (!isLoadCurrent(seq)) return; // superseded by a newer reload
      if (pErr) log.error("prospects load", { msg: pErr.message, code: pErr.code, details: pErr.details, hint: pErr.hint });
      if (gErr) log.error("games load", { msg: gErr.message, code: gErr.code, details: gErr.details, hint: gErr.hint });
      if (rsErr) log.error("prospect_route_stats load", { msg: rsErr.message, code: rsErr.code, details: rsErr.details, hint: rsErr.hint });
      if (cellErr) log.error("prospect_game_route_cells load (WR SAE/cSAE blank, WR AE Score not opponent-adjusted)", { msg: cellErr.message, code: cellErr.code });
      if (alignErr) log.error("prospect_game_alignment load (WR Lined Up columns blank; is migration 060 applied?)", { msg: alignErr.message, code: alignErr.code });
      if (gssErr) log.error("prospect_game_snap_stats load", { msg: gssErr.message, code: gssErr.code, details: gssErr.details, hint: gssErr.hint, raw: JSON.stringify(gssErr) });
      if (rbStatsErr) log.error("prospect_rb_stats load", { msg: rbStatsErr.message });
      if (qbStatsErr) log.error("prospect_qb_stats load", { msg: qbStatsErr.message });
      if (teStatsErr) log.error("prospect_te_stats load", { msg: teStatsErr.message });
      if (pffErr) {
        if (isMissingPffTables(pffErr)) log.warn("PFF stats tables missing (apply migration 063); PFF columns blank");
        else log.error("PFF stats load (PFF columns blank)", { msg: String(pffErr) });
      }
      if (countErr) logView064("prospect_game_route_counts", countErr);
      if (tagCellErr) logView064("prospect_game_route_tag_cells", tagCellErr);
      if (contextErr) {
        if (isMissingContextTables(contextErr)) log.warn("game context tables missing (apply migration 065); context blank");
        else log.error("game context load (context blank)", { msg: String(contextErr) });
      }

      // Reset lazy-fetch cache so a parent reload re-fetches plays the
      // next time AnalysisHub or GamesLog needs them.
      fetchedPlaysRef.current = { RB: null, QB: null, TE: null };
      setPlaysLoaded({ RB: false, QB: false, TE: false });
      setRbPlays([]);
      setQbPlays([]);
      setTePlays([]);

      setProspects((pData ?? []) as Prospect[]);
      setGames((gData ?? []) as ScoutingGame[]);
      setRouteStatsRows((rsData ?? []) as ProspectRouteStatsRow[]);
      setGameRouteCells(cellData);
      setGameAlignment(alignData);
      setPffRows(pffData);
      setRouteCounts(countData);
      setRouteTagCells(tagCellData);
      setContextData(contextRows);
      setInputsComplete(!(pErr || gErr || rsErr || cellErr || alignErr || gssErr || rbStatsErr || qbStatsErr || teStatsErr
        || pffErr || countErr || tagCellErr || contextErr));
      setGameSnapStatsRows((gssData ?? []) as GameSnapStatsRow[]);
      const rbRows = (rbStatsData ?? []) as RbRunTypeRow[];
      const qbRows = (qbStatsData ?? []) as QbThresholdRow[];
      const teRows = (teStatsData ?? []) as TeThresholdRow[];
      setPosSnapsRows([
        ...((rbStatsData ?? []) as PosSnapsRow[]),
        ...qbRows.map(({ prospect_id, total_snaps }) => ({ prospect_id, total_snaps })),
        ...teRows.map(({ prospect_id, total_snaps }) => ({ prospect_id, total_snaps })),
      ]);
      setQbThrowsByProspect(new Map(qbRows.map((r) => [r.prospect_id, r.total_throws ?? 0])));
      setTeRoutesByProspect(new Map(teRows.map((r) => [r.prospect_id, r.total_routes ?? 0])));
      setQbDepthZoneStatsByProspect(new Map(qbRows.map((r) => [r.prospect_id, fillZoneStats(r.depth_zone_stats_raw)])));
      setRbRunTypeStatsByProspect(new Map(rbRows.map((r) => [r.prospect_id, fillRunTypeStats(r.run_type_stats_raw)])));
      setTeCoverageStatsByProspect(new Map(teRows.map((r) => [r.prospect_id, fillTeCoverageStats(r.coverage_stats_raw)])));
      setTeBlockStatsByProspect(new Map(teRows.map((r) => [r.prospect_id, fillBlockStats(r.block_stats_raw)])));
    } catch (e) {
      log.error("loadAll", { msg: String(e) });
      if (isLoadCurrent(seq)) setInputsComplete(false);
    } finally {
      if (isLoadCurrent(seq)) setLoading(false);
    }
  }, [beginLoad, isLoadCurrent]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // What the position hubs / charting boards call as `onDataChanged`. A board flushes its pending
  // writes as it unmounts — which includes this whole hub unmounting (navigating to another hub),
  // and reloading a hub that is going away would just burn ~8 queries. (React runs a deleted
  // tree's passive cleanups parent-first, so mountedRef is already false by then.)
  const reloadHub = useCallback(() => {
    if (mountedRef.current) void loadAll();
  }, [loadAll]);

  // Lazy-fetch the raw plays for one position. Idempotent per parent
  // reload — repeated calls with the same games no-op. Fetch results land
  // via the .then() callback so this fn itself can be safely invoked from
  // a child useEffect (no synchronous setState inside an effect body).
  const gameIdsKey = games.map((g) => g.id).join(",");
  const loadPositionPlays = useCallback<LoadPositionPlaysFn>((pos) => {
    if (loading || games.length === 0) return;
    if (fetchedPlaysRef.current[pos] === gameIdsKey) return;
    fetchedPlaysRef.current[pos] = gameIdsKey;
    const ids = games.map((g) => g.id);
    // On failure, clear the cache marker so the next activation retries
    // rather than sticking on a blank table until a full hub reload.
    const onErr = () => { fetchedPlaysRef.current[pos] = null; };
    const loaded = () => setPlaysLoaded((prev) => ({ ...prev, [pos]: true }));
    if (pos === "RB") fetchPlaysByGame<RBPlay>("rb_plays", ids).then((rows) => { setRbPlays(rows); loaded(); }).catch(onErr);
    else if (pos === "QB") fetchPlaysByGame<QBPlay>("qb_plays", ids).then((rows) => { setQbPlays(rows); loaded(); }).catch(onErr);
    else if (pos === "TE") fetchPlaysByGame<TEPlay>("te_plays", ids).then((rows) => { setTePlays(rows); loaded(); }).catch(onErr);
  }, [loading, games, gameIdsKey]);

  // Lazy-fetch league-wide plays for the active position sub-tab too — the new
  // per-prospect "Charts" radar (H1) needs the same all-charted-prospects pool
  // AnalysisHub already uses for percentile tiering, not just the selected
  // prospect's own games.
  useEffect(() => {
    if (positionTab === "RB" || positionTab === "QB" || positionTab === "TE") {
      loadPositionPlays(positionTab);
    }
  }, [positionTab, loadPositionPlays]);

  // The WR difficulty model (coverage judged per definition era), fit once per
  // load. It feeds the SAE / cSAE columns and the WR charting board's per-game
  // badges, so both judge routes the same way.
  const wrModel = useMemo(() => buildWRModel(gameRouteCells ?? [], games, routeTagCells), [gameRouteCells, games, routeTagCells]);

  // Server-aggregated path: merge view rows + per-game route cells (WR SAE's
  // difficulty model, season-weighted by the games) into ProspectWithStats.
  // Replaces the per-snap JS reduce.
  // PFF over each prospect's charted games (lib/pff/totals.ts): Analysis,
  // Compare and the Big Board's PFF columns.
  const pffTotals = useMemo(() => buildPffTotals(games, pffRows.games, pffRows.seasons), [games, pffRows]);
  // The AE Score's per-player components and the tag stats read these
  // (lib/scouting/aeComponents.ts).
  const gradingData = useMemo<GradingData>(
    () => ({ pffGameRows: pffRows.games, routeCounts, routeTagCells, context: contextData }),
    [pffRows, routeCounts, routeTagCells, contextData],
  );

  const prospectsWithStats = useMemo(
    (): ProspectWithStats[] =>
      buildProspectsWithStats(prospects, routeStatsRows, gameRouteCells ?? [], games, {
        qbThrowsByProspect,
        teRoutesByProspect,
      }, wrModel, gameAlignment, routeTagCells),
    [prospects, routeStatsRows, gameRouteCells, games, qbThrowsByProspect, teRoutesByProspect, wrModel, gameAlignment, routeTagCells],
  );

  async function handleAddProspect(data: Omit<Prospect, "id" | "user_id" | "created_at" | "updated_at">) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { log.error("add prospect", { msg: "not authenticated" }); return; }
    const { data: inserted, error } = await supabase
      .from("prospects")
      .insert({ ...data, user_id: user.id })
      .select()
      .single();
    if (error) { log.error("add prospect", { msg: error.message }); return; }
    if (inserted) setProspects((prev) => [...prev, inserted as Prospect]);
  }

  // Pre/post-draft scout grade (1.0–100.0, one decimal; null clears it).
  // Optimistic: the cell repaints immediately, and a failed write rolls the
  // row back so the board can't show a grade the database doesn't have.
  async function handleUpdateGrade(id: string, field: GradeField, grade: number | null) {
    const previous = prospects.find((p) => p.id === id)?.[field] ?? null;
    setProspects((prev) => prev.map((p) => p.id === id ? { ...p, [field]: grade } : p));
    const { error } = await supabase
      .from("prospects")
      .update({ [field]: grade, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      log.error("update prospect grade", { msg: error.message, field });
      setProspects((prev) => prev.map((p) => p.id === id ? { ...p, [field]: previous } : p));
    }
  }

  // NFL draft round: 1–7, UNDRAFTED_ROUND (8), or null before the draft. Same
  // optimistic write-and-roll-back as the grades. Resolves false on a failed
  // write so the Big Board's one-time localStorage migration keeps that entry.
  async function handleUpdateDraftRound(id: string, round: number | null): Promise<boolean> {
    const previous = prospects.find((p) => p.id === id)?.draft_round ?? null;
    setProspects((prev) => prev.map((p) => p.id === id ? { ...p, draft_round: round } : p));
    const { error } = await supabase
      .from("prospects")
      .update({ draft_round: round, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      log.error("update prospect draft round", { msg: error.message });
      setProspects((prev) => prev.map((p) => p.id === id ? { ...p, draft_round: previous } : p));
      return false;
    }
    return true;
  }

  // Freeze a drafted prospect's AE Score (prospects.ae_score_lock, migration
  // 059). Optimistic; a failed write (e.g. the migration not applied yet) rolls
  // back, and the board keeps scoring that prospect live.
  async function handleLockAEScore(id: string, lock: AEScoreLock): Promise<boolean> {
    setProspects((prev) => prev.map((p) => p.id === id ? { ...p, ae_score_lock: lock } : p));
    const { error } = await supabase.from("prospects").update({ ae_score_lock: lock }).eq("id", id);
    if (error) {
      log.error("lock prospect AE Score (needs migration 059)", { msg: error.message });
      setProspects((prev) => prev.map((p) => p.id === id ? { ...p, ae_score_lock: null } : p));
      return false;
    }
    return true;
  }

  // Position rank: #1 WR, #1 QB, etc. — scoped to same position + draft class
  async function handleUpdateRank(id: string, targetRank: number) {
    const clamp = Math.max(1, targetRank);
    const mover = prospects.find((p) => p.id === id);
    if (!mover) return;

    const rankedOthers = prospects
      .filter((p) => p.personal_rank != null && p.id !== id
        && p.draft_class_year === mover.draft_class_year
        && p.position === mover.position)
      .sort((a, b) => (a.personal_rank ?? 0) - (b.personal_rank ?? 0));

    rankedOthers.splice(Math.min(clamp - 1, rankedOthers.length), 0, mover);

    const rankMap = new Map<string, number>(rankedOthers.map((p, i) => [p.id, i + 1]));
    const changed = rankedOthers.filter((p) => p.personal_rank !== rankMap.get(p.id));
    setProspects((prev) => prev.map((p) => rankMap.has(p.id) ? { ...p, personal_rank: rankMap.get(p.id)! } : p));

    await Promise.all(
      changed.map((p) =>
        supabase.from("prospects").update({ personal_rank: rankMap.get(p.id), updated_at: new Date().toISOString() }).eq("id", p.id)
      )
    );
  }

  // Overall rank: #1 across all positions within a draft class. The draft
  // board's order comes from it, so the move is one all-or-nothing call
  // (migration 068's move_prospect_overall_rank): the server moves him and
  // renumbers the class 1..N, and a failure can't leave the class half
  // renumbered. The board repaints at once; the server's ranks replace that
  // guess if they differ, and a failed call puts the old ranks back.
  async function handleUpdateOverallRank(id: string, targetRank: number) {
    const clamp = Math.max(1, targetRank);
    const mover = prospects.find((p) => p.id === id);
    if (!mover) return;
    const cls = mover.draft_class_year;

    const rankedOthers = prospects
      .filter((p) => p.overall_rank != null && p.id !== id && p.draft_class_year === cls)
      .sort((a, b) => (a.overall_rank ?? 0) - (b.overall_rank ?? 0));

    rankedOthers.splice(Math.min(clamp - 1, rankedOthers.length), 0, mover);

    const rankMap = new Map<string, number>(rankedOthers.map((p, i) => [p.id, i + 1]));
    const previous = new Map(prospects.filter((p) => p.draft_class_year === cls).map((p) => [p.id, p.overall_rank]));
    setProspects((prev) => prev.map((p) => rankMap.has(p.id) ? { ...p, overall_rank: rankMap.get(p.id)! } : p));

    const { data, error } = await supabase.rpc("move_prospect_overall_rank", { p_id: id, p_rank: clamp });
    if (error) {
      log.error("move prospect overall rank (needs migration 068)", { msg: error.message, code: error.code });
      setProspects((prev) => prev.map((p) => previous.has(p.id) ? { ...p, overall_rank: previous.get(p.id) ?? null } : p));
      return;
    }
    const server = new Map(((data ?? []) as { prospect_id: string; new_rank: number }[]).map((r) => [r.prospect_id, r.new_rank]));
    const differs = [...previous.keys()].some((pid) => (server.get(pid) ?? null) !== (rankMap.get(pid) ?? previous.get(pid) ?? null));
    if (differs) {
      setProspects((prev) => prev.map((p) => p.draft_class_year === cls ? { ...p, overall_rank: server.get(p.id) ?? null } : p));
    }
  }

  // The draft board's scores (prospects.board_scores, migration 068), many
  // prospects in one call. Not mirrored into state: nothing on this hub reads
  // them, and the Big Board tracks what it saved. False on a failed write.
  // Stable, so the Big Board's save delay isn't restarted by every render here.
  const handleSaveBoardScores = useCallback(async (scores: Record<string, BoardScores>): Promise<boolean> => {
    const { error } = await supabase.rpc("save_prospect_board_scores", { p_scores: scores });
    if (error) {
      log.error("save draft board scores (needs migration 068)", { msg: error.message, code: error.code });
      return false;
    }
    return true;
  }, []);

  const hubTabs: { key: HubTab; label: string }[] = [
    { key: "prospects", label: "Prospects" },
    { key: "big_board", label: "Big Board" },
    // "games_log" (Games Charted) intentionally hidden from the tab bar — data/rendering
    // kept intact below (tab === "games_log"), just not user-reachable via nav.
    { key: "analysis",  label: "Analysis" },
    { key: "compare",   label: "Compare" },
    { key: "recruits",  label: "Recruits" },
    { key: "recruit_stats", label: "Recruit Statistics" },
    { key: "pff_links", label: "PFF Links" },
  ];

  const positionTabs: PositionTab[] = ["QB", "RB", "WR", "TE"];

  // Snaps per prospect, sourced from the four prospect_*_stats views.
  // WR uses prospect_route_stats.total_snaps (already on prospectsWithStats);
  // RB/QB/TE come from the position-stub views fetched in loadAll.
  const snapsByProspect = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of prospectsWithStats) {
      if (p.total_snaps > 0) m.set(p.id, p.total_snaps);
    }
    for (const r of posSnapsRows) {
      if (r.total_snaps > 0) m.set(r.prospect_id, r.total_snaps);
    }
    return m;
  }, [prospectsWithStats, posSnapsRows]);

  const headerBreakdown = useMemo(() => {
    const years = [...new Set(prospectsWithStats.map((p) => p.draft_class_year))].sort();
    return years.map((year) => ({
      year,
      positions: POSITIONS.map((pos) => {
        const group = prospectsWithStats.filter((p) => p.draft_class_year === year && p.position === pos);
        const groupIds = new Set(group.map((p) => p.id));
        const groupGames = games.filter((g) => groupIds.has(g.prospect_id));
        const snaps = group.reduce((s, p) => s + (snapsByProspect.get(p.id) ?? 0), 0);
        return {
          pos,
          prospects: group.length,
          fully: group.filter((p) => p.charting_decision === "fully_charted").length,
          partial: group.filter((p) => p.charting_decision === "partial_chart").length,
          games: groupGames.length,
          snaps,
        };
      }).filter((r) => r.prospects > 0),
    }));
  }, [prospectsWithStats, games, snapsByProspect]);

  // A prospect's Overview page: the Big Board's inputs, so its AE Score,
  // Dynasty and percentiles match the board's (useProspectScores).
  const overviewData = useMemo<OverviewData>(() => ({
    prospects: prospectsWithStats, games, rbPlays, qbPlays, tePlays,
    gameRouteCells, gradingData, pffTotals, loadPositionPlays, scoresReady,
  }), [prospectsWithStats, games, rbPlays, qbPlays, tePlays, gameRouteCells, gradingData, pffTotals, loadPositionPlays, scoresReady]);

  // Shared props for all position hubs
  const hubProps = {
    overviewData,
    prospectsWithStats,
    loading,
    onAddProspect: handleAddProspect,
    onDataChanged: reloadHub,
    draftYearFilter,
    setDraftYearFilter,
    navigateToProspect: pendingProspect,
    onNavigated: () => setPendingProspect(null),
    // League-wide (all charted prospects at that position) data — used by the
    // "Charts" tab's percentile-tiered radar (H1). WRHub ignores these extra
    // props since route_stats already lives on prospectsWithStats.
    games,
    rbPlays,
    qbPlays,
    tePlays,
    // Full-career success-rate breakdowns for the Prospects-list badges (Phase 3).
    qbDepthZoneStatsByProspect,
    rbRunTypeStatsByProspect,
    teCoverageStatsByProspect,
    teBlockStatsByProspect,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hub header */}
      <div className="border-b border-slate-800 bg-slate-950">
        <div className="px-4 py-4">
          <div className="flex items-start justify-center flex-wrap gap-2">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white">Scouting Hub</h1>
              <div className="mt-1.5 space-y-1">
                {headerBreakdown.map(({ year, positions }) => (
                  <div key={year} className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-blue-400 font-semibold w-10 shrink-0">{year}</span>
                    {positions.map((r) => (
                      <span key={r.pos} className="text-slate-400">
                        <span className="text-slate-300 font-medium">{r.pos}</span>
                        {": "}
                        {r.prospects} prospects
                        {" · "}
                        <span className="text-emerald-400">{r.fully} FC</span>
                        {r.partial > 0 && <> · <span className="text-amber-400">{r.partial} PC</span></>}
                        {" · "}
                        {r.games} games
                        {" · "}
                        {r.snaps.toLocaleString()} snaps
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main tab bar. The tabs are wider than a phone: the bar scrolls
              sideways there and centres only when it fits. (justify-center on an
              overflowing flex row pushed "Prospects" off the left edge, out of
              reach, and widened the whole page on the right.) */}
          <div className="mt-4 border-b border-slate-800 -mb-px overflow-x-auto">
            <div className="flex gap-1 w-max mx-auto">
              {hubTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    tab === t.key
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-6">
        {tab === "prospects" && (
          <>
            {/* Position sub-tabs */}
            <div className="flex gap-1 mb-5 border-b border-slate-800">
              {positionTabs.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPositionTab(pos)}
                  className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    positionTab === pos
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-white"
                  }`}
                >
                  <span className="hidden sm:inline">{POSITION_LABELS[pos]}</span>
                  <span className="sm:hidden">{pos}</span>
                </button>
              ))}
            </div>

            {positionTab === "WR" && <WRHub {...hubProps} wrModel={wrModel} />}
            {positionTab === "RB" && <RBHub {...hubProps} />}
            {positionTab === "QB" && <QBHub {...hubProps} />}
            {positionTab === "TE" && <TEHub {...hubProps} />}
          </>
        )}

        {tab === "big_board" && (
          <BigBoard
            prospects={prospectsWithStats}
            loading={loading}
            onSelectProspect={(p) => { setPositionTab(p.position as PositionTab); setTab("prospects"); }}
            onUpdateRank={handleUpdateRank}
            onUpdateOverallRank={handleUpdateOverallRank}
            onUpdateGrade={handleUpdateGrade}
            onUpdateDraftRound={handleUpdateDraftRound}
            draftYearFilter={draftYearFilter}
            setDraftYearFilter={setDraftYearFilter}
            games={games}
            rbPlays={rbPlays}
            qbPlays={qbPlays}
            tePlays={tePlays}
            loadPositionPlays={loadPositionPlays}
            gameRouteCells={gameRouteCells}
            scoresReady={scoresReady}
            onLockAEScore={handleLockAEScore}
            inputsComplete={inputsComplete}
            onSaveBoardScores={handleSaveBoardScores}
            pffTotals={pffTotals}
            gradingData={gradingData}
          />
        )}

        {tab === "games_log" && (
          <GamesLog
            games={games}
            gameSnapStats={gameSnapStatsRows}
            prospects={prospectsWithStats}
            rbPlays={rbPlays}
            qbPlays={qbPlays}
            tePlays={tePlays}
            loadPositionPlays={loadPositionPlays}
            loading={loading}
            onSelectProspect={(p) => { setPositionTab(p.position as PositionTab); setTab("prospects"); }}
          />
        )}

        {tab === "analysis" && (
          <AnalysisHub
            prospects={prospects}
            prospectsWithStats={prospectsWithStats}
            games={games}
            rbPlays={rbPlays}
            qbPlays={qbPlays}
            tePlays={tePlays}
            loadPositionPlays={loadPositionPlays}
            loading={loading}
            draftYearFilter={draftYearFilter}
            setDraftYearFilter={setDraftYearFilter}
            pffTotals={pffTotals}
            gradingData={gradingData}
            gameRouteCells={gameRouteCells}
            onSelectProspect={(p) => {
              setPendingProspect(p);
              setPositionTab(p.position as PositionTab);
              setTab("prospects");
            }}
          />
        )}

        {tab === "compare" && (
          <CompareProspectsTab
            prospects={prospects}
            prospectsWithStats={prospectsWithStats}
            games={games}
            rbPlays={rbPlays}
            qbPlays={qbPlays}
            tePlays={tePlays}
            loadPositionPlays={loadPositionPlays}
            loading={loading}
            pffTotals={pffTotals}
            gradingData={gradingData}
          />
        )}

        {tab === "recruits" && (
          <RecruitsTab />
        )}

        {tab === "recruit_stats" && (
          <RecruitStatsTab />
        )}

        {tab === "pff_links" && (
          <PffLinksTab onStatsChanged={reloadHub} />
        )}
      </div>
    </div>
  );
}
