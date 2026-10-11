import { withRetry } from "../../../lib/withRetry";
import { logger } from "../../../lib/logger";
import { DRAFT_HISTORY_LEAGUES_PER_REQUEST, DRAFT_HISTORY_MAX_IDLE_ROUNDS } from "../../../lib/constants";
import type { SleeperLeague } from "../../../lib/types";
import type { DraftHistoryResponse, SavedDraftPick } from "../../../lib/draft/rookieDrafts";

const log = logger("components/draftHub/DraftHistory/fetchDraftHistory");

/** One rookie draft's picks, labeled with the CURRENT league's name (every season of a league's
 *  chain shows under the name it has today) and the season's own league_id. */
export interface RawHistoryDraft {
  leagueName: string;
  leagueId: string;
  season: string;
  draftId: string;
  picks: SavedDraftPick[];
}

/** The route's own 429 or a 5xx — worth another try. */
class RetryableHistoryError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number) {
    super(`/api/draft-history ${status}`);
  }
}

async function postDraftHistory(leagueIds: string[]): Promise<DraftHistoryResponse> {
  return withRetry(
    async () => {
      const res = await fetch("/api/draft-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueIds }),
      });
      if (res.status === 429 || res.status >= 500) {
        const secs = Number(res.headers.get("Retry-After"));
        throw new RetryableHistoryError(res.status, Number.isFinite(secs) && secs > 0 ? Math.min(secs, 60) * 1000 : 0);
      }
      if (!res.ok) throw new Error(`/api/draft-history ${res.status}`);
      return (await res.json()) as DraftHistoryResponse;
    },
    3,
    (err) => err instanceof RetryableHistoryError,
    (err, i) => (err instanceof RetryableHistoryError && err.retryAfterMs > 0 ? err.retryAfterMs : 500 * 2 ** i),
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every rookie draft across `leagues` and up to 3 seasons back through each one's previous_league_id
 * chain, from /api/draft-history: saved drafts come straight from Supabase (migration 070), and the
 * server asks Sleeper only for what isn't saved yet — so once a league's drafts are saved, a visit
 * costs no Sleeper calls at all. (Until the snapshots this walked Sleeper from the browser, ~11 calls
 * a league and ~550 at 50 leagues, on every visit.)
 *
 * DRAFT_HISTORY_LEAGUES_PER_REQUEST leagues a request, one request at a time. A request that runs out
 * of time (a cold load) sends the leagues it didn't finish back as `pending`, and they go out again
 * with the next batch — after `retryAfterMs` if Sleeper asked the server to slow down. Gives up with
 * what it has after DRAFT_HISTORY_MAX_IDLE_ROUNDS requests in a row that finish nothing, or on a
 * request that fails outright.
 *
 * `shouldBail` stops between requests (a superseded load); `onLeagueDone` fires once per league for a
 * progress count.
 */
export async function fetchRookieDraftHistory(
  leagues: SleeperLeague[],
  opts: { shouldBail?: () => boolean; onLeagueDone?: () => void } = {}
): Promise<RawHistoryDraft[]> {
  const bail = () => opts.shouldBail?.() === true;
  const nameById = new Map(leagues.map((l) => [l.league_id, l.name]));
  let pending = Array.from(nameById.keys());
  const found: RawHistoryDraft[] = [];
  let idleRounds = 0;

  while (pending.length > 0 && !bail()) {
    const batch = pending.slice(0, DRAFT_HISTORY_LEAGUES_PER_REQUEST);
    let res: DraftHistoryResponse;
    try {
      res = await postDraftHistory(batch);
    } catch (err) {
      log.warn("draft history request failed — showing what loaded", { err: String(err), leaguesLeft: pending.length });
      break;
    }
    if (bail()) break;

    const finished = new Set<string>();
    for (const league of res.leagues ?? []) {
      if (!nameById.has(league.leagueId) || finished.has(league.leagueId)) continue;
      finished.add(league.leagueId);
      const leagueName = nameById.get(league.leagueId) ?? "";
      for (const d of league.drafts) {
        found.push({ leagueName, leagueId: d.leagueId, season: d.season, draftId: d.draftId, picks: d.picks });
      }
      opts.onLeagueDone?.();
    }
    pending = pending.filter((id) => !finished.has(id));

    if (finished.size > 0) idleRounds = 0;
    else if (++idleRounds >= DRAFT_HISTORY_MAX_IDLE_ROUNDS) {
      log.warn("draft history stopped making progress — showing what loaded", { leaguesLeft: pending.length });
      break;
    }
    if (pending.length > 0 && res.retryAfterMs) await sleep(Math.min(res.retryAfterMs, 60_000));
  }
  return found;
}
