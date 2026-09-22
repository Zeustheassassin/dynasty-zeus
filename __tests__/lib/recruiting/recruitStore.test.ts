// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Batch 4 (Sept 21 2026 audit): useRecruitIndex() used to page the whole `recruits` table
// (no ORDER BY) once per mount, and 3-4 scouting lists mount at once. This module-level store
// shares one load across concurrent mounts and caches it — these tests cover the store directly
// (the sharing/caching behavior), not the paging math (that's exercised end to end here too,
// but the interesting bugs are in cache lifetime, not arithmetic).

type Row = { id: string; name: string; position: string; year: number; stars: number | null };
type PageAnswer = { data: Row[] | null; error: { message: string } | null; count: number | null };

const row = (n: number): Row => ({ id: String(n).padStart(6, "0"), name: `Player ${n}`, position: "WR", year: 2024, stars: 3 });

// Queue of answers, one per `.range()` call, keyed by page index (from / PAGE). Any page not
// explicitly queued answers with an empty, error-free page (safety net against infinite loops).
let pages: Map<number, PageAnswer>;
let rangeCalls: { from: number; to: number }[];
// Overridable per test for the two timing-sensitive tests below; defaults to the `pages` lookup.
let rangeImpl: (from: number, to: number) => Promise<PageAnswer>;

function defaultRangeImpl(from: number, _to: number): Promise<PageAnswer> {
  const page = Math.floor(from / 1000);
  return Promise.resolve(pages.get(page) ?? { data: [], error: null, count: null });
}

vi.mock("@/lib/supabaseclient", () => ({
  get supabase() {
    return {
      from: (_table: string) => ({
        select: (_cols: string, _opts?: { count: string }) => ({
          order: (_col: string, _ascOpts?: unknown) => ({
            range: (from: number, to: number) => {
              rangeCalls.push({ from, to });
              return rangeImpl(from, to);
            },
          }),
        }),
      }),
    };
  },
}));

async function importStore() {
  return import("@/lib/recruiting/recruitStore");
}

beforeEach(() => {
  vi.resetModules(); // fresh module-level cache/inflight/generation each test
  pages = new Map();
  rangeCalls = [];
  rangeImpl = defaultRangeImpl;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("recruitStore", () => {
  it("peekRecruitSnapshot is null before any load", async () => {
    const { peekRecruitSnapshot } = await importStore();
    expect(peekRecruitSnapshot()).toBeNull();
  });

  it("a short first page is treated as complete with no further requests", async () => {
    pages.set(0, { data: [row(1), row(2)], error: null, count: null });
    const { loadRecruitSnapshot } = await importStore();

    const snap = await loadRecruitSnapshot();
    expect(snap.complete).toBe(true);
    expect(snap.rows.map((r) => r.id)).toEqual([row(1).id, row(2).id]);
    expect(rangeCalls).toHaveLength(1);
  });

  it("concurrent mounts share one in-flight load", async () => {
    let releasePage0!: (a: PageAnswer) => void;
    rangeImpl = () => new Promise((resolve) => { releasePage0 = resolve; });
    const { loadRecruitSnapshot } = await importStore();

    const p1 = loadRecruitSnapshot();
    const p2 = loadRecruitSnapshot();
    releasePage0({ data: [row(1)], error: null, count: null });
    const [snap1, snap2] = await Promise.all([p1, p2]);

    expect(snap1).toBe(snap2); // same object — one fetch, not two
    expect(snap1.rows).toHaveLength(1);
    expect(rangeCalls).toHaveLength(1);
  });

  it("caches a complete, non-empty result and does not refetch within the TTL", async () => {
    pages.set(0, { data: [row(1)], error: null, count: null });
    const { loadRecruitSnapshot, peekRecruitSnapshot } = await importStore();

    const first = await loadRecruitSnapshot();
    expect(rangeCalls).toHaveLength(1);

    const second = await loadRecruitSnapshot();
    expect(second).toBe(first);
    expect(rangeCalls).toHaveLength(1); // no new request
    expect(peekRecruitSnapshot()).toBe(first);
  });

  it("does NOT cache a partial result (a page errored) — the next call retries", async () => {
    pages.set(0, { data: null, error: { message: "boom" }, count: null });
    const { loadRecruitSnapshot, peekRecruitSnapshot } = await importStore();

    const first = await loadRecruitSnapshot();
    expect(first.complete).toBe(false);
    expect(first.rows).toEqual([]);
    expect(peekRecruitSnapshot()).toBeNull();

    // Recover on retry.
    pages.set(0, { data: [row(1)], error: null, count: null });
    const second = await loadRecruitSnapshot();
    expect(second.complete).toBe(true);
    expect(rangeCalls).toHaveLength(2);
  });

  it("does NOT cache an empty-but-complete result (e.g. RLS denies an unauthenticated read) — retries", async () => {
    pages.set(0, { data: [], error: null, count: null });
    const { loadRecruitSnapshot, peekRecruitSnapshot } = await importStore();

    const first = await loadRecruitSnapshot();
    expect(first.complete).toBe(true);
    expect(first.rows).toEqual([]);
    expect(peekRecruitSnapshot()).toBeNull();

    pages.set(0, { data: [row(1)], error: null, count: null });
    await loadRecruitSnapshot();
    expect(rangeCalls).toHaveLength(2); // second call actually re-hit the network
  });

  it("invalidateRecruitSnapshot drops the cache and forces a refetch", async () => {
    pages.set(0, { data: [row(1)], error: null, count: null });
    const { loadRecruitSnapshot, invalidateRecruitSnapshot, peekRecruitSnapshot } = await importStore();

    await loadRecruitSnapshot();
    expect(peekRecruitSnapshot()).not.toBeNull();

    invalidateRecruitSnapshot();
    expect(peekRecruitSnapshot()).toBeNull();

    pages.set(0, { data: [row(1), row(2)], error: null, count: null });
    const after = await loadRecruitSnapshot();
    expect(after.rows).toHaveLength(2);
    expect(rangeCalls).toHaveLength(2);
  });

  it("invalidateRecruitSnapshot during an in-flight load makes that load's result uncacheable", async () => {
    let releasePage0!: (a: PageAnswer) => void;
    rangeImpl = () => new Promise((resolve) => { releasePage0 = resolve; });
    const { loadRecruitSnapshot, invalidateRecruitSnapshot, peekRecruitSnapshot } = await importStore();

    const pending = loadRecruitSnapshot();
    invalidateRecruitSnapshot(); // e.g. a CFD refresh completed while the old load was still in flight
    releasePage0({ data: [row(1)], error: null, count: null });
    await pending;

    // The stale load must not have re-populated the cache after being invalidated.
    expect(peekRecruitSnapshot()).toBeNull();
  });

  it("pages past the 1000-row cap using the first page's count, in id order", async () => {
    const page0 = Array.from({ length: 1000 }, (_, i) => row(i));
    const page1 = Array.from({ length: 1000 }, (_, i) => row(1000 + i));
    const page2 = Array.from({ length: 500 }, (_, i) => row(2000 + i));
    pages.set(0, { data: page0, error: null, count: 2500 });
    pages.set(1, { data: page1, error: null, count: null });
    pages.set(2, { data: page2, error: null, count: null });

    const { loadRecruitSnapshot } = await importStore();
    const snap = await loadRecruitSnapshot();

    expect(snap.complete).toBe(true);
    expect(snap.rows).toHaveLength(2500);
    expect(snap.rows[0].id).toBe(row(0).id);
    expect(snap.rows[2499].id).toBe(row(2499).id);
    expect(rangeCalls).toHaveLength(3);
  });
});
