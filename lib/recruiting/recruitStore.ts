// Shared, module-level loader for the recruit name index used by prospect→recruit matching.
//
// Four scouting lists/hubs (WR/RB/TE prospect lists, QBHub) each call useRecruitIndex(), and
// each mount used to page the whole `recruits` table (~30 sequential 1000-row requests, with
// no ORDER BY) on its own. This store loads it once, shares the in-flight promise between
// concurrent mounts, and reuses the result for RECRUIT_STORE_TTL_MS.
//
// Cache rules:
//   - A partial result (a page failed) is returned to the caller but NEVER cached, so the next
//     mount retries instead of pinning a truncated index.
//   - An empty result is never cached either: RLS returns zero rows (not an error) to an
//     unauthenticated client, and that must not stick for the TTL.
//   - invalidateRecruitSnapshot() drops the cache AND discards any load already in flight
//     (it may have read pre-refresh rows). useRecruits.refresh() calls it after a CFD refresh.

import { supabase } from "../supabaseclient";
import { logger } from "../logger";
import type { RecruitRow } from "./cfd";
import { buildRecruitIndex } from "./match";

const log = logger("lib/recruiting/recruitStore");

// PostgREST caps a single select at `max-rows` (1000) regardless of .range().
const PAGE = 1000;
// Pages requested at once after the first. Small on purpose — shares the browser's
// per-host connection budget with everything else on the page.
const PAGE_CONCURRENCY = 4;
const COLUMNS = "id,name,position,year,stars,school,ranking,committed_to";

// Recruiting rankings change only when someone runs a CFD refresh (cooldown: 1h/year).
export const RECRUIT_STORE_TTL_MS = 10 * 60_000;

export interface RecruitSnapshot {
  rows: RecruitRow[];
  index: Map<string, RecruitRow[]>;
  /** false when any page failed — usable for matching, but never cached. */
  complete: boolean;
}

interface PageResult {
  rows: RecruitRow[];
  count: number | null;
  error: string | null;
}

async function fetchPage(page: number): Promise<PageResult> {
  const from = page * PAGE;
  try {
    // ORDER BY id (the text primary key) makes offset paging deterministic. Without it a
    // concurrent CFD refresh (delete + insert) can duplicate or skip rows between pages.
    // The first page also asks for the exact row count so the rest can be fetched in parallel.
    const { data, error, count } = await supabase
      .from("recruits")
      .select(COLUMNS, page === 0 ? { count: "exact" } : undefined)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows: [], count: null, error: error.message };
    return { rows: (data ?? []) as unknown as RecruitRow[], count: count ?? null, error: null };
  } catch (e) {
    return { rows: [], count: null, error: String(e) };
  }
}

async function fetchAllRecruits(): Promise<{ rows: RecruitRow[]; complete: boolean }> {
  const first = await fetchPage(0);
  if (first.error) {
    log.error("recruit index load failed", { err: first.error, page: 0 });
    return { rows: [], complete: false };
  }
  const rows = [...first.rows];
  if (first.rows.length < PAGE) return { rows, complete: true };

  let complete = true;
  let page = 1;
  let lastLen = first.rows.length;

  // Pages the count says exist, PAGE_CONCURRENCY at a time (results kept in page order).
  const knownPages = first.count != null ? Math.ceil(first.count / PAGE) : 1;
  while (page < knownPages && complete) {
    const window = Array.from({ length: Math.min(PAGE_CONCURRENCY, knownPages - page) }, (_, i) => page + i);
    const results = await Promise.all(window.map(fetchPage));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.error) {
        log.error("recruit index load failed", { err: r.error, page: window[i] });
        complete = false;
        continue;
      }
      rows.push(...r.rows);
    }
    lastLen = results[results.length - 1].rows.length;
    page += window.length;
  }

  // Tail: rows may have been added since the count (or the count was unavailable), so keep
  // going one page at a time until a short page confirms the end.
  while (complete && lastLen === PAGE) {
    const r = await fetchPage(page);
    if (r.error) {
      log.error("recruit index load failed", { err: r.error, page });
      complete = false;
      break;
    }
    rows.push(...r.rows);
    lastLen = r.rows.length;
    page += 1;
  }

  return { rows, complete };
}

let cached: { snapshot: RecruitSnapshot; at: number } | null = null;
let inflight: Promise<RecruitSnapshot> | null = null;
// Bumped by invalidateRecruitSnapshot(); a load only caches if it started in the current generation.
let generation = 0;

/** The cached snapshot if it is still within the TTL, else null. Never triggers a fetch. */
export function peekRecruitSnapshot(): RecruitSnapshot | null {
  return cached && Date.now() - cached.at < RECRUIT_STORE_TTL_MS ? cached.snapshot : null;
}

/** Cached snapshot, or the shared in-flight load, or a fresh load. Never rejects. */
export function loadRecruitSnapshot(): Promise<RecruitSnapshot> {
  const fresh = peekRecruitSnapshot();
  if (fresh) return Promise.resolve(fresh);
  if (inflight) return inflight;

  const startedIn = generation;
  const load: Promise<RecruitSnapshot> = fetchAllRecruits()
    .then(({ rows, complete }) => {
      const snapshot: RecruitSnapshot = { rows, index: buildRecruitIndex(rows), complete };
      if (complete && rows.length > 0 && startedIn === generation) {
        cached = { snapshot, at: Date.now() };
      }
      return snapshot;
    })
    .finally(() => {
      if (inflight === load) inflight = null;
    });
  inflight = load;
  return load;
}

/** Drop the cache and forget any load in flight — call after the recruits table changes. */
export function invalidateRecruitSnapshot(): void {
  generation += 1;
  cached = null;
  inflight = null;
}
