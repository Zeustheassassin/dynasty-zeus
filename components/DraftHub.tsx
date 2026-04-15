"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseclient";
import { usePlayers } from "../lib/PlayersContext";
import { useAuth } from "../lib/AuthContext";
import PickValuesTab from "./draft/PickValuesTab";
import { CURRENT_YEAR as ROOKIE_YEAR } from "../lib/helpers";

// ── Module-level constants ─────────────────────────────────────────────────
// Upper bound for the draft grid — supports up to 6-round rookie drafts.
// The board trims this to the league's actual round count via activeRounds.
const MAX_ROUNDS = 6;
const ROUNDS = Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1);

const normalizeRookieName = (name: string) =>
  (name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "")
    .trim();

const posColor: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

const posBadge: Record<string, string> = {
  QB: "bg-purple-500/20 text-purple-400",
  RB: "bg-green-500/20 text-green-400",
  WR: "bg-blue-500/20 text-blue-400",
  TE: "bg-orange-500/20 text-orange-400",
};

const PICK_KEY_RE = /^\d{4}-(\d+)\.(\d+)$/;

function closestPickEquiv(playerValue: number, pickFcValues: Record<string, number>): { label: string; pickNo: number } {
  if (playerValue <= 0 || !Object.keys(pickFcValues).length) return { label: "—", pickNo: 0 };
  let bestKey = "";
  let bestDiff = Infinity;
  for (const [key, val] of Object.entries(pickFcValues)) {
    if (!PICK_KEY_RE.test(key)) continue; // skip non-slot keys
    const diff = Math.abs(val - playerValue);
    if (diff < bestDiff) { bestDiff = diff; bestKey = key; }
  }
  if (!bestKey) return { label: "—", pickNo: 0 };
  const m = bestKey.match(PICK_KEY_RE)!;
  const pickNo = (parseInt(m[1]) - 1) * 12 + parseInt(m[2]);
  const label = `${m[1]}.${m[2].padStart(2, "0")}`;
  return { label, pickNo };
}

