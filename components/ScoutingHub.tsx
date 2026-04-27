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

// Paginate a *_plays table by game_id IN (...) until exhausted. Used by
// the lazy-fetch hook below — these are the same fetches that previously
// ran inside AnalysisHub. Lifting them up so GamesLog can also share the
// loaded data without each tab paying its own round-trip.
async function fetchPlaysByGame<T>(
  table: "rb_plays" | "qb_plays" | "te_plays",
  gameIds: string[],
): Promise<T[]> {
  if (gameIds.length === 0) return [];
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select("*").in("game_id", gameIds).range(from, from + PAGE - 1);
    if (error) { log.error(`${table} load`, { msg: error.message }); break; }
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
    from += PAGE;
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
const RecruitsTab = dynamic(() => import("./scouting/RecruitsTab"), { ssr: false });
const RecruitStatsTab = dynamic(() => import("./scouting/RecruitStatsTab"), { ssr: false });

type HubTab = "prospects" | "big_board" | "games_log" | "analysis" | "recruits" | "recruit_stats";
type PositionTab = "WR" | "RB" | "QB" | "TE";

const POSITIONS: PositionTab[] = ["QB", "RB", "WR", "TE"];

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
        supabase.from("prospect_rb_stats").select("prospect_id,total_snaps"),
        supabase.from("prospect_qb_stats").select("prospect_id,total_snaps"),
        supabase.from("prospect_te_stats").select("prospect_id,total_snaps"),
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
      setPosSnapsRows([
        ...((rbStatsData ?? []) as PosSnapsRow[]),
        ...((qbStatsData ?? []) as PosSnapsRow[]),
        ...((teStatsData ?? []) as PosSnapsRow[]),
      ]);
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
    if (pos === "RB") fetchPlaysByGame<RBPlay>("rb_plays", ids).then((rows) => { setRbPlays(rows); });
    else if (pos === "QB") fetchPlaysByGame<QBPlay>("qb_plays", ids).then((rows) => { setQbPlays(rows); });
    else if (pos === "TE") fetchPlaysByGame<TEPlay>("te_plays", ids).then((rows) => { setTePlays(rows); });
  }, [loading, games, gameIdsKey]);

  // Server-aggregated path: merge view rows + league baselines into ProspectWithStats.
  // Replaces the per-snap JS reduce.
  const prospectsWithStats = useMemo(
    (): ProspectWithStats[] =>
      buildProspectsWithStats(prospects, routeStatsRows, leagueBaselines),
    [prospects, routeStatsRows, leagueBaselines],
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
    { key: "games_log", label: "Games Charted" },
    { key: "analysis",  label: "Analysis" },
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
          charted: group.filter((p) => p.total_games > 0).length,
          charting: group.filter((p) => p.total_games === 0 && p.charting_decision === "charting").length,
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
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hub header */}
      <div className="border-b border-gray-800 bg-gray-950">
        <div className="px-4 py-4">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-2xl font-bold text-white">Scouting Hub</h1>
              <div className="mt-1.5 space-y-1">
                {headerBreakdown.map(({ year, positions }) => (
                  <div key={year} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-blue-400 font-semibold w-10 shrink-0">{year}</span>
                    {positions.map((r) => (
                      <span key={r.pos} className="text-gray-400">
                        <span className="text-gray-300 font-medium">{r.pos}</span>
                        {": "}
                        {r.prospects} prospects
                        {" · "}
                        <span className="text-green-400">{r.charted} charted</span>
                        {r.charting > 0 && <> · <span className="text-yellow-400">{r.charting} charting</span></>}
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
          <div className="flex gap-1 mt-4 border-b border-gray-800 -mb-px">
            {hubTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                  tab === t.key
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-white"
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
            <div className="flex gap-1 mb-5 border-b border-gray-800">
              {positionTabs.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPositionTab(pos)}
                  className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    positionTab === pos
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-gray-400 hover:text-white"
                  }`}
                >
                  {pos}
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
