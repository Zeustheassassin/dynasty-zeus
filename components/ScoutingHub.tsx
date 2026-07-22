"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import type {
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
import {
  buildProspectsWithStats,
  type ProspectRouteStatsRow,
  type LeagueRouteBaselineRow,
} from "../lib/scouting/aggregateMerge";

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

type HubTab = "prospects" | "big_board" | "games_log" | "analysis" | "compare" | "recruits" | "recruit_stats";
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
  const [leagueBaselines, setLeagueBaselines] = useState<LeagueRouteBaselineRow[]>([]);
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

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: pData, error: pErr },
        { data: gData, error: gErr },
        { data: rsData, error: rsErr },
        { data: lbData, error: lbErr },
        { data: gssData, error: gssErr },
        { data: rbStatsData, error: rbStatsErr },
        { data: qbStatsData, error: qbStatsErr },
        { data: teStatsData, error: teStatsErr },
      ] = await Promise.all([
        supabase.from("prospects").select("*").order("personal_rank", { ascending: true, nullsFirst: false }),
        supabase.from("scouting_games").select("*").order("season_year", { ascending: false }),
        supabase.from("prospect_route_stats").select("*"),
        supabase.from("league_route_baselines").select("*"),
        supabase.from("prospect_game_snap_stats").select("*"),
        supabase.from("prospect_rb_stats").select("prospect_id,total_snaps,run_type_stats_raw"),
        supabase.from("prospect_qb_stats").select("prospect_id,total_snaps,total_throws,depth_zone_stats_raw"),
        supabase.from("prospect_te_stats").select("prospect_id,total_snaps,total_routes,coverage_stats_raw,block_stats_raw"),
      ]);
      if (pErr) log.error("prospects load", { msg: pErr.message, code: pErr.code, details: pErr.details, hint: pErr.hint });
      if (gErr) log.error("games load", { msg: gErr.message, code: gErr.code, details: gErr.details, hint: gErr.hint });
      if (rsErr) log.error("prospect_route_stats load", { msg: rsErr.message, code: rsErr.code, details: rsErr.details, hint: rsErr.hint });
      if (lbErr) log.error("league_route_baselines load", { msg: lbErr.message, code: lbErr.code, details: lbErr.details, hint: lbErr.hint });
      if (gssErr) log.error("prospect_game_snap_stats load", { msg: gssErr.message, code: gssErr.code, details: gssErr.details, hint: gssErr.hint, raw: JSON.stringify(gssErr) });
      if (rbStatsErr) log.error("prospect_rb_stats load", { msg: rbStatsErr.message });
      if (qbStatsErr) log.error("prospect_qb_stats load", { msg: qbStatsErr.message });
      if (teStatsErr) log.error("prospect_te_stats load", { msg: teStatsErr.message });

      // Reset lazy-fetch cache so a parent reload re-fetches plays the
      // next time AnalysisHub or GamesLog needs them.
      fetchedPlaysRef.current = { RB: null, QB: null, TE: null };
      setRbPlays([]);
      setQbPlays([]);
      setTePlays([]);

      setProspects((pData ?? []) as Prospect[]);
      setGames((gData ?? []) as ScoutingGame[]);
      setRouteStatsRows((rsData ?? []) as ProspectRouteStatsRow[]);
      setLeagueBaselines((lbData ?? []) as LeagueRouteBaselineRow[]);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
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
    if (pos === "RB") fetchPlaysByGame<RBPlay>("rb_plays", ids).then((rows) => { setRbPlays(rows); }).catch(onErr);
    else if (pos === "QB") fetchPlaysByGame<QBPlay>("qb_plays", ids).then((rows) => { setQbPlays(rows); }).catch(onErr);
    else if (pos === "TE") fetchPlaysByGame<TEPlay>("te_plays", ids).then((rows) => { setTePlays(rows); }).catch(onErr);
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

  // Server-aggregated path: merge view rows + league baselines into ProspectWithStats.
  // Replaces the per-snap JS reduce.
  const prospectsWithStats = useMemo(
    (): ProspectWithStats[] =>
      buildProspectsWithStats(prospects, routeStatsRows, leagueBaselines, {
        qbThrowsByProspect,
        teRoutesByProspect,
      }),
    [prospects, routeStatsRows, leagueBaselines, qbThrowsByProspect, teRoutesByProspect],
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

  // Overall rank: #1 across all positions within a draft class
  async function handleUpdateOverallRank(id: string, targetRank: number) {
    const clamp = Math.max(1, targetRank);
    const mover = prospects.find((p) => p.id === id);
    if (!mover) return;

    const rankedOthers = prospects
      .filter((p) => p.overall_rank != null && p.id !== id && p.draft_class_year === mover.draft_class_year)
      .sort((a, b) => (a.overall_rank ?? 0) - (b.overall_rank ?? 0));

    rankedOthers.splice(Math.min(clamp - 1, rankedOthers.length), 0, mover);

    const rankMap = new Map<string, number>(rankedOthers.map((p, i) => [p.id, i + 1]));
    const changed = rankedOthers.filter((p) => p.overall_rank !== rankMap.get(p.id));
    setProspects((prev) => prev.map((p) => rankMap.has(p.id) ? { ...p, overall_rank: rankMap.get(p.id)! } : p));

    await Promise.all(
      changed.map((p) =>
        supabase.from("prospects").update({ overall_rank: rankMap.get(p.id), updated_at: new Date().toISOString() }).eq("id", p.id)
      )
    );
  }

  const hubTabs: { key: HubTab; label: string }[] = [
    { key: "prospects", label: "Prospects" },
    { key: "big_board", label: "Big Board" },
    // "games_log" (Games Charted) intentionally hidden from the tab bar — data/rendering
    // kept intact below (tab === "games_log"), just not user-reachable via nav.
    { key: "analysis",  label: "Analysis" },
    { key: "compare",   label: "Compare" },
    { key: "recruits",  label: "Recruits" },
    { key: "recruit_stats", label: "Recruit Statistics" },
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

  // Shared props for all position hubs
  const hubProps = {
    prospectsWithStats,
    loading,
    onAddProspect: handleAddProspect,
    onDataChanged: loadAll,
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

          {/* Main tab bar */}
          <div className="flex justify-center gap-1 mt-4 border-b border-slate-800 -mb-px">
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

            {positionTab === "WR" && <WRHub {...hubProps} />}
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
            draftYearFilter={draftYearFilter}
            setDraftYearFilter={setDraftYearFilter}
            games={games}
            rbPlays={rbPlays}
            qbPlays={qbPlays}
            tePlays={tePlays}
            loadPositionPlays={loadPositionPlays}
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
          />
        )}

        {tab === "recruits" && (
          <RecruitsTab />
        )}

        {tab === "recruit_stats" && (
          <RecruitStatsTab />
        )}
      </div>
    </div>
  );
}
