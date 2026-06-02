// ============================================================
// projectRookiesByRoster — offseason rookie draft projection
// ============================================================
// Extracted verbatim from the useAppState memo so it can be called
// both by the connected-user simulator and by the read-only User
// Scout view. Runs a simplified BPA draft sim to project which
// rookie lands on each team. Only active in offseason mode — in
// season, rookies are already on Sleeper rosters. Every team is
// covered, not just the user's. Behavior is identical to the
// original memo; every closure input is now an explicit argument.
// ============================================================
import type { PoolPlayer } from "./simulation";
import type {
  SleeperLeague, SleeperRoster, SleeperPlayer, SleeperNFLState,
  SleeperDraft, RookieBoardPlayer, AugmentedPick,
} from "../types";

export interface ProjectRookiesArgs {
  selectedLeague: SleeperLeague | null;
  nflState: SleeperNFLState | null;
  draftSettings: SleeperDraft | null;
  rosters: SleeperRoster[];
  rookies: RookieBoardPlayer[];
  allPicks: AugmentedPick[];
  players: Record<string, SleeperPlayer>;
  leagueAdjustedFcValues: Record<string, number>;
}

export function projectRookiesByRoster({
  selectedLeague,
  nflState,
  draftSettings,
  rosters,
  rookies,
  allPicks,
  players,
  leagueAdjustedFcValues,
}: ProjectRookiesArgs): Map<number, PoolPlayer[]> {
  const empty = new Map<number, PoolPlayer[]>();
  if (!selectedLeague || !rosters.length || !rookies.length) return empty;
  const isOffseason = !(nflState?.season_type === "regular" && Number(nflState?.week || 0) > 0);
  if (!isOffseason) return empty;

  // Rookie draft complete → drafted rookies are now on Sleeper rosters;
  // projecting again would double-count. The pickYearWindow logic also
  // prevents this implicitly (current-year slots vanish from allPicks), but
  // guard explicitly so the intent survives any future refactor of that chain.
  const currentDraftRounds = Number(draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 99);
  if (draftSettings?.status === "complete" && currentDraftRounds <= 6) return empty;

  // Guard: allPicks updates after rosters on league switch. If picks exist but
  // none belong to the current league's rosters, data is mid-update — bail and
  // wait for the next render rather than crashing on a stale owner_id lookup.
  const leagueRosterIds = new Set(rosters.map((r) => Number(r.roster_id)));
  if (allPicks.length > 0 && !allPicks.some((p) => leagueRosterIds.has(Number(p.owner_id)))) return empty;

  const numTeams = rosters.length;
  const numRounds = Number(draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 4);
  const isSnake = ((draftSettings?.settings?.type ?? draftSettings?.type) || "snake") !== "linear";

  const normName = (s: string) =>
    s.toLowerCase()
      .replace(/\s+jr\.?$|\s+sr\.?$|\s+ii$|\s+iii$|\s+iv$/i, "")
      .replace(/[^a-z]/g, "");

  const valueByNormName: Record<string, number> = {};
  (Object.entries(players) as [string, SleeperPlayer][]).forEach(([id, p]) => {
    const val = leagueAdjustedFcValues[id] ?? p.value ?? 0;
    if (val > 0 && p.full_name) {
      const key = normName(p.full_name);
      if (!valueByNormName[key] || val > valueByNormName[key]) valueByNormName[key] = val;
    }
  });

  const getRookieValue = (r: RookieBoardPlayer): number =>
    (r.player_id ? (leagueAdjustedFcValues[r.player_id] ?? 0) : 0) || valueByNormName[normName(r.name)] || 0;

  const pool = [...rookies]
    .map((r: RookieBoardPlayer, idx: number) => {
      const val = getRookieValue(r);
      const hasAdp = typeof r.adp === "number" && r.adp < 9999;
      const sortKey = val > 0
        ? -val + (hasAdp ? r.adp * 0.01 : 0)
        : hasAdp ? 50000 + r.adp : 200000 + idx;
      return { ...r, _sortKey: sortKey };
    })
    .sort((a, b) => a._sortKey - b._sortKey);

  const slotOwnerMap = new Map<string, number>();
  allPicks.forEach((p) => {
    if (p.slot && p.owner_id) slotOwnerMap.set(String(p.slot), Number(p.owner_id));
  });

  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  const result = new Map<number, PoolPlayer[]>();
  rosters.forEach((r) => result.set(Number(r.roster_id), []));

  for (let round = 1; round <= numRounds; round++) {
    const slotOrder = isSnake && round % 2 === 0
      ? Array.from({ length: numTeams }, (_, i) => numTeams - i)
      : Array.from({ length: numTeams }, (_, i) => i + 1);

    for (let pickIdx = 0; pickIdx < numTeams; pickIdx++) {
      const slotNum = slotOrder[pickIdx];
      const slotStr = `${round}.${String(slotNum).padStart(2, "0")}`;
      const rosterId = slotOwnerMap.get(slotStr);
      if (!rosterId) continue;

      const best = pool.find((r) => {
        if (!["QB", "RB", "WR", "TE"].includes(r.position)) return false;
        if (r.player_id && usedIds.has(r.player_id)) return false;
        if (r.name && usedNames.has(normName(r.name))) return false;
        return true;
      });
      if (!best) continue;

      if (best.player_id) usedIds.add(best.player_id);
      if (best.name) usedNames.add(normName(best.name));

      const val = getRookieValue(best);
      const syntheticId = best.player_id ?? `rookie_${normName(best.name)}`;
      result.get(rosterId)?.push({
        id: syntheticId,
        position: best.position,
        nflTeam: best.team || null,
        score: val > 0 ? val / 425 : 0,
      });
    }
  }
  return result;
}
