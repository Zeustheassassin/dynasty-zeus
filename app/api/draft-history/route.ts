import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { apiError, SLEEPER_ID_RE } from "@/lib/apiHelpers";
import { logger } from "@/lib/logger";
import { withConcurrency } from "@/lib/concurrency";
import { fetchSleeperJson, SleeperUpstreamError } from "@/lib/server/sleeperProxy";
import {
  readLeagueSeasons, saveLeagueSeasons, readSavedDrafts, saveDrafts,
  type LeagueSeasonRow, type SavedDraft, type DraftSnapshotInput,
} from "@/lib/server/draftSnapshots";
import {
  isHistoryRookieDraft, isOpenDraft, isRookieLengthDraft, draftRounds, trimDraftPicks,
  type RookieDraftLike, type DraftHistoryDraft, type DraftHistoryResponse,
} from "@/lib/draft/rookieDrafts";
import { CURRENT_YEAR, isSeasonUnderway, isValidNflState } from "@/lib/helpers/season";
import {
  SLEEPER_BASE_URL,
  NFL_STATE_REVALIDATE_S,
  SLEEPER_LEAGUE_INFO_REVALIDATE_S,
  SLEEPER_LEAGUE_DRAFTS_REVALIDATE_S,
  SLEEPER_DRAFT_PICKS_REVALIDATE_S,
  SLEEPER_UPSTREAM_RETRY_AFTER_S,
  DRAFT_HISTORY_LEAGUE_CONCURRENCY,
  DRAFT_HISTORY_PREVIOUS_SEASONS,
  DRAFT_HISTORY_LEAGUES_PER_REQUEST,
  DRAFT_HISTORY_FILL_BUDGET_MS,
  DRAFT_HISTORY_RPM_PER_IP,
} from "@/lib/constants";

// ============================================================
// POST /api/draft-history { leagueIds } — Draft History's rookie drafts.
// ============================================================
// For each current league: its own season and up to DRAFT_HISTORY_PREVIOUS_SEASONS back through the
// previous_league_id chain, and every rookie draft in them (completed ones; this year's class also
// while it's drafting or paused).
//
// Saved first (migration 070, lib/server/draftSnapshots.ts), Sleeper only for what isn't:
//   - A league-season is checked with Sleeper (/league/{id} the first time, then /league/{id}/drafts)
//     only when it has no saved row or its row isn't final. A row is final once its draft list can't
//     change: a past season, or this one once the regular season is under way with no rookie draft
//     still open. So in season, once a league's drafts are saved, History makes no Sleeper calls.
//   - A completed draft's picks are fetched once (uncached, so the save holds the finished draft) and
//     saved for good. This class's drafts still in progress are read live and never saved.
// Every Sleeper call here goes through fetchSleeperJson, so it shares the proxies' Data Cache entries
// for the same URL and takes an interactive slot in the global Sleeper budget on a real call.
//
// One request stops starting Sleeper calls after DRAFT_HISTORY_FILL_BUDGET_MS, or as soon as Sleeper
// answers 429; leagues it didn't finish come back in `pending` (with `retryAfterMs` after a 429) and
// the browser asks again. Rows and drafts already saved make the next request pick up where this one
// stopped.
// ============================================================

export const maxDuration = 60;

const log = logger("api/draft-history");
const B = SLEEPER_BASE_URL;

interface SleeperLeagueInfo {
  league_id?: string;
  season?: string;
  previous_league_id?: string | null;
}

/** A league-season's part of one league's walk. */
interface SeasonDrafts {
  leagueId: string;
  season: string;
  completeIds: string[];
  liveIds: string[];
}

/** Season / league / round count for a draft whose picks may need fetching and saving. */
interface DraftMeta {
  leagueId: string;
  season: string;
  rounds: number | null;
}

