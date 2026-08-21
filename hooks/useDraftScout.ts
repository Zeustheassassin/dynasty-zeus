"use client";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import { CURRENT_YEAR, ROOKIE_DRAFT_MAX_ROUNDS } from "../lib/helpers";
import type { SleeperDraft, SleeperPlayer } from "../lib/types";

const log = logger("hooks/useDraftScout");

interface DraftScoutPick {
  round: number;
  slot: string;
  player: SleeperPlayer | null;
  playerName: string | null;
  position: string | null;
}

export interface DraftScoutLeague {
  leagueName: string;
  picks: DraftScoutPick[];
}

export function useDraftScout(players: Record<string, SleeperPlayer>) {
  const [draftScoutUserId, setDraftScoutUserId] = useState<string | null>(null);
  const [draftScoutData, setDraftScoutData] = useState<DraftScoutLeague[] | null>(null);
  const [loadingDraftScout, setLoadingDraftScout] = useState(false);

  // Stable ref so loadDraftScout doesn't re-create when players reference changes
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);

  // Discards a stale response if a newer loadDraftScout(userId) call has started
  // since — otherwise a slow lookup for user A can overwrite a faster, more
  // recent lookup for user B and show A's tendencies under B's name.
  const requestSeq = useRef(0);

  const draftScoutPatterns = useMemo(() => {
    if (!draftScoutData?.length) return null;
    const leaguesWithPicks = draftScoutData.filter((l) => l.picks.length > 0);
    if (!leaguesWithPicks.length) return null;

    const allPicksFlat = leaguesWithPicks.flatMap((l) => l.picks);
    const total = allPicksFlat.length;
    const n = leaguesWithPicks.length;

    const posCounts: Record<string, number> = {};
    allPicksFlat.forEach((p) => {
      const pos = p.position || "?";
      posCounts[pos] = (posCounts[pos] || 0) + 1;
    });
    const sortedPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1]);

    const roundBreakdown: Record<number, Record<string, number>> = {};
    allPicksFlat.forEach((p) => {
      if (!roundBreakdown[p.round]) roundBreakdown[p.round] = {};
      const pos = p.position || "?";
      roundBreakdown[p.round][pos] = (roundBreakdown[p.round][pos] || 0) + 1;
    });

    const firstPicks = leaguesWithPicks.map((l) => l.picks[0]).filter(Boolean);
    const firstPickPos: Record<string, number> = {};
    firstPicks.forEach((p) => {
      const pos = p.position || "?";
      firstPickPos[pos] = (firstPickPos[pos] || 0) + 1;
    });
    const topFirstPos = Object.entries(firstPickPos).sort((a, b) => b[1] - a[1])[0];

    const tendencies: string[] = [];

    if (topFirstPos && firstPicks.length >= 2) {
      tendencies.push(`Opens with ${topFirstPos[0]} in ${topFirstPos[1]}/${firstPicks.length} leagues`);
    }
    if (sortedPos[0] && sortedPos[0][1] / total >= 0.4) {
      tendencies.push(
        `${sortedPos[0][0]}-heavy drafter — ${Math.round((sortedPos[0][1] / total) * 100)}% of all picks`
      );
    }
    const r1 = roundBreakdown[1];
    if (r1) {
      const r1Total = Object.values(r1).reduce((s: number, v: number) => s + v, 0);
      const r1Top = Object.entries(r1).sort((a, b) => b[1] - a[1])[0];
      if (r1Top && r1Top[1] >= 2) {
        tendencies.push(`Favors ${r1Top[0]} in Round 1 (${r1Top[1]}/${r1Total})`);
      }
    }
    const r1QB = roundBreakdown[1]?.QB || 0;
    const r2QB = roundBreakdown[2]?.QB || 0;
    if (r1QB > 0) tendencies.push(`QB in Round 1 (${r1QB} league${r1QB > 1 ? "s" : ""})`);
    else if (r2QB > 0) tendencies.push(`Early QB — Round 2 (${r2QB} league${r2QB > 1 ? "s" : ""})`);
    const r1TE = roundBreakdown[1]?.TE || 0;
    const r2TE = roundBreakdown[2]?.TE || 0;
    const r3TE = roundBreakdown[3]?.TE || 0;
    if (r1TE > 0) tendencies.push(`TE aggressive — Round 1 (${r1TE} league${r1TE > 1 ? "s" : ""})`);
    else if (r2TE > 0) tendencies.push(`TE in Round 2 (${r2TE} league${r2TE > 1 ? "s" : ""})`);
    else if (!r3TE && posCounts.TE) tendencies.push(`TE devaluer — waits until Round 4+`);

    return { sortedPos, roundBreakdown, tendencies, total, n };
  }, [draftScoutData]);

  const loadDraftScout = useCallback(async (userId: string) => {
    const seq = ++requestSeq.current;
    setDraftScoutUserId(userId);
    setDraftScoutData(null);
    setLoadingDraftScout(true);

    try {
      const leagues = await sleeperApi.getUserLeagues(userId, CURRENT_YEAR);
      const currentPlayers = playersRef.current;

      const results = await Promise.all(
        leagues.map(async (league) => {
          const drafts = await sleeperApi.getLeagueDrafts(league.league_id);

          const rookieDraft = drafts.find(
            (d: SleeperDraft) =>
              d.season === CURRENT_YEAR &&
              d.status !== "pre_draft" &&
              (d.settings?.rounds ?? 99) <= ROOKIE_DRAFT_MAX_ROUNDS
          );
          if (!rookieDraft) return null;

          const allPicks = await sleeperApi.getDraftPicks(rookieDraft.draft_id);

          const myPicks = allPicks
            .filter((p) => p.picked_by === userId)
            .sort((a, b) => a.pick_no - b.pick_no)
            .map((p) => ({
              slot: `${p.round}.${String(p.draft_slot).padStart(2, "0")}`,
              round: p.round,
              player: currentPlayers[p.player_id] || null,
              playerName: p.metadata?.first_name
                ? `${p.metadata.first_name} ${p.metadata.last_name}`
                : null,
              position: p.metadata?.position || null,
            }));

          return { leagueName: league.name, picks: myPicks };
        })
      );

      if (seq !== requestSeq.current) return; // a newer lookup started — discard stale result
      setDraftScoutData(results.filter((r) => r !== null) as DraftScoutLeague[]);
    } catch (err) {
      log.error("draft scout error", { err: String(err) });
    } finally {
      if (seq === requestSeq.current) setLoadingDraftScout(false);
    }
  }, []);

  const clearDraftScout = useCallback(() => {
    ++requestSeq.current; // invalidate any in-flight lookup
    setDraftScoutUserId(null);
    setDraftScoutData(null);
  }, []);

  return {
    draftScoutUserId,
    draftScoutData,
    loadingDraftScout,
    draftScoutPatterns,
    loadDraftScout,
    clearDraftScout,
  };
}