function pickEquivColor(equivPickNo: number, draftedPickNo: number): string {
  if (equivPickNo === 0) return "text-gray-500";
  const diff = equivPickNo - draftedPickNo; // positive = worth less (bust), negative = worth more (hit)
  if (diff <= -12) return "text-emerald-400"; // big hit
  if (diff <= -4)  return "text-green-400";   // hit
  if (diff >= 12)  return "text-red-400";     // big bust
  if (diff >= 4)   return "text-orange-400";  // bust
  return "text-gray-300";                     // roughly even
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function fuzzyFcLookup(name: string, fcNameValues: Record<string, number>): number {
  const norm = normalizeRookieName(name);
  if (fcNameValues[norm] !== undefined) return fcNameValues[norm];
  // Allow edit distance ≤ 1 for names ≤ 12 chars, ≤ 2 for longer
  const maxDist = norm.length <= 12 ? 1 : 2;
  let bestVal = 0, bestDist = Infinity;
  for (const [key, val] of Object.entries(fcNameValues)) {
    if (val <= 0 || Math.abs(key.length - norm.length) > maxDist) continue;
    const dist = levenshtein(norm, key);
    if (dist <= maxDist && dist < bestDist) { bestDist = dist; bestVal = val; }
  }
  return bestVal;
}

function toPickSlot(avgPickNo: number, teamSize = 12): string {
  const n = Math.round(avgPickNo);
  const round = Math.floor((n - 1) / teamSize) + 1;
  const slot  = ((n - 1) % teamSize) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

function valueGrade(val: number): { label: string; cls: string } {
  if (val >= 6000) return { label: "Elite",      cls: "text-yellow-400 bg-yellow-900/30 border-yellow-700/50" };
  if (val >= 3500) return { label: "Starter",    cls: "text-green-400  bg-green-900/30  border-green-700/50"  };
  if (val >= 1500) return { label: "Developing", cls: "text-blue-400   bg-blue-900/30   border-blue-700/50"   };
  if (val >= 500)  return { label: "Fringe",     cls: "text-orange-400 bg-orange-900/30 border-orange-700/50" };
  return               { label: "Bust",       cls: "text-red-400   bg-red-900/30    border-red-700/50"    };
}

// ── Props ──────────────────────────────────────────────────────────────────
interface DraftHubProps {
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES";
  setDraftHubSection: (s: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES") => void;

  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: (slot: string | null) => void;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: (query: string) => void;

  selectedLeague: any;
  rosters: any[];
  user: any;
  users: any;

  draftSettings: any;
  draftPicks: any[];
  draftOrder: any;
  allPicks: any[];

  rookies: any[];
  rookieSearch: string;
  setRookieSearch: (s: string) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  tempRanks: Record<number, string>;
  setTempRanks: React.Dispatch<React.SetStateAction<Record<number, string>>>;

  draftedPlayerIds: Set<string>;
  predictedDraftPicks: Record<string, any>;
  topAvailableRookies: any[];

  refreshDraftBoard: () => void;
  loadDraftScout: (userId: string) => void;
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;
  loadingDraftRefresh: boolean;

  // New props for new features
  leagues: any[];
  calcFcValues: Record<string, number>;
  pickFcValues: Record<string, number>;
  fcNameValues: Record<string, number>;
}

// ── Component ──────────────────────────────────────────────────────────────
function DraftHub({
  draftHubSection, setDraftHubSection,
  myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing,
  draftSlotSearchQuery, setDraftSlotSearchQuery,
  selectedLeague, rosters, user, users,
  draftSettings, draftPicks, draftOrder, allPicks,
  rookies, rookieSearch, setRookieSearch,
  dragIndex, setDragIndex, tempRanks, setTempRanks,
  draftedPlayerIds, predictedDraftPicks, topAvailableRookies,
  refreshDraftBoard, loadDraftScout, movePlayer, handleRankChange,
  loadingDraftRefresh,
  leagues, calcFcValues, pickFcValues, fcNameValues,
}: DraftHubProps) {
  const players = usePlayers();
  const { supabaseUser } = useAuth();

  // ── Internal state ───────────────────────────────────────────────────────
  // Tier labels: { playerId: tierNumber 1-15 }
  const [tierLabels, setTierLabels]   = useState<Record<string, number>>({});

  // Player notes: { playerId: noteText }
  const [playerNotes, setPlayerNotes] = useState<Record<string, string>>({});
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  // Big Board position filter
  const [posFilter, setPosFilter] = useState<string | null>(null);

  // Historical draft review
  const [historyData, setHistoryData]         = useState<any[]>([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [historyLoaded, setHistoryLoaded]     = useState(false);
  const [historyTab, setHistoryTab]           = useState<"LEAGUE" | "CONSENSUS" | "MY_PICKS" | "GRADES">("LEAGUE");
  const [selectedHistoryYear, setSelectedHistoryYear]         = useState("ALL");
  const [myPicksSort, setMyPicksSort] = useState<{ col: "times" | "avgPick" | "value"; dir: "asc" | "desc" }>({ col: "times", dir: "desc" });

  // ── Compiled network consensus state ─────────────────────────────────────
  const [consensusMeta, setConsensusMeta] = useState<Record<string, {
    draftCount: number; leagueCount: number; connectedUserCount: number; compiledAt: string;
  }>>({});
  const [consensusCache, setConsensusCache] = useState<Record<string, any[]>>({});
  const [loadingCacheYear, setLoadingCacheYear] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileLog, setCompileLog] = useState("");
  const [compileProgress, setCompileProgress] = useState(0);
  const [showCompilePanel, setShowCompilePanel] = useState(false);
  const [compileSelectedYears, setCompileSelectedYears] = useState<Set<number>>(() => {
    const cur = new Date().getFullYear();
    // Only include completed seasons — current year excluded until after the NFL Draft
    return new Set(Array.from({ length: cur - 2020 }, (_, i) => 2020 + i));
  });

  // ── Player grade annotations (Hit / Neutral / Bust) ─────────────────────
  // Supabase-backed (consensus_player_grades table), localStorage as fallback/cache
  const [playerGrades, setPlayerGrades] = useState<Record<string, "hit" | "neutral" | "bust">>({});

  useEffect(() => {
    if (!supabaseUser) {
      // Not logged in — load from localStorage only
      try {
        const saved = localStorage.getItem("consensusPlayerGrades");
        if (saved) setPlayerGrades(JSON.parse(saved));
      } catch {}
      return;
    }
    // Logged in — Supabase first, localStorage fallback
    (supabase.from("consensus_player_grades" as any) as any)
      .select("grades")
      .eq("user_id", supabaseUser.id)
      .single()
      .then(({ data }: { data: any }) => {
        if (data?.grades && typeof data.grades === "object") {
          setPlayerGrades(data.grades);
          try { localStorage.setItem("consensusPlayerGrades", JSON.stringify(data.grades)); } catch {}
        } else {
          // No Supabase row yet — seed from localStorage if present
          try {
            const saved = localStorage.getItem("consensusPlayerGrades");
            if (saved) setPlayerGrades(JSON.parse(saved));
          } catch {}
        }
      });
  }, [supabaseUser?.id]); // eslint-disable-line

  const syncGradesToSupabase = (grades: Record<string, string>) => {
    if (!supabaseUser) return;
    (supabase.from("consensus_player_grades" as any) as any)
      .upsert(
        { user_id: supabaseUser.id, grades, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .then(({ error }: { error: any }) => {
        if (error) console.error("grade sync failed:", error.message);
      });
  };

  const setGrade = (year: string, playerId: string, grade: "hit" | "neutral" | "bust") => {
    setPlayerGrades((prev) => {
      const key  = `${year}_${playerId}`;
      const next = { ...prev };
      // Clicking the active grade toggles it off
      if (next[key] === grade) delete next[key];
      else next[key] = grade;
      try { localStorage.setItem("consensusPlayerGrades", JSON.stringify(next)); } catch {}
      syncGradesToSupabase(next);
      return next;
    });
  };

  // ── Load notes from localStorage on mount ────────────────────────────────
  useEffect(() => {
    try {
      const n = localStorage.getItem(`draftNotes_${ROOKIE_YEAR}`);
      if (n) setPlayerNotes(JSON.parse(n));
    } catch {}
  }, []);

  // ── Load tiers: Supabase first (if logged in), localStorage fallback ──────
  useEffect(() => {
    const load = async () => {
      if (supabaseUser) {
        try {
          const { data, error } = await supabase
            .from("rookie_board_tiers")
            .select("tiers")
            .eq("user_id", supabaseUser.id)
            .eq("year", ROOKIE_YEAR)
            .single();
          if (!error && data?.tiers && typeof data.tiers === "object") {
            setTierLabels(data.tiers as Record<string, number>);
            localStorage.setItem(`draftTiersV2_${ROOKIE_YEAR}`, JSON.stringify(data.tiers));
            return;
          }
        } catch {}
      }
      // Fall back to localStorage
      try {
        const t = localStorage.getItem(`draftTiersV2_${ROOKIE_YEAR}`);
        if (t) {
          const parsed = JSON.parse(t);
          // Remove any stale "null" key that collapsed all null-player_id players together
          delete parsed["null"];
          setTierLabels(parsed);
        }
      } catch {}
    };
    load();
  }, [supabaseUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Historical draft loading ─────────────────────────────────────────────
  useEffect(() => {
    if (draftHubSection !== "HISTORY" || historyLoaded || !leagues.length) return;
    setHistoryLoading(true);

    const load = async () => {
      const results: any[] = [];

      await Promise.all(leagues.map(async (league: any) => {
        // Follow previous_league_id chain up to 3 years back
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
            const drafts = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json());
            if (!Array.isArray(drafts)) return;
            const rookieDrafts = drafts.filter((d: any) =>
              d.status === "complete" &&
              (d.settings?.rounds ?? d.rounds ?? 99) <= 6 &&
              d.season !== ROOKIE_YEAR
            );
            await Promise.all(rookieDrafts.map(async (draft: any) => {
              try {
                const picks = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`).then(r => r.json());
                if (!Array.isArray(picks)) return;
                const processed = picks.map((pick: any) => {
                  const p = (players as any)[pick.player_id];
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
                }).sort((a: any, b: any) => a.pickNo - b.pickNo);
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
  }, [draftHubSection, historyLoaded, leagues.length]);

  // Auto-select the most recent year once history or compiled meta data loads
  useEffect(() => {
    if (selectedHistoryYear !== "ALL") return;
    const allYears = Array.from(new Set([
      ...historyData.map((d: any) => d.season),
      ...Object.keys(consensusMeta),
    ])).sort().reverse() as string[];
    if (allYears.length > 0) setSelectedHistoryYear(allYears[0]);
  }, [historyData.length, consensusMeta]); // eslint-disable-line

  // ── Load consensus meta from Supabase on login or when HISTORY tab opens ──
  useEffect(() => {
    if (!supabaseUser) return;
    // Re-fetch whenever we enter HISTORY so stale-on-reload is impossible.
    // Skip if we already have data and aren't actively on the history section
    // (avoids redundant fetches on every tab switch away from HISTORY).
    if (draftHubSection !== "HISTORY" && Object.keys(consensusMeta).length > 0) return;
    supabase
      .from("consensus_draft_meta")
      .select("year, total_drafts, total_leagues, connected_user_count, compiled_at")
      .eq("user_id", supabaseUser.id)
      .then(({ data }: { data: any }) => {
        if (!data) return;
        const meta: typeof consensusMeta = {};
        data.forEach((row: any) => {
          meta[String(row.year)] = {
            draftCount:         row.total_drafts,
            leagueCount:        row.total_leagues,
            connectedUserCount: row.connected_user_count,
            compiledAt:         row.compiled_at,
          };
        });
        setConsensusMeta(meta);
      });
  }, [supabaseUser?.id, draftHubSection]); // eslint-disable-line

  // ── When GRADES tab opens, load ALL compiled years so every graded player has slot data ─
  useEffect(() => {
    if (historyTab !== "GRADES" || !supabaseUser) return;
    const yearsToLoad = Object.keys(consensusMeta).filter((yr) => consensusCache[yr] === undefined);
    yearsToLoad.forEach((year) => {
      supabase
        .from("consensus_draft_cache" as any)
        .select("player_id, player_name, position, avg_pick_no")
        .eq("user_id", supabaseUser.id)
        .eq("year", parseInt(year, 10))
        .then(({ data }: { data: any }) => {
          setConsensusCache((prev) => ({ ...prev, [year]: data ?? [] }));
        });
    });
  }, [historyTab, supabaseUser?.id]); // eslint-disable-line

  // ── Load cached consensus rows from Supabase when viewing a compiled year ─
  useEffect(() => {
    if (!supabaseUser || historyTab !== "CONSENSUS") return;
    if (!selectedHistoryYear || selectedHistoryYear === "ALL") return;
    if (!consensusMeta[selectedHistoryYear]) return;
    if (consensusCache[selectedHistoryYear] !== undefined) return; // already loaded

    setLoadingCacheYear(selectedHistoryYear);
    supabase
      .from("consensus_draft_cache")
      .select("player_id, player_name, position, team, avg_pick_no, draft_count")
      .eq("user_id", supabaseUser.id)
      .eq("year", parseInt(selectedHistoryYear, 10))
      .order("avg_pick_no", { ascending: true })
      .then(({ data }: { data: any }) => {
        setConsensusCache((prev) => ({ ...prev, [selectedHistoryYear]: data ?? [] }));
        setLoadingCacheYear(null);
      });
  }, [supabaseUser?.id, historyTab, selectedHistoryYear, consensusMeta]); // eslint-disable-line

  // ── Streaming compilation ────────────────────────────────────────────────
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
              // Evict stale cache so it reloads from Supabase
              setConsensusCache((prev) => {
                const next = { ...prev };
                delete next[String(event.year)];
                return next;
              });
            }
          } catch { /* malformed line — skip */ }
        }
      }
    } catch (err: any) {
      setCompileLog(`Error: ${err?.message ?? "Unknown error"}`);
    }

    setCompiling(false);
    setCompileProgress(100);
  };

  // ── Remove a single player from compiled data for a year ────────────────
  const removeCompiledPlayer = async (year: string, playerId: string) => {
    if (!supabaseUser) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("consensus_draft_cache" as any) as any)
      .delete()
      .eq("user_id", supabaseUser.id)
      .eq("year", parseInt(year, 10))
      .eq("player_id", playerId);
    setConsensusCache((prev) => ({
      ...prev,
      [year]: (prev[year] ?? []).filter((r: any) => r.player_id !== playerId),
    }));
  };

  // ── Clear all data for a specific compiled year ──────────────────────────
  const clearYear = async (year: number) => {
    if (!supabaseUser) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("consensus_draft_cache" as any) as any)
      .delete().eq("user_id", supabaseUser.id).eq("year", year);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("consensus_draft_meta" as any) as any)
      .delete().eq("user_id", supabaseUser.id).eq("year", year);
    setConsensusMeta((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
    setConsensusCache((prev) => { const n = { ...prev }; delete n[String(year)]; return n; });
  };

  // ── Tier helpers ─────────────────────────────────────────────────────────
  const syncTiersToSupabase = (tiers: Record<string, number>) => {
    if (!supabaseUser) return;
    supabase.from("rookie_board_tiers").upsert(
      { user_id: supabaseUser.id, year: ROOKIE_YEAR, tiers, updated_at: new Date().toISOString() },
      { onConflict: "user_id,year" }
    ).then(({ error }: { error: any }) => {
      if (error) console.error("tier sync failed:", error.message);
    });
  };

  const saveTier = (playerId: string, tierNum: number) => {
    const next = { ...tierLabels, [playerId]: tierNum };
    setTierLabels(next);
    localStorage.setItem(`draftTiersV2_${ROOKIE_YEAR}`, JSON.stringify(next));
    syncTiersToSupabase(next);
  };
  const removeTier = (playerId: string) => {
    const next = { ...tierLabels };
    delete next[playerId];
    setTierLabels(next);
    localStorage.setItem(`draftTiersV2_${ROOKIE_YEAR}`, JSON.stringify(next));
    syncTiersToSupabase(next);
  };

  // ── Note helper ──────────────────────────────────────────────────────────
  const saveNote = (playerId: string, text: string) => {
    const next = { ...playerNotes, [playerId]: text };
    setPlayerNotes(next);
    localStorage.setItem(`draftNotes_${ROOKIE_YEAR}`, JSON.stringify(next));
  };

  // ── History computed values ───────────────────────────────────────────────
  const availableYears = Array.from(new Set([
    ...historyData.map((d: any) => d.season),
    ...Object.keys(consensusMeta),
  ])).sort().reverse() as string[];

  const filteredDrafts = selectedHistoryYear === "ALL"
    ? historyData
    : historyData.filter((d: any) => d.season === selectedHistoryYear);

  const currentLeagueDraft = filteredDrafts.find((d: any) => d.leagueName === selectedLeague?.name) ?? null;
  const allFilteredPicks: any[] = filteredDrafts.flatMap((d: any) => d.picks);

  const consensusList = (() => {
    const map = new Map<string, any>();
    allFilteredPicks.forEach((pick: any) => {
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
    const map = new Map<string, any>();
    allFilteredPicks.filter((p: any) => p.pickedByUserId === user?.user_id).forEach((pick: any) => {
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

  // ── Pick slot grade report ────────────────────────────────────────────────
  const gradeReport = (() => {
    const slotMap = new Map<string, {
      hit: number; neutral: number; bust: number;
      players: { name: string; position: string; year: string; grade: string; avgPickNo: number }[];
    }>();

    Object.entries(playerGrades).forEach(([key, grade]) => {
      const sep      = key.indexOf("_");
      const year     = key.substring(0, sep);
      const playerId = key.substring(sep + 1);
      const cacheRow = (consensusCache[year] ?? []).find((r: any) => r.player_id === playerId);
      if (!cacheRow) return; // year not loaded yet — skip

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

  // ── Derived ──────────────────────────────────────────────────────────────
  const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;
  const rosterToName: Record<number, string> = {};
  (rosters as any[]).forEach((r: any) => {
    rosterToName[Number(r.roster_id)] = (users as any)[r.owner_id] || `Team ${r.roster_id}`;
  });

  const TABS = [
    { key: "BOARD",      label: "Live Draft Board" },
    { key: "BIG_BOARD",  label: "Rookie Big Board" },
    { key: "PICK_VALUES",label: "Pick Values" },
    { key: "HISTORY",    label: "Draft History" },
  ] as const;

  return (
    <div className="p-4">
      {/* ── Tab nav ── */}
      <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
        <div className="flex gap-6 text-center">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDraftHubSection(tab.key)}
              className={`pb-2 px-1 text-sm font-semibold whitespace-nowrap transition ${
                draftHubSection === tab.key
                  ? "border-b-2 border-blue-400 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          LIVE DRAFT BOARD — unchanged except scarcity tracker
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "BOARD" && (
        <div className="flex justify-end gap-2 mb-3">
          {Object.keys(myDraftSlotPicks).length > 0 && (
            <button
              onClick={() => {
                setMyDraftSlotPicks({});
                if (selectedLeague?.league_id) {
                  localStorage.removeItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
                  if (supabaseUser) {
                    supabase.from("draft_board_picks").delete()
                      .eq("user_id", supabaseUser.id)
                      .eq("league_id", selectedLeague.league_id)
                      .eq("season", ROOKIE_YEAR)
                      .then(() => {});
                  }
                }
              }}
              className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white rounded-lg transition"
            >
              ✕ Reset Picks
            </button>
          )}
          <button
            onClick={refreshDraftBoard}
            disabled={loadingDraftRefresh}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
          >
            {loadingDraftRefresh ? "Refreshing…" : "↻ Refresh Board"}
          </button>
        </div>
      )}

      {draftHubSection === "BOARD" && !draftSettings && (
        <div className="text-gray-400">No draft data available</div>
      )}

      {draftHubSection === "BOARD" && draftSettings && (
        <div className="overflow-x-auto">
          {/* Derive actual round count from draft settings; fall back to 4 */}
          {(() => {
          const activeRounds = ROUNDS.slice(
            0,
            Number(draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 4)
          );
          return (
          <>
          {/* Legend */}
          <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-blue-900 border border-blue-600" />
              My Slots (click to set)
            </span>
            <span className="flex items-center gap-1 italic text-gray-600">Italic gray = AI prediction</span>
            <span className="text-orange-400 font-bold">REACH</span><span>&gt;8 ahead of ADP</span>
            <span className="text-green-400 font-bold">VALUE</span><span>&gt;5 after ADP</span>
          </div>

          {/* ── Positional Scarcity Tracker ── */}
          {draftPicks.length > 0 && (
            <div className="mb-4 p-3 bg-gray-800/50 rounded-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Positions Drafted — {draftPicks.length} of {(rosters.length || 12) * activeRounds.length} picks made
              </div>
              <div className="flex flex-wrap gap-2">
                {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                  const taken = draftPicks.filter((dp: any) => (players as any)[dp.player_id]?.position === pos).length;
                  const avail = rookies.filter((r: any) => r.position === pos && !draftedPlayerIds.has(String(r.player_id))).length;
                  const pctTaken = draftPicks.length > 0 ? Math.round((taken / draftPicks.length) * 100) : 0;
                  const barColors: Record<string, string> = { QB: "bg-red-500", RB: "bg-green-500", WR: "bg-blue-500", TE: "bg-yellow-500" };
                  return (
                    <div key={pos} className="flex-1 min-w-[90px] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs font-bold ${posColor[pos]}`}>{pos}</span>
                        <span className="text-[10px] text-gray-500">{avail} left</span>
                      </div>
                      <div className="h-1 rounded-full bg-gray-700 mb-1.5">
                        <div className={`h-1 rounded-full ${barColors[pos]}`} style={{ width: `${Math.min(100, pctTaken)}%` }} />
                      </div>
                      <div className="text-xs font-semibold text-white">{taken} <span className="text-gray-500 font-normal">taken ({pctTaken}%)</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Draft grid — fills available width on desktop; horizontally scrollable on mobile */}
          <div className="w-full">
          <div
            className="grid w-full gap-y-2 gap-x-1"
            style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(4rem, 1fr))` }}
          >
            {/* Team headers */}
            {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
              const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
              const teamName = (userId && users[userId]) || `Team ${slot}`;
              const r1slot = `1.${String(slot).padStart(2, "0")}`;
              const r1pick = allPicks.find((p: any) => p.slot === r1slot);
              const isMe = r1pick && String(r1pick.owner_id) === String(myRosterId);
              return (
                <button
                  key={slot}
                  onClick={() => userId && loadDraftScout(userId)}
                  className={`min-w-0 min-h-[2.75rem] px-2 text-center text-xs cursor-pointer whitespace-normal break-words leading-tight ${isMe ? "text-blue-300 font-bold" : "text-blue-400 hover:text-blue-300"}`}
                  title={`View ${teamName}'s ${ROOKIE_YEAR} draft picks`}
                >
                  {teamName}{isMe ? " ★" : ""}
                </button>
              );
            })}

            {/* Pick cells — respects league's actual round count via activeRounds */}
            {activeRounds.flatMap((round) => {
              const roundPicks = Array.from({ length: rosters.length }, (_, i) => {
                const slot = `${round}.${String(i + 1).padStart(2, "0")}`;
                const pick = allPicks.find((p: any) => p.slot === slot);
                return pick || { slot, owner_id: null, roster_id: null };
              });

              return roundPicks.map((pick: any, i: number) => {
                const slotStr = pick.slot as string;
                const playerPick = draftPicks.find(
                  (dp: any) => dp.round === round && dp.roster_id === pick.owner_id
                );
                const actualPlayer = playerPick ? (players as any)[playerPick.player_id] : null;
                const isMySlot = pick.owner_id && String(pick.owner_id) === String(myRosterId);
                const userOverrideId = myDraftSlotPicks[slotStr];
                const userOverride = userOverrideId
                  ? rookies.find((r: any) => r.player_id === userOverrideId || r.name === userOverrideId)
                  : null;
                const prediction = !actualPlayer && !userOverrideId ? predictedDraftPicks[slotStr] : null;
                const overallPick = (round - 1) * rosters.length + (i + 1);
                const isReach = userOverride && typeof userOverride.adp === "number" && overallPick < userOverride.adp - 8;
                const predReach = isMySlot && prediction && (prediction.poolRank ?? 0) > 0 && overallPick < (prediction.poolRank ?? 999) - 7;
                const predValue = isMySlot && prediction && (prediction.poolRank ?? 0) > 0 && overallPick > (prediction.poolRank ?? 0) + 4;
                const isEditing = draftSlotEditing === slotStr;

                return (
                  <div
                    key={`${round}-${i}`}
                    className={`relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 transition
                      ${isMySlot && !actualPlayer ? "border-2 border-blue-600 bg-blue-950/40 cursor-pointer hover:bg-blue-900/40" : "border border-gray-700 bg-gray-800"}
                    `}
                    onClick={() => {
                      if (!isMySlot || actualPlayer) return;
                      setDraftSlotEditing(isEditing ? null : slotStr);
                      setDraftSlotSearchQuery("");
                    }}
                  >
                    {actualPlayer ? (
                      <>
                        <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{actualPlayer.full_name}</div>
                        <div className={`text-[9px] ${posColor[actualPlayer.position] || "text-gray-400"}`}>{actualPlayer.position} · {actualPlayer.team}</div>
                        <div className="text-[9px] text-gray-400 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || slotStr}</div>
                      </>
                    ) : userOverride ? (
                      <>
                        {isReach && <span className="absolute top-0.5 right-1 text-[8px] font-bold text-orange-400">REACH</span>}
                        <div className="text-center w-full text-white font-semibold whitespace-normal break-words leading-tight text-[10px]">{userOverride.name}</div>
                        <div className={`text-[9px] ${posColor[userOverride.position] || "text-gray-400"}`}>{userOverride.position}</div>
                        <div className="text-[9px] text-blue-300 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || "You"}</div>
                        <button
                          className="absolute bottom-0.5 right-1 text-[8px] text-gray-500 hover:text-red-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            const n = { ...myDraftSlotPicks };
                            delete n[slotStr];
                            setMyDraftSlotPicks(n);
                          }}
                        >✕</button>
                      </>
                    ) : prediction ? (
                      <>
                        {predReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                        {predValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                        <div className="text-center w-full text-gray-400 italic whitespace-normal break-words leading-tight text-[10px]">{prediction.name}</div>
                        <div className={`text-[9px] ${posColor[prediction.position] || "text-gray-500"} opacity-70`}>{prediction.position}</div>
                        <div className="text-[9px] text-gray-500 italic truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || slotStr}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">click to set</div>}
                      </>
                    ) : (
                      <>
                        <div className="text-gray-600 font-semibold text-[10px]">{pick.slot}</div>
                        <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || ""}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">click to set</div>}
                      </>
                    )}

                    {/* Inline player picker */}
                    {isEditing && (
                      <div
                        className="absolute top-full left-0 z-50 w-64 bg-gray-900 border border-blue-600 rounded-xl shadow-2xl p-2 mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          autoFocus
                          className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 mb-2 border border-gray-700 focus:outline-none focus:border-blue-500"
                          placeholder="Search rookie…"
                          value={draftSlotSearchQuery}
                          onChange={(e) => setDraftSlotSearchQuery(e.target.value)}
                        />
                        <div className="max-h-44 overflow-y-auto space-y-0.5">
                          {rookies
                            .map((r: any, idx: number) => ({ ...r, boardRank: idx + 1 }))
                            .filter((r: any) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                            .filter((r: any) =>
                              !draftedPlayerIds.has(String(r.player_id)) &&
                              !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && pid === r.player_id)
                            )
                            .slice(0, 15)
                            .map((r: any) => {
                              const reachAmt = typeof r.adp === "number" ? Math.round(overallPick - r.adp) : null;
                              return (
                                <button
                                  key={`${r.boardRank}-${r.player_id || r.name}`}
                                  className="w-full text-left px-2 py-1 rounded hover:bg-gray-800 flex items-center justify-between gap-1"
                                  onClick={() => {
                                    setMyDraftSlotPicks((prev) => ({ ...prev, [slotStr]: r.player_id || r.name }));
                                    setDraftSlotEditing(null);
                                    setDraftSlotSearchQuery("");
                                  }}
                                >
                                  <span className="text-white text-[10px] truncate">#{r.boardRank} {r.name}</span>
                                  <span className="flex items-center gap-1 shrink-0">
                                    <span className={`text-[9px] ${posColor[r.position] || "text-gray-400"}`}>{r.position}</span>
                                    {reachAmt !== null && reachAmt < -8 && <span className="text-[8px] text-orange-400 font-bold">REACH</span>}
                                    {reachAmt !== null && reachAmt > 5 && <span className="text-[8px] text-green-400">VALUE</span>}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                        <button
                          className="mt-1 w-full text-[9px] text-gray-600 hover:text-gray-400"
                          onClick={() => { setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}
                        >
                          cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            })}
          </div>
          </div>{/* /centering flex wrapper */}
          </> ); })()}
        </div>
      )}

      {/* Top Available — unchanged */}
      {draftHubSection === "BOARD" && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Top Available Rookies From Your Big Board</h2>
              <p className="text-sm text-gray-400">
                Automatically removes players after they are drafted in this Sleeper draft.
              </p>
            </div>
          </div>
          {!rookies.length ? (
            <div className="text-gray-400 text-sm">Your rookie board is still loading from Sleeper.</div>
          ) : topAvailableRookies.length === 0 ? (
            <div className="text-gray-400 text-sm">No ranked rookies are currently available.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topAvailableRookies.map((player: any) => (
                <div
                  key={player.player_id || `${normalizeRookieName(player.name)}-${player.boardRank}`}
                  className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-blue-400 font-semibold">#{player.boardRank}</div>
                      <div className="font-medium text-white">{player.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">{player.team || "FA"}</div>
                      <div className="text-xs text-gray-300">{player.position}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ROOKIE BIG BOARD
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "BIG_BOARD" && (
        <div className="max-w-3xl mx-auto">

          {/* Note popup overlay */}
          {expandedNoteId && (() => {
            const np = rookies.find((r: any) => r.player_id === expandedNoteId);
            return (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                onClick={() => setExpandedNoteId(null)}
              >
                <div
                  className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-md mx-4 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{np?.name}</div>
                      <div className="text-xs text-gray-500">{np?.position}{np?.team ? ` · ${np.team}` : ""}</div>
                    </div>
                    <button onClick={() => setExpandedNoteId(null)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
                  </div>
                  <textarea
                    autoFocus
                    value={playerNotes[expandedNoteId] || ""}
                    onChange={(e) => saveNote(expandedNoteId, e.target.value)}
                    placeholder="Scouting notes, injury flags, scheme fit..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:border-blue-500 placeholder:text-gray-600"
                    rows={5}
                  />
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={() => setExpandedNoteId(null)}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition"
                    >Done</button>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="flex items-center gap-3 mb-2">
            <input
              type="text"
              placeholder="Search rookies..."
              value={rookieSearch}
              onChange={(e) => setRookieSearch(e.target.value)}
              className="flex-1 p-2 rounded bg-gray-800 text-sm"
            />
            {rookieSearch && (
              <span className="text-[11px] text-gray-500">Tiers hidden while searching</span>
            )}
          </div>

          {/* ±N vs FC legend */}
          <div className="flex items-center gap-1 text-[10px] text-gray-600 mb-2 px-0.5">
            <span>±N vs FC rank:</span>
            <span className="text-green-500 font-semibold">+N</span>
            <span>you rank higher ·</span>
            <span className="text-red-500 font-semibold">−N</span>
            <span>you rank lower than FantasyCalc</span>
          </div>

          {/* Position filter pills */}
          <div className="flex items-center gap-1.5 mb-3">
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter((prev) => prev === pos ? null : pos)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition ${
                  posFilter === pos
                    ? posBadge[pos] + " border-transparent"
                    : "border-gray-700 text-gray-500 hover:text-white"
                }`}
              >
                {pos}
              </button>
            ))}
            {posFilter && (
              <button
                onClick={() => setPosFilter(null)}
                className="text-[10px] text-gray-500 hover:text-white transition ml-1"
              >
                Clear
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {(() => {
              // FC value: fuzzy name lookup (catches 1-2 char spelling diffs like Jeremiyah/Jeremiah)
              const fcVal = (r: any): number => fuzzyFcLookup(r.name, fcNameValues) || r.fcValue || 0;

              // Stable key: player_id when available, else normalized name fallback.
              // Prevents players without a Sleeper player_id (pre-draft rookies) from
              // all sharing the same null key and overwriting each other in the rank maps.
              const rookieKey = (r: any): string => r.player_id || `name:${normalizeRookieName(r.name)}`;

              // Build FantasyCalc rank lookup (sort rookies by FC value desc)
              const fcRanks: Record<string, number> = {};
              [...rookies]
                .filter((r: any) => fcVal(r) > 0)
                .sort((a: any, b: any) => fcVal(b) - fcVal(a))
                .forEach((r: any, i: number) => { fcRanks[rookieKey(r)] = i + 1; });

              // User's rank among only FC-valued players (board order, no-value players skipped)
              const userFcRanks: Record<string, number> = {};
              rookies
                .filter((r: any) => fcVal(r) > 0)
                .forEach((r: any, i: number) => { userFcRanks[rookieKey(r)] = i + 1; });

              return rookies
                .map((p: any, originalIndex: number) => ({ p, originalIndex }))
                .filter(({ p }) =>
                  p.name &&
                  p.name !== "Player Invalid" &&
                  p.name.toLowerCase().includes(rookieSearch.toLowerCase()) &&
                  (!posFilter || p.position === posFilter)
                )
                .map(({ p, originalIndex }, displayIndex, arr) => {
                  const tierKey  = p.player_id || `name:${p.name}`;
                  const prevTierKey = displayIndex > 0
                    ? (arr[displayIndex - 1].p.player_id || `name:${arr[displayIndex - 1].p.name}`)
                    : null;
                  const hasNote = !!(playerNotes[p.player_id] || "").trim();
                  const myTier  = tierLabels[tierKey];
                  const prevTier = prevTierKey !== null ? tierLabels[prevTierKey] : undefined;
                  const showDivider = !rookieSearch && displayIndex > 0 && myTier !== prevTier;

                  const fcRank   = fcRanks[rookieKey(p)];
                  const userRank = userFcRanks[rookieKey(p)];
                  // positive = you rank higher than FC, negative = you rank lower
                  const gap = fcRank !== undefined && userRank !== undefined
                    ? fcRank - userRank
                    : null;

                  const playerDynVal = fcVal(p);
                  const isTaken = draftedPlayerIds.has(String(p.player_id));

                return (
                  <div key={p.player_id || originalIndex}>

                    {/* Tier divider line between groups */}
                    {showDivider && (
                      <div className="flex items-center gap-3 my-2 px-1">
                        <div className="flex-1 h-px bg-gray-600/50" />
                        {myTier !== undefined && (
                          <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Tier {myTier}</span>
                        )}
                        <div className="flex-1 h-px bg-gray-600/50" />
                      </div>
                    )}

                    {/* Player row */}
                    <div
                      draggable
                      onDragStart={() => setDragIndex(originalIndex)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIndex !== null) {
                          movePlayer(dragIndex, originalIndex);
                          setDragIndex(null);
                        }
                      }}
                      className={`flex items-center justify-between bg-gray-800/70 px-3 py-1.5 rounded-lg text-sm cursor-move hover:bg-gray-700/70 transition${isTaken ? " opacity-40" : ""}`}
                    >
                      {/* Left: rank + name + pos */}
                      <div className="flex gap-3 items-center min-w-0">
                        <input
                          type="number"
                          value={tempRanks[originalIndex] ?? originalIndex + 1}
                          onChange={(e) => setTempRanks((prev) => ({ ...prev, [originalIndex]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRankChange(originalIndex, String(tempRanks[originalIndex] ?? originalIndex + 1));
                              setTempRanks((prev) => { const u = { ...prev }; delete u[originalIndex]; return u; });
                            }
                          }}
                          onBlur={() => {
                            if (tempRanks[originalIndex] !== undefined) {
                              handleRankChange(originalIndex, tempRanks[originalIndex]);
                              setTempRanks((prev) => { const u = { ...prev }; delete u[originalIndex]; return u; });
                            }
                          }}
                          className="w-12 text-center bg-transparent text-gray-400 outline-none"
                        />
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{p.name}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${posBadge[p.position] || "bg-gray-700 text-gray-400"}`}>
                            {p.position}
                          </span>
                          {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                          {playerDynVal > 0 && <span className="text-[10px] text-gray-400 font-mono shrink-0">{playerDynVal.toLocaleString()}</span>}
                        </div>
                      </div>

                      {/* Right: gap + note + tier */}
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {isTaken && <span className="text-[9px] font-bold text-gray-500 border border-gray-700 px-1 py-0.5 rounded leading-none">TAKEN</span>}
                        {gap === null ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-gray-400 bg-gray-700/60 border border-gray-600/40" title="Not ranked by FantasyCalc">NR</span>
                        ) : gap === 0 ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-gray-400 bg-gray-800/40" title="Same rank as FantasyCalc">Even</span>
                        ) : (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              gap > 0 ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20"
                            }`}
                            title={gap > 0 ? `You rank them ${gap} spots higher than FantasyCalc` : `You rank them ${Math.abs(gap)} spots lower than FantasyCalc`}
                          >
                            {gap > 0 ? `+${gap}` : `${gap}`}
                          </span>
                        )}

                        {/* Note icon → opens popup */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedNoteId(p.player_id); }}
                          className={`text-sm transition ${hasNote ? "text-amber-400 hover:text-amber-300" : "text-gray-600 hover:text-gray-400"}`}
                          title={hasNote ? "View/edit note" : "Add note"}
                        >
                          {hasNote ? "📝" : "○"}
                        </button>

                        {/* Tier inline select */}
                        {!rookieSearch && (
                          <select
                            value={myTier ?? ""}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              if (!isNaN(val)) saveTier(tierKey, val);
                              else removeTier(tierKey);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`text-[10px] font-bold rounded px-1 py-0.5 outline-none cursor-pointer border transition ${
                              myTier !== undefined
                                ? "bg-blue-900/40 border-blue-800/60 text-blue-300"
                                : "bg-gray-700/50 border-gray-700 text-gray-500"
                            }`}
                          >
                            <option value="">Tier</option>
                            {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>T{n}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          PICK VALUES
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "PICK_VALUES" && (
        <PickValuesTab
          pickFcValues={pickFcValues}
          allPicks={allPicks}
          draftSettings={draftSettings}
          numSlots={rosters.length || 12}
          myRosterId={myRosterId}
        />
      )}

      {/* ══════════════════════════════════════════════════════
          DRAFT HISTORY
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "HISTORY" && (
        <div className="max-w-3xl lg:max-w-5xl mx-auto">
          {/* Header + year filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-lg font-semibold">Historical Rookie Drafts</h2>
              <p className="text-sm text-gray-400 mt-0.5">Past rookie draft classes by year.</p>
            </div>
            {availableYears.length > 0 && (
              <select
                value={selectedHistoryYear}
                onChange={(e) => setSelectedHistoryYear(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
              >
                {availableYears.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
              </select>
            )}
          </div>

          {/* Loading */}
          {historyLoading && (
            <div className="flex items-center gap-3 text-sm text-blue-400 py-8">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Loading past draft data…
            </div>
          )}

          {/* Empty */}
          {!historyLoading && historyLoaded && historyData.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
              No completed rookie drafts found in your leagues' history. This may be your leagues' first season.
            </div>
          )}

          {/* Content */}
          {!historyLoading && (filteredDrafts.length > 0 || !!consensusMeta[selectedHistoryYear]) && (
            <>
              {/* Sub-tabs */}
              <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1 mb-5 w-fit">
                {([
                  { key: "LEAGUE",    label: "League Board" },
                  { key: "CONSENSUS", label: "Consensus Board" },
                  { key: "MY_PICKS",  label: "My Draft Picks" },
                  { key: "GRADES",    label: "Pick Slot Grades" },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setHistoryTab(t.key)}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
                      historyTab === t.key ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── League Board ── */}
              {historyTab === "LEAGUE" && (
                <div>
                  {currentLeagueDraft ? (
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{currentLeagueDraft.season} Rookie Draft</div>
                          <div className="text-base font-semibold text-white mt-0.5">{currentLeagueDraft.leagueName}</div>
                        </div>
                        <div className="flex items-center gap-4 text-right">
                          <span className="text-[10px] text-blue-400 font-semibold">■ Your pick</span>
                          <span className="text-xs text-gray-500">{currentLeagueDraft.picks.length} picks</span>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-800/40">
                        {currentLeagueDraft.picks.map((pick: any) => {
                          const { label, cls } = valueGrade(pick.value);
                          const isMine = pick.pickedByUserId === user?.user_id;
                          const { label: equivLabel, pickNo: equivPickNo } = closestPickEquiv(pick.value, pickFcValues);
                          const equivColor = pickEquivColor(equivPickNo, pick.pickNo);
                          return (
                            <div key={pick.slot} className={`flex items-center gap-2 px-4 py-1.5 ${isMine ? "bg-blue-950/20" : ""}`}>
                              <span className="text-[11px] font-bold text-gray-500 w-8 shrink-0">{pick.slot}</span>
                              <span className={`text-[10px] font-bold w-6 shrink-0 ${posColor[pick.position] || "text-gray-400"}`}>{pick.position}</span>
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className={`text-sm font-medium truncate ${isMine ? "text-blue-200" : "text-white"}`}>{pick.name}</span>
                                {pick.team && <span className="text-[10px] text-gray-500 shrink-0">{pick.team}</span>}
                                {isMine && <span className="text-[9px] font-bold text-blue-400 shrink-0 border border-blue-800 px-1 rounded">YOUR PICK</span>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-xs font-semibold ${isMine ? "text-blue-200" : "text-white"}`}>
                                  {pick.value > 0 ? pick.value.toLocaleString() : "—"}
                                </span>
                                <span className={`text-[9px] font-semibold border px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
                                {equivLabel !== "—" && (
                                  <span className={`text-[9px] font-semibold ${equivColor}`}>≈{equivLabel}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
                      No completed rookie draft found for <span className="text-white">{selectedLeague?.name}</span> in {selectedHistoryYear}.
                    </div>
                  )}
                </div>
              )}

              {/* ── Consensus Board ── */}
              {historyTab === "CONSENSUS" && (() => {
                const hasCachedRows  = Array.isArray(consensusCache[selectedHistoryYear]) && consensusCache[selectedHistoryYear].length > 0;
                const hasMeta        = !!consensusMeta[selectedHistoryYear];
                const isLoadingCache = loadingCacheYear === selectedHistoryYear;
                const meta           = consensusMeta[selectedHistoryYear];

                // Minimum draft-count threshold: 5% of total drafts found for this year
                const totalDraftsForYear = hasCachedRows
                  ? (meta?.draftCount ?? 0)
                  : filteredDrafts.length;
                const minDrafts = Math.max(1, Math.ceil(totalDraftsForYear * 0.08));

                // Build the display list: compiled network data first, local fallback
                // For compiled rows, fall back to the loaded players map for position/team
                // if the stored metadata was empty at draft time (common for 2024/2025 picks)
                const displayList: any[] = (hasCachedRows
                  ? consensusCache[selectedHistoryYear].map((row: any) => {
                      const fullPlayer = (players as any)?.[row.player_id];
                      return {
                        player_id:  row.player_id,
                        name:       row.player_name || fullPlayer?.full_name || "",
                        position:   row.position    || fullPlayer?.position  || "",
                        team:       row.team        || fullPlayer?.team      || "",
                        avgPickNo:  row.avg_pick_no,
                        draftCount: row.draft_count,
                        value:      calcFcValues[row.player_id] ?? 0,
                      };
                    })
                  : consensusList
                ).filter((p: any) =>
                  p.draftCount >= minDrafts &&
                  ["QB", "RB", "WR", "TE", "FB"].includes(p.position)
                );

                const draftCount  = hasCachedRows ? (meta?.draftCount ?? 0) : filteredDrafts.length;
                const sourceLabel = hasCachedRows
                  ? `${draftCount} rookie draft${draftCount !== 1 ? "s" : ""} · ${meta?.leagueCount ?? 0} leagues · ${meta?.connectedUserCount ?? 0} connected users`
                  : `${filteredDrafts.length} draft${filteredDrafts.length !== 1 ? "s" : ""} in your leagues only`;

                // Exclude current calendar year — NFL Draft hasn't happened yet
                const YEAR_RANGE = Array.from({ length: new Date().getFullYear() - 2020 }, (_, i) => 2020 + i);
                // All years that have ANY compiled data (including bad years like 2026)
                const ALL_COMPILED_YEARS = Object.keys(consensusMeta).map(Number).sort().reverse();

                return (
                  <div>
                    {/* ── Compile Panel ─────────────────────────────── */}
                    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 mb-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">Network Consensus</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {hasMeta
                              ? `${meta!.draftCount} rookie drafts · ${meta!.leagueCount} leagues · last compiled ${new Date(meta!.compiledAt).toLocaleDateString()}`
                              : supabaseUser
                                ? `No compiled data for ${selectedHistoryYear} yet.`
                                : "Log in to compile a network consensus board."}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {supabaseUser && !compiling && (
                            <button
                              onClick={() => setShowCompilePanel((v) => !v)}
                              className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg transition font-medium"
                            >
                              {showCompilePanel ? "Hide" : hasMeta ? "Recompile" : "Compile Now"}
                            </button>
                          )}
                          {compiling && (
                            <div className="flex items-center gap-1.5 text-xs text-blue-400">
                              <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                              Compiling…
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Year selector + launch */}
                      {showCompilePanel && !compiling && (
                        <div className="mt-3 border-t border-gray-700 pt-3">
                          <div className="text-xs text-gray-400 mb-2">
                            Select years to compile. Existing data for each selected year will be replaced.
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {YEAR_RANGE.map((yr) => {
                              const yrMeta = consensusMeta[String(yr)];
                              const sel    = compileSelectedYears.has(yr);
                              return (
                                <button
                                  key={yr}
                                  onClick={() => setCompileSelectedYears((prev) => {
                                    const next = new Set(prev);
                                    next.has(yr) ? next.delete(yr) : next.add(yr);
                                    return next;
                                  })}
                                  className={`text-xs px-2.5 py-1 rounded-lg border transition flex items-center gap-1 ${
                                    sel
                                      ? "border-blue-600 bg-blue-900/30 text-blue-300"
                                      : "border-gray-700 bg-gray-800 text-gray-400"
                                  }`}
                                >
                                  {yr}
                                  {yrMeta && (
                                    <span className="text-[9px] text-green-400 font-semibold">✓{yrMeta.draftCount}d</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                const years = Array.from(compileSelectedYears).sort();
                                if (!years.length) return;
                                setShowCompilePanel(false);
                                runCompile(years);
                              }}
                              disabled={compileSelectedYears.size === 0}
                              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-1.5 rounded-lg transition font-semibold"
                            >
                              Compile {compileSelectedYears.size} year{compileSelectedYears.size !== 1 ? "s" : ""}
                            </button>
                            <button
                              onClick={() => setCompileSelectedYears(new Set(YEAR_RANGE))}
                              className="text-xs text-gray-400 hover:text-white transition"
                            >
                              Select all
                            </button>
                            <button
                              onClick={() => setCompileSelectedYears(new Set())}
                              className="text-xs text-gray-400 hover:text-white transition"
                            >
                              Clear
                            </button>
                          </div>

                          {/* Delete buttons — shown for every year with stored data */}
                          {ALL_COMPILED_YEARS.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700/60">
                              <div className="text-xs text-gray-500 mb-2">Delete stored data for a year:</div>
                              <div className="flex flex-wrap gap-1.5">
                                {ALL_COMPILED_YEARS.map((yr) => (
                                  <button
                                    key={yr}
                                    onClick={() => clearYear(yr)}
                                    className="text-[10px] px-2 py-0.5 rounded border border-red-900/60 bg-red-950/30 text-red-400 hover:bg-red-900/50 transition"
                                  >
                                    Delete {yr}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Progress bar + log */}
                      {compiling && (
                        <div className="mt-3">
                          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1.5">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-300"
                              style={{ width: `${compileProgress}%` }}
                            />
                          </div>
                          <div className="text-[11px] text-gray-400 truncate">{compileLog}</div>
                        </div>
                      )}
                    </div>

                    {/* ── Board ───────────────────────────────────────── */}
                    {isLoadingCache ? (
                      <div className="flex items-center gap-3 text-sm text-blue-400 py-6">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        Loading compiled consensus…
                      </div>
                    ) : displayList.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
                        No draft data for {selectedHistoryYear}.{" "}
                        {supabaseUser
                          ? 'Click "Compile Now" above to build a network consensus board.'
                          : "Log in to compile a network consensus board."}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {selectedHistoryYear} Consensus Draft Board
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {displayList.length} players ranked by avg pick · {sourceLabel}
                            </div>
                          </div>
                          {hasCachedRows && (
                            <span className="text-[10px] bg-green-900/40 border border-green-800/60 text-green-400 px-2 py-0.5 rounded-full font-semibold shrink-0">
                              Network Data
                            </span>
                          )}
                        </div>
                        <div className="px-4 py-2 border-b border-gray-800/60 grid grid-cols-[2rem_3rem_1fr_5rem_4rem_6rem] gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                          <span>#</span><span>Pos</span><span>Player</span><span>Avg Pick</span><span>Drafts</span><span className="text-right">≈ Pick Val</span>
                        </div>
                        <div className="divide-y divide-gray-800/40">
                          {displayList.map((p: any, i: number) => {
                            const { label: equivLabel, pickNo: equivPickNo } = closestPickEquiv(p.value, pickFcValues);
                            const color  = pickEquivColor(equivPickNo, Math.round(p.avgPickNo));
                            const grade  = playerGrades[`${selectedHistoryYear}_${p.player_id}`];
                            const rowBg  = grade === "hit"     ? "bg-green-950/25"
                                         : grade === "bust"    ? "bg-red-950/25"
                                         : grade === "neutral" ? "bg-gray-800/30"
                                         : "";
                            return (
                              <div key={p.player_id} className={`group grid grid-cols-[2rem_3rem_1fr_5rem_4rem_6rem] gap-2 items-center px-4 py-1.5 ${rowBg}`}>
                                <span className="text-xs text-gray-500">{i + 1}</span>
                                <span className={`text-[10px] font-bold ${posColor[p.position] || "text-gray-400"}`}>{p.position}</span>
                                <div className="min-w-0 flex items-center gap-1.5">
                                  <span className="text-sm font-medium text-white truncate">{p.name}</span>
                                  {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                                  {/* Remove from compiled data */}
                                  {hasCachedRows && supabaseUser && (
                                    <button
                                      title="Remove from compiled data"
                                      onClick={(e) => { e.stopPropagation(); removeCompiledPlayer(selectedHistoryYear, p.player_id); }}
                                      className="opacity-0 group-hover:opacity-100 text-[9px] text-gray-600 hover:text-red-400 transition shrink-0 leading-none"
                                    >
                                      ✕
                                    </button>
                                  )}
                                  {/* Hit / Neutral / Bust grade buttons */}
                                  <div className="flex items-center gap-0.5 shrink-0 ml-0.5">
                                    {(["hit", "neutral", "bust"] as const).map((g) => {
                                      const active = grade === g;
                                      const activeCls =
                                        g === "hit"     ? "border-green-600 bg-green-800/70 text-green-300"
                                        : g === "neutral" ? "border-gray-500 bg-gray-700 text-gray-200"
                                        :                   "border-red-600 bg-red-800/70 text-red-300";
                                      return (
                                        <button
                                          key={g}
                                          title={g.charAt(0).toUpperCase() + g.slice(1)}
                                          onClick={(e) => { e.stopPropagation(); setGrade(selectedHistoryYear, p.player_id, g); }}
                                          className={`text-[9px] font-bold px-1 py-0.5 rounded border transition ${
                                            active
                                              ? activeCls
                                              : "border-gray-800 text-gray-700 hover:border-gray-600 hover:text-gray-500 bg-transparent"
                                          }`}
                                        >
                                          {g === "hit" ? "H" : g === "neutral" ? "N" : "B"}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                <span className="text-xs font-semibold text-white">{toPickSlot(p.avgPickNo)}</span>
                                <span className="text-xs text-gray-400">{p.draftCount}x</span>
                                <span className={`text-xs font-semibold text-right ${color}`}>{equivLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── My Draft Picks ── */}
              {historyTab === "MY_PICKS" && (
                myPicksList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
                    No picks attributed to your user ID in the loaded drafts.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                      <div className="text-sm font-semibold text-white">Your Draft Picks</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {myPicksList.length} unique players · {filteredDrafts.length} total draft{filteredDrafts.length !== 1 ? "s" : ""} {selectedHistoryYear === "ALL" ? "across all years" : `in ${selectedHistoryYear}`}
                      </div>
                    </div>
                    {(() => {
                      const toggleSort = (col: "times" | "avgPick" | "value") => {
                        setMyPicksSort((prev) =>
                          prev.col === col
                            ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
                            : { col, dir: col === "avgPick" ? "asc" : "desc" }
                        );
                      };
                      const arrow = (col: "times" | "avgPick" | "value") =>
                        myPicksSort.col === col ? (myPicksSort.dir === "desc" ? " ↓" : " ↑") : "";
                      const sorted = [...myPicksList].sort((a: any, b: any) => {
                        const { col, dir } = myPicksSort;
                        const val = col === "times" ? a.timesDrafted - b.timesDrafted
                                  : col === "avgPick" ? a.avgPickNo - b.avgPickNo
                                  : a.value - b.value;
                        return dir === "desc" ? -val : val;
                      });
                      return (
                        <>
                          <div className="px-4 py-2 border-b border-gray-800/60 grid grid-cols-[3rem_1fr_4.5rem_5rem_6rem] gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            <span>Pos</span>
                            <span>Player</span>
                            <button onClick={() => toggleSort("times")} className="text-left hover:text-white transition">Times{arrow("times")}</button>
                            <button onClick={() => toggleSort("avgPick")} className="text-left hover:text-white transition">Avg Pick{arrow("avgPick")}</button>
                            <button onClick={() => toggleSort("value")} className="text-right hover:text-white transition w-full">≈ Pick Val{arrow("value")}</button>
                          </div>
                          <div className="divide-y divide-gray-800/40">
                            {sorted.map((p: any) => {
                              const { label: equivLabel, pickNo: equivPickNo } = closestPickEquiv(p.value, pickFcValues);
                              const color = pickEquivColor(equivPickNo, Math.round(p.avgPickNo));
                              return (
                                <div key={p.player_id} className="grid grid-cols-[3rem_1fr_4.5rem_5rem_6rem] gap-2 items-center px-4 py-1.5">
                                  <span className={`text-[10px] font-bold ${posColor[p.position] || "text-gray-400"}`}>{p.position}</span>
                                  <span className="text-sm font-medium text-white truncate">{p.name}</span>
                                  <span className="text-sm font-semibold text-blue-400">{p.timesDrafted}×</span>
                                  <span className="text-xs text-white">{toPickSlot(p.avgPickNo)}</span>
                                  <span className={`text-xs font-semibold text-right ${color}`}>{equivLabel}</span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )
              )}
              {/* ── Pick Slot Grades ── */}
              {historyTab === "GRADES" && (() => {
                if (gradeReport.length === 0) {
                  return (
                    <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
                      No grades recorded yet. Use the H / N / B buttons on the Consensus Board to grade players.
                    </div>
                  );
                }

                // ── Summary table ──────────────────────────────────────────
                const SLOT_GROUPS = [
                  { label: "Early 1st", round: 1, min: 1,  max: 4  },
                  { label: "Mid 1st",   round: 1, min: 5,  max: 8  },
                  { label: "Late 1st",  round: 1, min: 9,  max: 12 },
                  { label: "Early 2nd", round: 2, min: 1,  max: 4  },
                  { label: "Mid 2nd",   round: 2, min: 5,  max: 8  },
                  { label: "Late 2nd",  round: 2, min: 9,  max: 12 },
                  { label: "Early 3rd", round: 3, min: 1,  max: 4  },
                  { label: "Mid 3rd",   round: 3, min: 5,  max: 8  },
                  { label: "Late 3rd",  round: 3, min: 9,  max: 12 },
                  { label: "4th Round", round: 4, min: 1,  max: 12 },
                  { label: "5th+/Waiv", round: 5, min: 1,  max: 999 },
                ];
                const summaryGroups = SLOT_GROUPS.map(({ label, round, min, max }) => {
                  const rows = gradeReport.filter((row) => {
                    const [r, s] = row.slot.split(".").map(Number);
                    return r === round && s >= min && s <= max;
                  });
                  const hit     = rows.reduce((s, r) => s + r.hit,     0);
                  const neutral = rows.reduce((s, r) => s + r.neutral, 0);
                  const bust    = rows.reduce((s, r) => s + r.bust,    0);
                  const total   = hit + neutral + bust;
                  return { label, hit, neutral, bust, total };
                }).filter((g) => g.total > 0);

                return (
                  <div className="space-y-4">
                    {/* ── Hit/Neutral/Bust summary table ── */}
                    {summaryGroups.length > 0 && (
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-800">
                          <div className="text-sm font-semibold text-white">Grade Summary by Pick Slot</div>
                          <div className="text-xs text-gray-400 mt-0.5">Hit / Neutral / Miss rates from your H N B grades</div>
                        </div>
                        <div className="overflow-x-auto lg:overflow-x-visible">
                          <table className="w-full text-xs border-collapse min-w-max lg:min-w-0">
                            <thead>
                              <tr className="border-b border-gray-800">
                                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 w-16 sticky left-0 bg-gray-900/60"></th>
                                {summaryGroups.map((g) => (
                                  <th key={g.label} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">
                                    {g.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(["hit", "neutral", "bust"] as const).map((grade) => {
                                const labelText  = grade === "hit" ? "Hit" : grade === "neutral" ? "Neutral" : "Bust";
                                const labelColor = grade === "hit" ? "text-green-400" : grade === "neutral" ? "text-gray-400" : "text-red-400";
                                return (
                                  <tr key={grade} className="border-b border-gray-800/50 last:border-0">
                                    <td className={`px-3 py-2 font-bold text-[11px] sticky left-0 bg-gray-900/60 ${labelColor}`}>{labelText}</td>
                                    {summaryGroups.map((g) => {
                                      const pct = g.total ? Math.round((g[grade] / g.total) * 100) : 0;
                                      const color = grade === "hit"
                                        ? pct >= 50 ? "text-green-300" : pct >= 30 ? "text-green-500" : "text-green-700"
                                        : grade === "bust"
                                        ? pct >= 60 ? "text-red-600" : pct >= 40 ? "text-red-400" : "text-red-300"
                                        : "text-gray-400";
                                      return (
                                        <td key={g.label} className={`px-2 py-2 text-center font-semibold ${color}`}>
                                          {pct}%
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  <div className="space-y-1">
                    {/* Header */}
                    <div className="grid grid-cols-[4rem_1fr_4rem] gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                      <span>Slot</span>
                      <span>Hit / Neutral / Bust</span>
                      <span className="text-right">Players</span>
                    </div>
                    {gradeReport.map((row) => (
                      <details key={row.slot} className="group rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                        <summary className="grid grid-cols-[4rem_1fr_4rem] gap-2 items-center px-3 py-2.5 cursor-pointer list-none select-none hover:bg-gray-800/40 transition">
                          {/* Slot label */}
                          <span className="text-sm font-bold text-white">{row.slot}</span>

                          {/* Stacked bar */}
                          <div className="flex flex-col gap-1">
                            <div className="flex h-2 rounded-full overflow-hidden bg-gray-700/50">
                              {row.hitRate  > 0 && <div className="bg-green-500 transition-all" style={{ width: `${row.hitRate  * 100}%` }} />}
                              {row.neutRate > 0 && <div className="bg-gray-500  transition-all" style={{ width: `${row.neutRate * 100}%` }} />}
                              {row.bustRate > 0 && <div className="bg-red-500   transition-all" style={{ width: `${row.bustRate * 100}%` }} />}
                            </div>
                            <div className="flex gap-3 text-[10px]">
                              {row.hit      > 0 && <span className="text-green-400 font-semibold">{Math.round(row.hitRate  * 100)}% H ({row.hit})</span>}
                              {row.neutral  > 0 && <span className="text-gray-400  font-semibold">{Math.round(row.neutRate * 100)}% N ({row.neutral})</span>}
                              {row.bust     > 0 && <span className="text-red-400   font-semibold">{Math.round(row.bustRate * 100)}% B ({row.bust})</span>}
                            </div>
                          </div>

                          {/* Total count */}
                          <span className="text-xs text-gray-400 text-right">{row.total}</span>
                        </summary>

                        {/* Expanded player list */}
                        <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                          {row.players.map((p, i) => {
                            const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400", FB: "text-orange-400" };
                            const gradeColor = p.grade === "hit" ? "text-green-400" : p.grade === "bust" ? "text-red-400" : "text-gray-400";
                            const gradeLabel = p.grade === "hit" ? "H" : p.grade === "bust" ? "B" : "N";
                            return (
                              <div key={i} className="flex items-center gap-3 px-3 py-2">
                                <span className={`text-[10px] font-bold w-7 ${posColor[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                                <span className="text-sm text-white flex-1 truncate">{p.name}</span>
                                <span className="text-xs text-gray-500">{p.year}</span>
                                <span className={`text-xs font-bold w-4 text-right ${gradeColor}`}>{gradeLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    ))}
                  </div>
                  </div>
                );
              })()}

            </>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(DraftHub);
