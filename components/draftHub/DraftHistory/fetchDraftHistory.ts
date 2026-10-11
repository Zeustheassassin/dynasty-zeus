import { sleeperApi } from "../../../lib/sleeperApi";
import { withConcurrency } from "../../../lib/concurrency";
import { BASE_YEAR, ROOKIE_DRAFT_MAX_ROUNDS } from "../../../lib/helpers";
import { DRAFT_HISTORY_LEAGUE_CONCURRENCY } from "../../../lib/constants";
import type { SleeperLeague } from "../../../lib/types";
import type { SleeperDraftBasic, SleeperPickBasic } from "../shared";

// Rookie-draft class year tracks the CALENDAR (upcoming class), not the NFL season.
export const ROOKIE_YEAR = String(BASE_YEAR);

/** How far back each current league's previous_league_id chain is walked. */
const PREVIOUS_SEASONS = 3;

/** One rookie draft's raw picks, labeled with the CURRENT league's name (every season of a league's
 *  chain shows under the name it has today) and the season's own league_id. */
export interface RawHistoryDraft {
  leagueName: string;
  leagueId: string;
  season: string;
  draftId: string;
  picks: SleeperPickBasic[];
}

/** Rookie-length drafts only. Past classes count once complete; the current class also while it's
 *  drafting or paused, so its partial picks show as a live ADP read. */
export function isHistoryRookieDraft(d: SleeperDraftBasic): boolean {
  const rounds = d.settings?.rounds ?? d.rounds ?? 99;
  if (rounds > ROOKIE_DRAFT_MAX_ROUNDS) return false;
  if (d.season !== ROOKIE_YEAR) return d.status === "complete";
  return d.status === "complete" || d.status === "drafting" || d.status === "paused";
}

/**
 * Every rookie draft across `leagues` and up to PREVIOUS_SEASONS seasons back through each one's
 * previous_league_id chain — ~11 Sleeper calls a league (3 league lookups, 4 draft lists, ~4 pick
 * lists), ~550 at 50 leagues.
 *
 * DRAFT_HISTORY_LEAGUE_CONCURRENCY leagues at a time, each league's calls one after another, so
 * Draft History never has more than that many calls waiting in sleeperApi's queue — the overview
 * poll or a Refresh queued behind it waits for those, not for the whole list. (Until 10/10 this was
 * a nested Promise.all that fired every call at once.)
 *
 * `shouldBail` stops the walk between calls (a superseded load); `onLeagueDone` fires once per
 * league for a progress count. A failed lookup skips just that season, as before.
 */
export async function fetchRookieDraftHistory(
  leagues: SleeperLeague[],
  opts: { shouldBail?: () => boolean; onLeagueDone?: () => void } = {}
): Promise<RawHistoryDraft[]> {
  const bail = () => opts.shouldBail?.() === true;

  const loadLeague = async (league: SleeperLeague): Promise<RawHistoryDraft[]> => {
    const found: RawHistoryDraft[] = [];
    // Always include the current league so its in-progress / completed current-year draft appears.
    const toCheck: string[] = [league.league_id];
    let prevId: string | null = league.previous_league_id ?? null;
    let depth = 0;
    while (prevId && depth < PREVIOUS_SEASONS && !bail()) {
      toCheck.push(prevId);
      const prev = await sleeperApi.getLeagueInfo(prevId);
      if (!prev) break;
      prevId = prev.previous_league_id ?? null;
      depth++;
    }

    for (const leagueId of toCheck) {
      if (bail()) break;
      try {
        const drafts: SleeperDraftBasic[] = await sleeperApi.getLeagueDrafts(leagueId);
        if (!Array.isArray(drafts)) continue;
        for (const draft of drafts.filter(isHistoryRookieDraft)) {
          if (bail()) break;
          const picks: SleeperPickBasic[] = await sleeperApi.getDraftPicks(draft.draft_id);
          if (!Array.isArray(picks)) continue;
          found.push({ leagueName: league.name, leagueId, season: draft.season, draftId: draft.draft_id, picks });
        }
      } catch {
        // The getOrNull-style calls above return []/null rather than throw; this only guards a
        // season against something unexpected so it can't take the whole league down with it.
      }
    }
    opts.onLeagueDone?.();
    return found;
  };

  const perLeague = await withConcurrency(leagues, loadLeague, DRAFT_HISTORY_LEAGUE_CONCURRENCY, {
    shouldBail: bail,
  });
  return perLeague.flat();
}
