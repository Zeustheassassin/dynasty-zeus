import { useState, useEffect } from "react";
import { supabase } from "../../../../lib/supabaseclient";
import { logger } from "../../../../lib/logger";
import { usePlayers } from "../../../../lib/PlayersContext";
import { useAuth } from "../../../../lib/AuthContext";
import { useLeague } from "../../../../lib/LeagueContext";
import { useValues } from "../../../../lib/ValuesContext";
import { CURRENT_YEAR as ROOKIE_YEAR } from "../../../../lib/helpers";
import { toPickSlot } from "../../shared";
import type { SleeperLeague, SleeperUser } from "../../../../lib/types";
import type {
  HistoryDraftPick, HistoryDraftEntry, SleeperDraftBasic,
  SleeperPickBasic, ConsensusCacheRow,
} from "../../shared";

const log = logger("components/draftHub/DraftHistory");

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
  const [loadingCacheYear, setLoadingCacheYear] = useState<string | null>(null);
  const [compiling, setCompiling]             = useState(false);
  const [compileLog, setCompileLog]           = useState("");
  const [compileProgress, setCompileProgress] = useState(0);
  const [showCompilePanel, setShowCompilePanel] = useState(false);
  const [compileSelectedYears, setCompileSelectedYears] = useState<Set<number>>(() => {
    const cur = new Date().getFullYear();
    return new Set(Array.from({ length: cur - 2020 }, (_, i) => 2020 + i));
  });
  const [playerGrades, setPlayerGrades] = useState<Record<string, "hit" | "neutral" | "bust">>({});

  // ── Effects ───────────────────────────────────────────────────────────────

  // Load historical draft data when HISTORY tab first opens
  useEffect(() => {
    if (historyLoaded || !leagues.length) return;
    setHistoryLoading(true);

    const load = async () => {
      const results: HistoryDraftEntry[] = [];

      await Promise.all(leagues.map(async (league) => {
        const toCheck: Array<{ id: string; name: string }> = [];
        let prevId: string | null = league.previous_league_id ?? null;
        let depth = 0;
        while (prevId && depth < 3) {
          toCheck.push({ id: prevId, name: league.name });
          try {
            const pl = await fetch(`https://api.sleeper.app/v1/league/${prevId}`).then(r => r.json());
            prevId = pl.previous_league_id ?? null;
          } catch { break; }
          depth++;
        }

        await Promise.all(toCheck.map(async ({ id: leagueId, name: leagueName }) => {
          try {
            const drafts: SleeperDraftBasic[] = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json());
            if (!Array.isArray(drafts)) return;
            const rookieDrafts = drafts.filter((d) =>
              d.status === "complete" &&
              (d.settings?.rounds ?? d.rounds ?? 99) <= 6 &&
              d.season !== ROOKIE_YEAR
            );
            await Promise.all(rookieDrafts.map(async (draft) => {
              try {
                const picks: SleeperPickBasic[] = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`).then(r => r.json());
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, leagues.length]);

  // Auto-select the most recent year once history or compiled meta data loads
  useEffect(() => {
    if (selectedHistoryYear !== "ALL") return;
    const allYears = Array.from(new Set([
      ...historyData.map((d) => d.season),
      ...Object.keys(consensusMeta),
    ])).sort().reverse() as string[];
    if (allYears.length > 0) setSelectedHistoryYear(allYears[0]);
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
      try {
        const saved = localStorage.getItem("consensusPlayerGrades");
        if (saved) setPlayerGrades(JSON.parse(saved));
      } catch {}
      return;
    }
    supabase.from("consensus_player_grades")
      .select("grades")
      .eq("user_id", supabaseUser.id)
      .single()
      .then(({ data }: { data: { grades: Record<string, string> } | null }) => {
        if (data?.grades && typeof data.grades === "object") {
          setPlayerGrades(data.grades as Record<string, "hit" | "neutral" | "bust">);
          try { localStorage.setItem("consensusPlayerGrades", JSON.stringify(data.grades)); } catch {}
        } else {
          try {
            const saved = localStorage.getItem("consensusPlayerGrades");
            if (saved) setPlayerGrades(JSON.parse(saved));
          } catch {}
        }
      });
  }, [supabaseUser?.id]); // eslint-disable-line

  // Load cached consensus rows when viewing CONSENSUS tab for a compiled year
  useEffect(() => {
    if (!supabaseUser || historyTab !== "CONSENSUS") return;
    if (!selectedHistoryYear || selectedHistoryYear === "ALL") return;
    if (!consensusMeta[selectedHistoryYear]) return;
    if (consensusCache[selectedHistoryYear] !== undefined) return;

    setLoadingCacheYear(selectedHistoryYear);
    supabase
      .from("consensus_draft_cache")
      .select("player_id, player_name, position, team, avg_pick_no, draft_count")
      .eq("user_id", supabaseUser.id)
      .eq("year", parseInt(selectedHistoryYear, 10))
      .order("avg_pick_no", { ascending: true })
      .then(({ data }) => {
        setConsensusCache((prev) => ({ ...prev, [selectedHistoryYear]: (data ?? []) as ConsensusCacheRow[] }));
        setLoadingCacheYear(null);
      });
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
      try { localStorage.setItem("consensusPlayerGrades", JSON.stringify(next)); } catch {}
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
    setConsensusMeta((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
    setConsensusCache((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
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
    myPicksList,
    gradeReport,
    // mutations
    runCompile,
    removeCompiledPlayer,
    clearYear,
    setGrade,
  };
}
