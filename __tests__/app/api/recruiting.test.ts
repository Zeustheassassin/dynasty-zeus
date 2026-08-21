import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const checkRateLimit = vi.fn(async () => ({ allowed: true, remaining: 9 }));
  const fetchCfdRecruits = vi.fn(async () => [
    { id: 1, year: 2026, ranking: 1, name: "Prospect One", school: null, committedTo: null, position: "QB", height: null, weight: null, stars: 5, rating: 0.99, city: null, stateProvince: null, country: null },
  ]);
  return { checkRateLimit, fetchCfdRecruits };
});

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/recruiting/cfd", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recruiting/cfd")>("@/lib/recruiting/cfd");
  return { ...actual, fetchCfdRecruits: h.fetchCfdRecruits };
});

// recruits_meta row the mocked DB currently holds for the requested year —
// a mutable stand-in so the atomic claim's update()/insert() calls actually
// take effect, the same way a real UPDATE ... WHERE / INSERT would.
let metaRow: { last_refreshed_at: string } | null = null;
let deleteError: { message: string } | null = null;
let insertError: { message: string } | null = null;
let upsertError: { message: string } | null = null;
let deleteCalls = 0;
let insertedRows: unknown[] = [];

function makeFrom(table: string) {
  if (table === "recruits_meta") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: metaRow ? { ...metaRow } : null,
              error: null,
            }),
        }),
      }),
      update: (patch: { last_refreshed_at: string }) => ({
        eq: () => ({
          lt: (_col: string, threshold: string) => ({
            select: () => {
              if (metaRow && metaRow.last_refreshed_at < threshold) {
                metaRow = { ...metaRow, ...patch };
                return Promise.resolve({ data: [{ last_refreshed_at: metaRow.last_refreshed_at }], error: null });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
      }),
      insert: (row: { last_refreshed_at: string }) => {
        if (metaRow) {
          return Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } });
        }
        metaRow = { last_refreshed_at: row.last_refreshed_at };
        return Promise.resolve({ error: null });
      },
      upsert: (row: { last_refreshed_at: string }) => ({
        select: () => ({
          single: () => {
            metaRow = { last_refreshed_at: row.last_refreshed_at };
            return Promise.resolve({ data: row, error: upsertError });
          },
        }),
      }),
    };
  }
  // "recruits"
  return {
    delete: () => ({
      eq: () => {
        deleteCalls++;
        return Promise.resolve({ error: deleteError });
      },
    }),
    insert: (rows: unknown[]) => {
      insertedRows.push(...rows);
      return Promise.resolve({ error: insertError });
    },
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "auth-user-1" } } }) },
    from: (table: string) => makeFrom(table),
  }),
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/recruiting/[year]/route");
}

function makeReq(hasAuth = true): Request {
  return new Request("http://localhost/api/recruiting/2026", {
    method: "POST",
    headers: hasAuth ? { authorization: "Bearer tok-abc" } : {},
  });
}

const ctx = { params: Promise.resolve({ year: "2026" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
  h.fetchCfdRecruits.mockResolvedValue([
    { id: 1, year: 2026, ranking: 1, name: "Prospect One", school: null, committedTo: null, position: "QB", height: null, weight: null, stars: 5, rating: 0.99, city: null, stateProvince: null, country: null },
  ] as never);
  metaRow = null;
  deleteError = null;
  insertError = null;
  upsertError = null;
  deleteCalls = 0;
  insertedRows = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.CFD_API_KEY = "cfd-key";
});

describe("POST /api/recruiting/[year] — cooldown protects the shared CFD quota", () => {
  it("allows a refresh when the year has never been refreshed", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq() as never, ctx);
    expect(res.status).toBe(200);
    expect(h.fetchCfdRecruits).toHaveBeenCalledTimes(1);
    expect(deleteCalls).toBe(1);
    expect(insertedRows).toHaveLength(1);
  });

  it("rejects a refresh with 429 RECRUITING_COOLDOWN when the year was refreshed seconds ago — and never calls CFD", async () => {
    metaRow = { last_refreshed_at: new Date(Date.now() - 5_000).toISOString() }; // 5s ago
    const { POST } = await loadRoute();
    const res = await POST(makeReq() as never, ctx);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("RECRUITING_COOLDOWN");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    // The whole point: a blocked refresh must not spend a CFD call.
    expect(h.fetchCfdRecruits).not.toHaveBeenCalled();
    expect(deleteCalls).toBe(0);
  });

  it("allows a refresh again once the cooldown window has fully elapsed", async () => {
    metaRow = { last_refreshed_at: new Date(Date.now() - 61 * 60_000).toISOString() }; // 61 min ago
    const { POST } = await loadRoute();
    const res = await POST(makeReq() as never, ctx);
    expect(res.status).toBe(200);
    expect(h.fetchCfdRecruits).toHaveBeenCalledTimes(1);
  });

  it("still requires auth and respects the per-IP rate limit ahead of the cooldown check", async () => {
    const { POST } = await loadRoute();

    const unauthed = await POST(makeReq(false) as never, ctx);
    expect(unauthed.status).toBe(401);
    expect(h.fetchCfdRecruits).not.toHaveBeenCalled();

    h.checkRateLimit.mockResolvedValueOnce({ allowed: false, response: new Response("rl", { status: 429 }) } as never);
    const limited = await POST(makeReq() as never, ctx);
    expect(limited.status).toBe(429);
    expect(h.fetchCfdRecruits).not.toHaveBeenCalled();
  });
});
