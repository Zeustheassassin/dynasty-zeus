"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import type {
  Prospect,
  ProspectWithStats,
  ScoutingGame,
  RoutePlay,
} from "../lib/types";

const log = logger("ScoutingHub");

const WRHub = dynamic(() => import("./scouting/wr/WRHub"), { ssr: false });
const RBHub = dynamic(() => import("./scouting/rb/RBHub"), { ssr: false });
const QBHub = dynamic(() => import("./scouting/qb/QBHub"), { ssr: false });
const TEHub = dynamic(() => import("./scouting/te/TEHub"), { ssr: false });
const BigBoard = dynamic(() => import("./scouting/BigBoard"), { ssr: false });
const GamesLog = dynamic(() => import("./scouting/GamesLog"), { ssr: false });

type HubTab = "prospects" | "big_board" | "games_log";
type PositionTab = "WR" | "RB" | "QB" | "TE";

export default function ScoutingHub() {
  const [tab, setTab] = useState<HubTab>("prospects");
  const [positionTab, setPositionTab] = useState<PositionTab>("WR");
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [plays, setPlays] = useState<RoutePlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftYearFilter, setDraftYearFilter] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: pData, error: pErr }, { data: gData, error: gErr }] = await Promise.all([
        supabase.from("prospects").select("*").order("personal_rank", { ascending: true, nullsFirst: false }),
        supabase.from("scouting_games").select("*").order("season_year", { ascending: false }),
      ]);
      if (pErr) log.error("prospects load", { msg: pErr.message });
      if (gErr) log.error("games load", { msg: gErr.message });

      const pList: Prospect[] = pData ?? [];
      const gList: ScoutingGame[] = gData ?? [];
      setProspects(pList);
      setGames(gList);

      if (gList.length > 0) {
        const gameIds = gList.map((g) => g.id);
        const allPlays: RoutePlay[] = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("route_plays")
            .select("*")
            .in("game_id", gameIds)
            .range(from, from + PAGE - 1);
          if (error) { log.error("plays load", { msg: error.message }); break; }
          allPlays.push(...(data ?? []));
          if (!data || data.length < PAGE) break;
          from += PAGE;
        }
        setPlays(allPlays);
      } else {
        setPlays([]);
      }
    } catch (e) {
      log.error("loadAll", { msg: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Compute aggregate stats per prospect from plays
  const prospectsWithStats = useMemo((): ProspectWithStats[] => {
    const gamesByProspect: Record<string, string[]> = {};
    for (const g of games) {
      if (!gamesByProspect[g.prospect_id]) gamesByProspect[g.prospect_id] = [];
      gamesByProspect[g.prospect_id].push(g.id);
    }

    const ROUTE_TYPES: RoutePlay["route_type"][] = [
      "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
    ];

    // League-wide open rates from route runs only (no_route_run=false), used for SAE calculation
    const leagueRoute: Partial<Record<RoutePlay["route_type"], { open: number; count: number }>> = {};
    const leagueCvg: Record<string, { open: number; count: number }> = {
      man: { open: 0, count: 0 }, zone: { open: 0, count: 0 },
      double: { open: 0, count: 0 }, press: { open: 0, count: 0 },
    };
    for (const pl of plays) {
      if (pl.no_route_run) continue;
      if (!leagueRoute[pl.route_type]) leagueRoute[pl.route_type] = { open: 0, count: 0 };
      leagueRoute[pl.route_type]!.count++;
      if (pl.was_open) leagueRoute[pl.route_type]!.open++;
      if (pl.coverage === "man" || pl.coverage === "zone" || pl.coverage === "double" || pl.coverage === "press") {
        leagueCvg[pl.coverage].count++;
        if (pl.was_open) leagueCvg[pl.coverage].open++;
      }
    }

    return prospects.map((p) => {
      const gameIds = new Set(gamesByProspect[p.id] ?? []);
      // pPlays = all logged snaps; routePlays = only plays where a route was run
      const pPlays = plays.filter((pl) => gameIds.has(pl.game_id));
      const routePlays = pPlays.filter((pl) => !pl.no_route_run);

      const totalSnaps = pPlays.length;
      const totalRoutes = routePlays.length;
      const prospectGames = games.filter((g) => gameIds.has(g.id));

      // Use stored summary totals for imported games; compute from plays for charted games
      let tgt = 0, ctch = 0, drops = 0, contested = 0, contested_catches = 0;
      for (const g of prospectGames) {
        if (g.summary_targets != null) {
          tgt += g.summary_targets;
          ctch += g.summary_catches ?? 0;
          drops += g.summary_drops ?? 0;
          contested += g.summary_contested ?? 0;
          contested_catches += g.summary_contested_catches ?? 0;
        } else {
          const gPlays = routePlays.filter((pl) => pl.game_id === g.id);
          tgt += gPlays.filter((pl) => pl.targeted).length;
          ctch += gPlays.filter((pl) => pl.targeted && pl.success).length;
          drops += gPlays.filter((pl) => pl.targeted && pl.success === false).length;
          contested += gPlays.filter((pl) => pl.contested).length;
          contested_catches += gPlays.filter((pl) => pl.contested && pl.success === true).length;
        }
      }
      const yds = routePlays.reduce((s, pl) => s + (pl.yards ?? 0), 0);
      // Alignment % — out of total snaps (player is aligned on every snap)
      const leftN = pPlays.filter((pl) => pl.alignment === "left").length;
      const rightN = pPlays.filter((pl) => pl.alignment === "right").length;
      const slotN = pPlays.filter((pl) => pl.alignment === "slot").length;
      const bfN = pPlays.filter((pl) => pl.alignment === "backfield").length;

      const snapPct = (n: number) => (totalSnaps > 0 ? parseFloat(((n / totalSnaps) * 100).toFixed(1)) : null);
      const routePct = (n: number) => (totalRoutes > 0 ? parseFloat(((n / totalRoutes) * 100).toFixed(1)) : null);

      const extRanks = [p.pff_rank, p.mock_draft_rank, p.drafttek_rank, p.pfn_rank].filter(
        (r): r is number => r !== null && r !== undefined
      );

      // True only if this prospect has plays with was_open or success explicitly tracked.
      // was_open defaults to false (not null) for old plays, so we check for at least one true.
      // success is nullable; we check for at least one non-null targeted play.
      const has_charted_open_data =
        routePlays.some((pl) => pl.was_open) ||
        routePlays.some((pl) => pl.targeted && pl.success !== null);

      const route_stats: ProspectWithStats["route_stats"] = {};
      for (const rt of ROUTE_TYPES) {
        const rtPlays = routePlays.filter((pl) => pl.route_type === rt);
        if (rtPlays.length > 0) {
          route_stats[rt] = {
            count: rtPlays.length,
            open: has_charted_open_data ? rtPlays.filter((pl) => pl.was_open).length : 0,
            targets: rtPlays.filter((pl) => pl.targeted).length,
            catches: has_charted_open_data ? rtPlays.filter((pl) => pl.targeted && pl.success).length : -1,
          };
        }
      }

      const cvg = (type: "man" | "zone" | "double" | "press") => {
        const cvgPlays = routePlays.filter((pl) => pl.coverage === type);
        return {
          count: cvgPlays.length,
          open: has_charted_open_data ? cvgPlays.filter((pl) => pl.was_open).length : 0,
          catches: has_charted_open_data ? cvgPlays.filter((pl) => pl.targeted && pl.success).length : -1,
        };
      };

      return {
        ...p,
        total_snaps: totalSnaps,
        total_routes: totalRoutes,
        total_games: gameIds.size,
        targets: tgt,
        catches: ctch,
        drops,
        contested,
        contested_catches,
        total_yards: yds,
        // Suc% = open rate (SRVC) based on route runs only; suppress for prospects w/o was_open tracking
        success_rate: has_charted_open_data && totalRoutes > 0 ? parseFloat(((routePlays.filter((pl) => pl.was_open).length / totalRoutes) * 100).toFixed(1)) : null,
        target_rate: routePct(tgt),
        avg_ypc: ctch > 0 ? parseFloat((yds / ctch).toFixed(1)) : null,
        pct_left: snapPct(leftN),
        pct_right: snapPct(rightN),
        pct_slot: snapPct(slotN),
        pct_backfield: snapPct(bfN),
        pct_on_line: snapPct(pPlays.filter((pl) => pl.on_line).length),
        adj_success_above_exp: (() => {
          if (!has_charted_open_data || totalRoutes === 0) return null;
          const actualOpen = routePlays.filter((pl) => pl.was_open).length / totalRoutes;
          let expRoute = 0, routeW = 0;
          for (const rt of ROUTE_TYPES) {
            const rtCount = routePlays.filter((pl) => pl.route_type === rt).length;
            const lg = leagueRoute[rt];
            if (rtCount > 0 && lg && lg.count > 0) {
              expRoute += (rtCount / totalRoutes) * (lg.open / lg.count);
              routeW += rtCount / totalRoutes;
            }
          }
          let expCvg = 0, cvgW = 0;
          for (const cvgType of ["man", "zone", "double", "press"] as const) {
            const cvgCount = routePlays.filter((pl) => pl.coverage === cvgType).length;
            const lg = leagueCvg[cvgType];
            if (cvgCount > 0 && lg.count > 0) {
              expCvg += (cvgCount / totalRoutes) * (lg.open / lg.count);
              cvgW += cvgCount / totalRoutes;
            }
          }
          let combined: number | null = null;
          if (routeW > 0 && cvgW > 0) combined = (expRoute + expCvg) / 2;
          else if (routeW > 0) combined = expRoute;
          else if (cvgW > 0) combined = expCvg;
          return combined != null ? parseFloat(((actualOpen - combined) * 100).toFixed(2)) : null;
        })(),
        avg_external_rank:
          extRanks.length > 0
            ? parseFloat((extRanks.reduce((s, r) => s + r, 0) / extRanks.length).toFixed(1))
            : null,
        depth_behind_los: routePlays.filter((pl) => !pl.on_line).length,
        depth_on_los: routePlays.filter((pl) => pl.on_line).length,
        has_charted_open_data,
        route_stats,
        coverage_stats: { man: cvg("man"), zone: cvg("zone"), double: cvg("double"), press: cvg("press") },
        // Alignment open rates — only from manually-charted route runs (not NRR, not summary imports)
        ...(() => {
          const chartedIds = new Set(
            prospectGames.filter((g) => g.summary_targets == null).map((g) => g.id)
          );
          const cp = routePlays.filter((pl) => chartedIds.has(pl.game_id));
          const alignOpen = (align: string, onLine?: boolean): number | null => {
            let filtered = cp.filter((pl) => pl.alignment === align);
            if (onLine === true) filtered = filtered.filter((pl) => pl.on_line);
            if (onLine === false) filtered = filtered.filter((pl) => !pl.on_line);
            return filtered.length > 0
              ? parseFloat(((filtered.filter((pl) => pl.was_open).length / filtered.length) * 100).toFixed(1))
              : null;
          };
          return {
            open_pct_slot: alignOpen("slot"),
            open_pct_slot_on_line: alignOpen("slot", true),
            open_pct_slot_off_line: alignOpen("slot", false),
            open_pct_right: alignOpen("right"),
            open_pct_right_on_line: alignOpen("right", true),
            open_pct_right_off_line: alignOpen("right", false),
            open_pct_left: alignOpen("left"),
            open_pct_left_on_line: alignOpen("left", true),
            open_pct_left_off_line: alignOpen("left", false),
            open_pct_backfield: alignOpen("backfield"),
          };
        })(),
      };
    });
  }, [prospects, games, plays]);

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
  ];

  const positionTabs: PositionTab[] = ["QB", "RB", "WR", "TE"];

  const charted = prospectsWithStats.filter((p) => p.total_routes > 0).length;
  const pending = prospectsWithStats.filter((p) => p.charting_decision === "pending").length;

  // Shared props for all position hubs
  const hubProps = {
    prospectsWithStats,
    loading,
    onAddProspect: handleAddProspect,
    onDataChanged: loadAll,
    draftYearFilter,
    setDraftYearFilter,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hub header */}
      <div className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-2xl font-bold text-white">Scouting Hub</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                {prospectsWithStats.length} prospects ·{" "}
                <span className="text-green-400">{charted} charted</span> ·{" "}
                <span className="text-yellow-400">{pending} pending</span> ·{" "}
                {games.length} games · {plays.length} routes logged
              </p>
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
      <div className="max-w-7xl mx-auto px-4 py-6">
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
            plays={plays}
            prospects={prospectsWithStats}
            loading={loading}
            onSelectProspect={(p) => { setPositionTab(p.position as PositionTab); setTab("prospects"); }}
          />
        )}
      </div>
    </div>
  );
}
