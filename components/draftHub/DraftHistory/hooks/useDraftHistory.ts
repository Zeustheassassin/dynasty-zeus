import { useState, useEffect } from "react";
import { supabase } from "../../../../lib/supabaseclient";
import { logger } from "../../../../lib/logger";
import { sleeperApi } from "../../../../lib/sleeperApi";
import { usePlayers } from "../../../../lib/PlayersContext";
import { useAuth } from "../../../../lib/AuthContext";
import { useLeague } from "../../../../lib/LeagueContext";
import { useValues } from "../../../../lib/ValuesContext";
import { BASE_YEAR, ROOKIE_DRAFT_MAX_ROUNDS } from "../../../../lib/helpers";
import { toPickSlot } from "../../shared";
import type { SleeperLeague, SleeperUser } from "../../../../lib/types";
import type {
  HistoryDraftPick, HistoryDraftEntry, SleeperDraftBasic,
  SleeperPickBasic, ConsensusCacheRow, ConsensusHistoryPoint, ConsensusMoverEntry,
} from "../../shared";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

const log = logger("components/draftHub/DraftHistory");

// Rookie-draft class year tracks the CALENDAR (upcoming class), not the NFL season.
const ROOKIE_YEAR = String(BASE_YEAR);

type ConsensusMeta = Record<string, {
  draftCount: number;
  leagueCount: number;
  connectedUserCount: number;
  compiledAt: string;
}>;