function retryAfterMsFrom(header: string | null): number {
  const secs = header && /^\d+$/.test(header.trim()) ? Number(header.trim()) : SLEEPER_UPSTREAM_RETRY_AFTER_S;
  return Math.min(Math.max(secs, 1), 60) * 1000;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, DRAFT_HISTORY_RPM_PER_IP, 60_000, "draft-history");
  if (!rl.allowed) return rl.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("Bad JSON in request body", 400, "INVALID_JSON");
  }
  const raw = (body as { leagueIds?: unknown } | null)?.leagueIds;
  if (
    !Array.isArray(raw) || raw.length === 0 || raw.length > DRAFT_HISTORY_LEAGUES_PER_REQUEST ||
    !raw.every((id) => typeof id === "string" && SLEEPER_ID_RE.test(id))
  ) {
    return apiError(
      `leagueIds must be 1 to ${DRAFT_HISTORY_LEAGUES_PER_REQUEST} Sleeper league ids`,
      400,
      "INVALID_LEAGUE_IDS",
    );
  }

  return NextResponse.json(await loadDraftHistory(Array.from(new Set(raw as string[]))));
}

async function loadDraftHistory(leagueIds: string[]): Promise<DraftHistoryResponse> {
  // The class year tracks the calendar (the upcoming class), not the NFL season — read per request so
  // a warm instance doesn't carry last year's across Jan 1.
  const rookieYear = String(new Date().getFullYear());
  const deadline = Date.now() + DRAFT_HISTORY_FILL_BUDGET_MS;
  let retryAfterMs: number | undefined;
  let sleeperRequests = 0;
  /** Stop starting Sleeper calls: out of time, or Sleeper said slow down. */
  const stopped = () => retryAfterMs !== undefined || Date.now() > deadline;

  const sleeper = async <T,>(url: string, opts: { revalidate: number; bypass?: boolean }): Promise<T | null> => {
    sleeperRequests++;
    try {
      return await fetchSleeperJson<T>(url, opts);
    } catch (err) {
      if (err instanceof SleeperUpstreamError && err.status === 429) {
        retryAfterMs ??= retryAfterMsFrom(err.retryAfter);
      } else {
        log.warn("Sleeper request failed", {
          url: url.slice(B.length),
          err: err instanceof SleeperUpstreamError ? `status ${err.status}` : String(err),
        });
      }
      return null;
    }
  };

  // Only needed when a league-season row is (re)built, so only fetched then — from the Data Cache
  // entry /api/nfl-state shares, nearly always.
  let nflStatePromise: Promise<unknown> | null = null;
  const getNflState = () =>
    (nflStatePromise ??= sleeper<unknown>(`${B}/state/nfl`, { revalidate: NFL_STATE_REVALIDATE_S }));

  // ── 1. Saved league-seasons reachable from these leagues: one read per level of the chains ──
  const rows = new Map<string, LeagueSeasonRow>();
  let level = leagueIds;
  for (let depth = 0; depth <= DRAFT_HISTORY_PREVIOUS_SEASONS && level.length > 0; depth++) {
    const found = await readLeagueSeasons(level.filter((id) => !rows.has(id)));
    found.forEach((row, id) => rows.set(id, row));
    level = Array.from(new Set(
      level.map((id) => rows.get(id)?.previous_league_id).filter((id): id is string => !!id && !rows.has(id)),
    ));
  }

  // ── 2. Walk each league's chain, checking a league-season with Sleeper only when it must ──
  const rowsToSave: LeagueSeasonRow[] = [];
  const draftMeta = new Map<string, DraftMeta>();

  /** A league-season row from a fresh Sleeper draft list, plus this class's drafts in progress. */
  const buildRow = async (
    leagueId: string, season: string, previousLeagueId: string | null, drafts: Array<RookieDraftLike & { draft_id: string }>,
  ): Promise<{ row: LeagueSeasonRow; liveIds: string[] }> => {
    const rookie = drafts.filter((d) => d && typeof d.draft_id === "string" && isRookieLengthDraft(d));
    const complete = rookie.filter((d) => d.status === "complete");
    for (const d of rookie) {
      draftMeta.set(d.draft_id, { leagueId, season: String(d.season || season), rounds: draftRounds(d) });
    }
    const nflState = await getNflState();
    const currentSeason = Number(isValidNflState(nflState) ? nflState.season : CURRENT_YEAR);
    const final = Number(season) < currentSeason || (isSeasonUnderway(season, nflState) && !rookie.some(isOpenDraft));
    return {
      row: {
        league_id: leagueId,
        season,
        previous_league_id: previousLeagueId,
        rookie_draft_ids: complete.map((d) => d.draft_id),
        final,
      },
      liveIds: rookie.filter((d) => d.status !== "complete" && isHistoryRookieDraft(d, rookieYear)).map((d) => d.draft_id),
    };
  };

  /** Null = cut off before this league's walk finished (it goes back as pending). */
  const walkLeague = async (leagueId: string): Promise<SeasonDrafts[] | null> => {
    const seasons: SeasonDrafts[] = [];
    let id: string | null = leagueId;
    for (let depth = 0; id && depth <= DRAFT_HISTORY_PREVIOUS_SEASONS; depth++) {
      const saved = rows.get(id);
      if (saved?.final) {
        seasons.push({ leagueId: id, season: saved.season, completeIds: saved.rookie_draft_ids, liveIds: [] });
        id = saved.previous_league_id;
        continue;
      }
      if (stopped()) return null;

      // Season + previous league: from the saved row, else Sleeper (the first time only).
      let season: string | undefined = saved?.season;
      let previousLeagueId: string | null = saved?.previous_league_id ?? null;
      if (!saved) {
        const info: SleeperLeagueInfo | null = await sleeper<SleeperLeagueInfo | null>(`${B}/league/${id}`, { revalidate: SLEEPER_LEAGUE_INFO_REVALIDATE_S });
        if (!info || typeof info.season !== "string") {
          if (stopped()) return null;
          break; // Sleeper doesn't know this league — the chain ends here, as it always has
        }
        season = info.season;
        // Sleeper sends "0" (or nothing) for a league with no previous season.
        const prev: string | null | undefined = info.previous_league_id;
        previousLeagueId = prev && prev !== "0" && SLEEPER_ID_RE.test(prev) ? prev : null;
      }

      const drafts = await sleeper<Array<RookieDraftLike & { draft_id: string }>>(
        `${B}/league/${id}/drafts`,
        { revalidate: SLEEPER_LEAGUE_DRAFTS_REVALIDATE_S },
      );
      if (Array.isArray(drafts)) {
        const built = await buildRow(id, season!, previousLeagueId, drafts);
        rows.set(id, built.row);
        rowsToSave.push(built.row);
        seasons.push({ leagueId: id, season: season!, completeIds: built.row.rookie_draft_ids, liveIds: built.liveIds });
      } else if (stopped()) {
        return null;
      } else if (saved) {
        // Couldn't re-check: show what was saved.
        seasons.push({ leagueId: id, season: saved.season, completeIds: saved.rookie_draft_ids, liveIds: [] });
      }
      // (No list and nothing saved: this season's drafts are skipped and the walk goes on, as before.)
      id = previousLeagueId;
    }
    return seasons;
  };

  const walks = await withConcurrency(leagueIds, walkLeague, DRAFT_HISTORY_LEAGUE_CONCURRENCY);
  await saveLeagueSeasons(rowsToSave);

  // ── 3. Picks: saved ones in one read; the rest from Sleeper ──
  const done = walks.filter((w): w is SeasonDrafts[] => w !== null);
  const completeIds = Array.from(new Set(done.flatMap((w) => w.flatMap((s) => s.completeIds))));
  const liveIds = Array.from(new Set(done.flatMap((w) => w.flatMap((s) => s.liveIds))));
  const savedDrafts = await readSavedDrafts(completeIds);

  // A completed draft not saved yet: fetched uncached (a Data Cache entry from while it was still
  // drafting could be missing the last picks) and saved for good.
  const fetched = new Map<string, SavedDraft>();
  const attempted = new Set<string>();
  const toSave: DraftSnapshotInput[] = [];
  await withConcurrency(
    completeIds.filter((id) => !savedDrafts.has(id)),
    async (draftId) => {
      const picks = trimDraftPicks(await sleeper<unknown>(`${B}/draft/${draftId}/picks`, {
        revalidate: SLEEPER_DRAFT_PICKS_REVALIDATE_S,
        bypass: true,
      }));
      if (!picks && stopped()) return; // cut off by a 429: its league goes back as pending
      attempted.add(draftId);
      if (!picks) return;
      const meta = draftMeta.get(draftId) ?? seasonOf(done, draftId);
      const draft: SavedDraft = { draftId, leagueId: meta.leagueId, season: meta.season, picks };
      fetched.set(draftId, draft);
      // A completed draft with no picks is shown but not saved — more likely a bad answer than a
      // real empty draft, so it's asked for again next time.
      if (picks.length > 0) toSave.push({ ...draft, rounds: meta.rounds });
    },
    DRAFT_HISTORY_LEAGUE_CONCURRENCY,
    { shouldBail: stopped },
  );
  await saveDrafts(toSave);

  // This class's drafts still in progress: live picks through the picks proxy's Data Cache entry, never saved.
  const live = new Map<string, SavedDraft>();
  await withConcurrency(
    liveIds,
    async (draftId) => {
      const picks = trimDraftPicks(await sleeper<unknown>(`${B}/draft/${draftId}/picks`, {
        revalidate: SLEEPER_DRAFT_PICKS_REVALIDATE_S,
      }));
      if (!picks && stopped()) return;
      attempted.add(draftId);
      if (!picks) return;
      const meta = draftMeta.get(draftId) ?? seasonOf(done, draftId);
      live.set(draftId, { draftId, leagueId: meta.leagueId, season: meta.season, picks });
    },
    DRAFT_HISTORY_LEAGUE_CONCURRENCY,
    { shouldBail: stopped },
  );

  // ── 4. Answer: a league is finished when every one of its drafts was read or tried ──
  const leagues: DraftHistoryResponse["leagues"] = [];
  const pending: string[] = [];
  leagueIds.forEach((leagueId, i) => {
    const seasons = walks[i];
    const resolved = (id: string) => savedDrafts.has(id) || attempted.has(id);
    if (!seasons || !seasons.every((s) => s.completeIds.every(resolved) && s.liveIds.every(resolved))) {
      pending.push(leagueId);
      return;
    }
    const drafts: DraftHistoryDraft[] = [];
    for (const s of seasons) {
      for (const draftId of [...s.completeIds, ...s.liveIds]) {
        const d = savedDrafts.get(draftId) ?? fetched.get(draftId) ?? live.get(draftId);
        if (d) drafts.push({ leagueId: s.leagueId, season: d.season, draftId, picks: d.picks });
      }
    }
    leagues.push({ leagueId, drafts });
  });

  const stats = { savedDrafts: savedDrafts.size, fetchedDrafts: fetched.size, liveDrafts: live.size, sleeperRequests };
  if (sleeperRequests > 0) {
    log.info("draft history filled from Sleeper", {
      leagues: leagueIds.length, pending: pending.length, rowsSaved: rowsToSave.length, ...stats,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  return { leagues, pending, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), stats };
}

/** League + season for a draft found in a walk (a saved row's draft whose picks weren't saved). */
function seasonOf(walks: SeasonDrafts[][], draftId: string): DraftMeta {
  for (const w of walks) {
    for (const s of w) {
      if (s.completeIds.includes(draftId) || s.liveIds.includes(draftId)) {
        return { leagueId: s.leagueId, season: s.season, rounds: null };
      }
    }
  }
  return { leagueId: "", season: "", rounds: null };
}