export function useDraftHistory(leagues: SleeperLeague[], user: SleeperUser | null) {
  const players = usePlayers();
  const { supabaseUser } = useAuth();
  const { selectedLeague } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues, pickFcValues } = useValues();

  // ── State ────────────────────────────────────────────────────────────────
  const [historyData, setHistoryData]       = useState<HistoryDraftEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded]   = useState(false);
  const [historyTab, setHistoryTab]         = useState<"LEAGUE" | "CONSENSUS" | "MY_PICKS" | "GRADES">("LEAGUE");
  const [selectedHistoryYear, setSelectedHistoryYear] = useState("ALL");
  const [myPicksSort, setMyPicksSort] = useState<{ col: "times" | "avgPick" | "value"; dir: "asc" | "desc" }>({ col: "times", dir: "desc" });

  const [consensusMeta, setConsensusMeta] = useState<ConsensusMeta>({});
  const [consensusCache, setConsensusCache] = useState<Record<string, ConsensusCacheRow[]>>({});
  const [consensusHistory, setConsensusHistory] = useState<Record<string, Record<string, ConsensusHistoryPoint[]>>>({});
  const [loadingCacheYear, setLoadingCacheYear] = useState<string | null>(null);
  const [compiling, setCompiling]             = useState(false);
  const [compileLog, setCompileLog]           = useState("");
  const [compileProgress, setCompileProgress] = useState(0);
  const [showCompilePanel, setShowCompilePanel] = useState(false);
  const [compileSelectedYears, setCompileSelectedYears] = useState<Set<number>>(() => {
    // Calendar year (not NFL season-year): draft history is bucketed by calendar year.
    const cur = new Date().getFullYear();
    // Include current year so in-progress drafts can be compiled for a rough live ADP read.
    return new Set(Array.from({ length: cur - 2020 + 1 }, (_, i) => 2020 + i));
  });
  const [playerGrades, setPlayerGrades] = useState<Record<string, "hit" | "neutral" | "bust">>({});

  // ── Effects ───────────────────────────────────────────────────────────────

  // Load historical draft data when HISTORY tab first opens
  useEffect(() => {
    if (historyLoaded || !leagues.length) return;

    const load = async () => {
      setHistoryLoading(true);
      const results: HistoryDraftEntry[] = [];

      await Promise.all(leagues.map(async (league) => {
        // Always include the current league so its in-progress / completed current-year draft appears.
        const toCheck: Array<{ id: string; name: string }> = [
          { id: league.league_id, name: league.name },
        ];
        let prevId: string | null = league.previous_league_id ?? null;
        let depth = 0;
        while (prevId && depth < 3) {
          toCheck.push({ id: prevId, name: league.name });
          const pl = await sleeperApi.getLeagueInfo(prevId);
          if (!pl) break;
          prevId = pl.previous_league_id ?? null;
          depth++;
        }

        await Promise.all(toCheck.map(async ({ id: leagueId, name: leagueName }) => {
          try {
            const drafts: SleeperDraftBasic[] = await sleeperApi.getLeagueDrafts(leagueId);
            if (!Array.isArray(drafts)) return;
            const rookieDrafts = drafts.filter((d) => {
              const rounds = d.settings?.rounds ?? d.rounds ?? 99;
              if (rounds > ROOKIE_DRAFT_MAX_ROUNDS) return false;
              // Past years: only completed drafts.
              if (d.season !== ROOKIE_YEAR) return d.status === "complete";
              // Current year: include in-progress drafts so partial picks show as live ADP signal.
              return d.status === "complete" || d.status === "drafting" || d.status === "paused";
            });
            await Promise.all(rookieDrafts.map(async (draft) => {
              try {
                const picks: SleeperPickBasic[] = await sleeperApi.getDraftPicks(draft.draft_id);
                if (!Array.isArray(picks)) return;
                const processed: HistoryDraftPick[] = picks.map((pick) => {
                  const p = players[pick.player_id];
                  const val = calcFcValues[pick.player_id] ?? p?.value ?? 0;
                  return {
                    slot: `${pick.round}.${String(pick.draft_slot).padStart(2, "0")}`,
                    pickNo: pick.pick_no,
                    player_id: pick.player_id,
                    name: p?.full_name || `${pick.metadata?.first_name || ""} ${pick.metadata?.last_name || ""}`.trim() || "Unknown",
                    position: p?.position || pick.metadata?.position || "",
                    team: p?.team || pick.metadata?.team || "",
                    value: val,
                    pickedByUserId: pick.picked_by || null,
                  };
                }).sort((a, b) => a.pickNo - b.pickNo);
                results.push({ leagueName, leagueId, season: draft.season, draftId: draft.draft_id, picks: processed });
              } catch {}
            }));
          } catch {}
        }));
      }));

      results.sort((a, b) => b.season.localeCompare(a.season) || a.leagueName.localeCompare(b.leagueName));
      setHistoryData(results);
      setHistoryLoading(false);
      setHistoryLoaded(true);
    };

    load();
  }, [historyLoaded, leagues, players, calcFcValues]);

  // Auto-select the most recent year once history or compiled meta data loads
  useEffect(() => {
    void (async () => {
      if (selectedHistoryYear !== "ALL") return;
      const allYears = Array.from(new Set([
        ...historyData.map((d) => d.season),
        ...Object.keys(consensusMeta),
      ])).sort().reverse() as string[];
      if (allYears.length > 0) setSelectedHistoryYear(allYears[0]);
    })();
  }, [historyData.length, consensusMeta]); // eslint-disable-line

  // Load consensus meta from Supabase
  useEffect(() => {
    if (!supabaseUser) return;
    if (Object.keys(consensusMeta).length > 0) return;
    supabase
      .from("consensus_draft_meta")
      .select("year, total_drafts, total_leagues, connected_user_count, compiled_at")
      .eq("user_id", supabaseUser.id)
      .then(({ data }) => {
        if (!data) return;
        const meta: ConsensusMeta = {};
        (data as Array<{ year: number; total_drafts: number; total_leagues: number; connected_user_count: number; compiled_at: string }>).forEach((row) => {
          meta[String(row.year)] = {
            draftCount:         row.total_drafts,
            leagueCount:        row.total_leagues,
            connectedUserCount: row.connected_user_count,
            compiledAt:         row.compiled_at,
          };
        });
        setConsensusMeta(meta);
      });
  }, [supabaseUser?.id]); // eslint-disable-line

  // Load player grades from Supabase (localStorage fallback)
  useEffect(() => {
    if (!supabaseUser) {
      void (async () => {
        const saved = getLocalStorageItem<Record<string, "hit" | "neutral" | "bust"> | null>("consensusPlayerGrades", null);
        if (saved) setPlayerGrades(saved);
      })();
      return;
    }
    supabase.from("consensus_player_grades")
      .select("grades")
      .eq("user_id", supabaseUser.id)
      .single()
      .then(({ data }: { data: { grades: Record<string, string> } | null }) => {
        if (data?.grades && typeof data.grades === "object") {
          setPlayerGrades(data.grades as Record<string, "hit" | "neutral" | "bust">);
          setLocalStorageItem("consensusPlayerGrades", data.grades);
        } else {
          const saved = getLocalStorageItem<Record<string, "hit" | "neutral" | "bust"> | null>("consensusPlayerGrades", null);
          if (saved) setPlayerGrades(saved);
        }
      });
  }, [supabaseUser?.id]); // eslint-disable-line

  // Load cached consensus rows when viewing CONSENSUS tab for a compiled year
  useEffect(() => {
    if (!supabaseUser || historyTab !== "CONSENSUS") return;
    if (!selectedHistoryYear || selectedHistoryYear === "ALL") return;
    if (!consensusMeta[selectedHistoryYear]) return;
    if (consensusCache[selectedHistoryYear] !== undefined) return;

    void (async () => {
      setLoadingCacheYear(selectedHistoryYear);
      const { data } = await supabase
        .from("consensus_draft_cache")
        .select("player_id, player_name, position, team, avg_pick_no, draft_count")
        .eq("user_id", supabaseUser.id)
        .eq("year", parseInt(selectedHistoryYear, 10))
        .order("avg_pick_no", { ascending: true });
      setConsensusCache((prev) => ({ ...prev, [selectedHistoryYear]: (data ?? []) as ConsensusCacheRow[] }));
      setLoadingCacheYear(null);
    })();
  }, [supabaseUser?.id, historyTab, selectedHistoryYear, consensusMeta]); // eslint-disable-line

  // Load ADP history (one row per past compile run) for the CONSENSUS tab's
  // sparklines + riser/faller callouts. Same gating as the cache load above,
  // kept as a separate query since most page loads never touch this data —
  // it's meaningful only once a year has been recompiled more than once.
  useEffect(() => {
    if (!supabaseUser || historyTab !== "CONSENSUS") return;
    if (!selectedHistoryYear || selectedHistoryYear === "ALL") return;
    if (!consensusMeta[selectedHistoryYear]) return;
    if (consensusHistory[selectedHistoryYear] !== undefined) return;

    void (async () => {
      const { data } = await supabase
        .from("consensus_draft_history")
        .select("player_id, avg_pick_no, snapshotted_at")
        .eq("user_id", supabaseUser.id)
        .eq("year", parseInt(selectedHistoryYear, 10))
        .order("snapshotted_at", { ascending: true });

      const byPlayer: Record<string, ConsensusHistoryPoint[]> = {};
      (data as Array<{ player_id: string; avg_pick_no: number; snapshotted_at: string }> ?? []).forEach((row) => {
        if (!byPlayer[row.player_id]) byPlayer[row.player_id] = [];
        byPlayer[row.player_id].push({ avg_pick_no: row.avg_pick_no, snapshotted_at: row.snapshotted_at });
      });
      setConsensusHistory((prev) => ({ ...prev, [selectedHistoryYear]: byPlayer }));
    })();
  }, [supabaseUser?.id, historyTab, selectedHistoryYear, consensusMeta]); // eslint-disable-line

  // When GRADES tab opens, load ALL compiled years so every graded player has slot data
  useEffect(() => {
    if (historyTab !== "GRADES" || !supabaseUser) return;
    const yearsToLoad = Object.keys(consensusMeta).filter((yr) => consensusCache[yr] === undefined);
    yearsToLoad.forEach((year) => {
      supabase
        .from("consensus_draft_cache")
        .select("player_id, player_name, position, avg_pick_no")
        .eq("user_id", supabaseUser.id)
        .eq("year", parseInt(year, 10))
        .then(({ data }) => {
          setConsensusCache((prev) => ({ ...prev, [year]: (data ?? []) as ConsensusCacheRow[] }));
        });
    });
  }, [historyTab, supabaseUser?.id]); // eslint-disable-line

  // ── Mutations ─────────────────────────────────────────────────────────────

  const syncGradesToSupabase = (grades: Record<string, string>) => {
    if (!supabaseUser) return;
    supabase.from("consensus_player_grades")
      .upsert(
        { user_id: supabaseUser.id, grades, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) log.error("grade sync failed", { err: error.message });
      });
  };

  const setGrade = (year: string, playerId: string, grade: "hit" | "neutral" | "bust") => {
    setPlayerGrades((prev) => {
      const key  = `${year}_${playerId}`;
      const next = { ...prev };
      if (next[key] === grade) delete next[key];
      else next[key] = grade;
      setLocalStorageItem("consensusPlayerGrades", next);
      syncGradesToSupabase(next);
      return next;
    });
  };

  const runCompile = async (years: number[]) => {
    if (!user?.user_id || !supabaseUser) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    setCompiling(true);
    setCompileLog("Starting compilation…");
    setCompileProgress(0);

    try {
      const res = await fetch("/api/compile-consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sleeperUserId: user.user_id,
          accessToken:   session.access_token,
          years,
        }),
      });

      if (!res.ok || !res.body) {
        setCompileLog("Failed to start compilation — check that you are logged in.");
        setCompiling(false);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "status" || event.type === "done" || event.type === "error") {
              if (event.message)  setCompileLog(event.message);
              if (event.progress !== undefined) setCompileProgress(event.progress);
            }
            if (event.type === "year_done") {
              setConsensusMeta((prev) => ({
                ...prev,
                [String(event.year)]: {
                  draftCount:         event.draftCount,
                  leagueCount:        event.leagueCount,
                  connectedUserCount: event.connectedUserCount ?? 0,
                  compiledAt:         new Date().toISOString(),
                },
              }));
              setConsensusCache((prev) => {
                const next = { ...prev };
                delete next[String(event.year)];
                return next;
              });
              setConsensusHistory((prev) => {
                const next = { ...prev };
                delete next[String(event.year)];
                return next;
              });
            }
          } catch { /* malformed line — skip */ }
        }
      }
    } catch (err) {
      setCompileLog(`Error: ${(err as Error)?.message ?? "Unknown error"}`);
    }

    setCompiling(false);
    setCompileProgress(100);
  };

  const removeCompiledPlayer = async (year: string, playerId: string) => {
    if (!supabaseUser) return;
    await supabase.from("consensus_draft_cache")
      .delete()
      .eq("user_id", supabaseUser.id)
      .eq("year", parseInt(year, 10))
      .eq("player_id", playerId);
    setConsensusCache((prev) => ({
      ...prev,
      [year]: (prev[year] ?? []).filter((r) => r.player_id !== playerId),
    }));
  };

  const clearYear = async (year: number) => {
    if (!supabaseUser) return;
    await supabase.from("consensus_draft_cache")
      .delete().eq("user_id", supabaseUser.id).eq("year", year);
    await supabase.from("consensus_draft_meta")
      .delete().eq("user_id", supabaseUser.id).eq("year", year);
    await supabase.from("consensus_draft_history")
      .delete().eq("user_id", supabaseUser.id).eq("year", year);
    setConsensusMeta((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
    setConsensusCache((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
    setConsensusHistory((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
  };

  // ── Computed values ───────────────────────────────────────────────────────

  const availableYears = Array.from(new Set([
    ...historyData.map((d) => d.season),
    ...Object.keys(consensusMeta),
  ])).sort().reverse() as string[];

  const filteredDrafts = selectedHistoryYear === "ALL"
    ? historyData
    : historyData.filter((d) => d.season === selectedHistoryYear);

  const currentLeagueDraft = filteredDrafts.find((d) => d.leagueName === selectedLeague?.name) ?? null;
  const allFilteredPicks: HistoryDraftPick[] = filteredDrafts.flatMap((d) => d.picks);

  const consensusList = (() => {
    interface PickAcc extends HistoryDraftPick { picks: number[]; slots: string[]; draftCount?: number; avgPickNo?: number; }
    const map = new Map<string, PickAcc>();
    allFilteredPicks.forEach((pick) => {
      if (!pick.player_id || pick.name === "Unknown") return;
      if (!map.has(pick.player_id)) map.set(pick.player_id, { ...pick, picks: [], slots: [] });
      const e = map.get(pick.player_id)!;
      e.picks.push(pick.pickNo);
      e.slots.push(pick.slot);
      if (pick.value > (e.value || 0)) { e.value = pick.value; e.name = pick.name; }
    });
    return Array.from(map.values())
      .map(e => ({ ...e, avgPickNo: e.picks.reduce((s: number, p: number) => s + p, 0) / e.picks.length, draftCount: e.picks.length }))
      .sort((a, b) => a.avgPickNo - b.avgPickNo);
  })();

  // Riser/faller callouts (Phase G stage G3): compares each player's earliest
  // vs. latest compile-run snapshot for the selected year. Only ever non-empty
  // once a year has been recompiled 2+ times — a fresh compile gives every
  // player a single history point, which the `length >= 2` guard naturally
  // excludes rather than needing a separate "not enough runs yet" check.
  const RISER_FALLER_THRESHOLD = 2; // min |delta| in avg pick number to surface
  const riserFallerList = (() => {
    const yearHistory = consensusHistory[selectedHistoryYear];
    if (!yearHistory) return { risers: [] as ConsensusMoverEntry[], fallers: [] as ConsensusMoverEntry[] };
    const cacheRows = consensusCache[selectedHistoryYear] ?? [];
    const cacheByPlayer = new Map(cacheRows.map((r) => [r.player_id, r]));

    const movers: ConsensusMoverEntry[] = [];
    Object.entries(yearHistory).forEach(([playerId, points]) => {
      if (points.length < 2) return;
      const cacheRow = cacheByPlayer.get(playerId);
      if (!cacheRow) return; // player no longer on the board (e.g. removed) — skip
      const delta = points[0].avg_pick_no - points[points.length - 1].avg_pick_no; // positive = moved up
      if (Math.abs(delta) < RISER_FALLER_THRESHOLD) return;
      movers.push({ player_id: playerId, name: cacheRow.player_name, position: cacheRow.position, team: cacheRow.team, delta });
    });

    return {
      risers:  movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5),
      fallers: movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5),
    };
  })();

  const myPicksList = (() => {
    interface MyPickAcc extends HistoryDraftPick { picks: number[]; slots: string[]; timesDrafted?: number; avgPickNo?: number; }
    const map = new Map<string, MyPickAcc>();
    allFilteredPicks.filter((p) => p.pickedByUserId === user?.user_id).forEach((pick) => {
      if (!pick.player_id || pick.name === "Unknown") return;
      if (!map.has(pick.player_id)) map.set(pick.player_id, { ...pick, picks: [], slots: [] });
      const e = map.get(pick.player_id)!;
      e.picks.push(pick.pickNo);
      e.slots.push(pick.slot);
      if (pick.value > (e.value || 0)) { e.value = pick.value; e.name = pick.name; }
    });
    return Array.from(map.values())
      .map(e => ({ ...e, avgPickNo: e.picks.reduce((s: number, p: number) => s + p, 0) / e.picks.length, timesDrafted: e.picks.length }))
      .sort((a, b) => b.timesDrafted - a.timesDrafted || a.avgPickNo - b.avgPickNo);
  })();

  const gradeReport = (() => {
    const slotMap = new Map<string, {
      hit: number; neutral: number; bust: number;
      players: { name: string; position: string; year: string; grade: string; avgPickNo: number }[];
    }>();

    Object.entries(playerGrades).forEach(([key, grade]) => {
      const sep      = key.indexOf("_");
      const year     = key.substring(0, sep);
      const playerId = key.substring(sep + 1);
      const cacheRow = (consensusCache[year] ?? []).find((r) => r.player_id === playerId);
      if (!cacheRow) return;

      const slot = toPickSlot(cacheRow.avg_pick_no);
      if (!slotMap.has(slot)) slotMap.set(slot, { hit: 0, neutral: 0, bust: 0, players: [] });
      const entry = slotMap.get(slot)!;
      entry[grade as "hit" | "neutral" | "bust"]++;
      entry.players.push({
        name:      cacheRow.player_name,
        position:  cacheRow.position,
        year,
        grade,
        avgPickNo: cacheRow.avg_pick_no,
      });
    });

    return Array.from(slotMap.entries())
      .map(([slot, data]) => {
        const total = data.hit + data.neutral + data.bust;
        return {
          slot,
          hit:      data.hit,
          neutral:  data.neutral,
          bust:     data.bust,
          total,
          hitRate:  total ? data.hit     / total : 0,
          neutRate: total ? data.neutral / total : 0,
          bustRate: total ? data.bust    / total : 0,
          players:  [...data.players].sort((a, b) => a.avgPickNo - b.avgPickNo),
        };
      })
      .sort((a, b) => {
        const [ar, as_] = a.slot.split(".").map(Number);
        const [br, bs_] = b.slot.split(".").map(Number);
        return (ar - br) || (as_ - bs_);
      });
  })();

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    // loading / navigation state
    historyLoading,
    historyLoaded,
    historyData,
    historyTab,
    setHistoryTab,
    selectedHistoryYear,
    setSelectedHistoryYear,
    myPicksSort,
    setMyPicksSort,
    // consensus state
    consensusMeta,
    consensusCache,
    consensusHistory,
    loadingCacheYear,
    compiling,
    compileLog,
    compileProgress,
    showCompilePanel,
    setShowCompilePanel,
    compileSelectedYears,
    setCompileSelectedYears,
    playerGrades,
    // context pass-throughs
    supabaseUser,
    players,
    pickFcValues,
    calcFcValues,
    selectedLeagueName: selectedLeague?.name,
    // computed values
    availableYears,
    filteredDrafts,
    currentLeagueDraft,
    consensusList,
    riserFallerList,
    myPicksList,
    gradeReport,
    // mutations
    runCompile,
    removeCompiledPlayer,
    clearYear,
    setGrade,
  };
}
