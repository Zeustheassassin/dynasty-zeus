// Tests for the NFL contracts refresh cron GET handler.
//
// Same approach as player-value-history.test.ts: env is set before each
// import and vi.resetModules() runs per test. The source fetch is mocked
// (lib/server/nflContracts); the shaping it feeds is covered in
// __tests__/lib/nflContracts.test.ts. Covers the auth/env guards, the
// unavailable-sources and broken-sources guards (nothing written), the
// batched upsert onConflict otc_id, and a failed batch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawContract } from "@/lib/nflContracts";

const SECRET = "super-secret-cron-token";

interface FakeState {
  upserts: { batch: unknown[]; opts: unknown }[];
  failBatch: number | null;
}
let fake: FakeState;

const h = vi.hoisted(() => ({ fetchContractSources: vi.fn() }));
vi.mock("@/lib/server/nflContracts", () => ({ fetchContractSources: h.fetchContractSources }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "nfl_contracts") throw new Error(`unexpected table ${table}`);
      return {
        upsert: (batch: unknown[], opts: unknown) => {
          const n = fake.upserts.push({ batch, opts });
          return Promise.resolve({ error: fake.failBatch === n - 1 ? { message: "boom" } : null });
        },
      };
    },
  }),
}));

function makeReq(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return { headers } as unknown as import("next/server").NextRequest;
}

async function loadGET() {
  vi.resetModules();
  const mod = await import("../../../../app/api/cron/nfl-contracts/route");
  return mod.GET;
}

/** n active players (half WRs, half linemen) plus one released WR whose deal reached 2026. */
function contracts(n: number): RawContract[] {
  const out: RawContract[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      player: `Player ${i}`, position: i % 2 ? "WR" : "LT", team: "Packers", is_active: true,
      year_signed: 2025, years: 3, apy: 1, otc_id: i, gsis_id: `00-${String(i).padStart(7, "0")}`,
      season_history: [{ year: "2025", base_salary: 1, cap_number: 1 }, { year: "Total" }],
    });
  }
  out.push({
    player: "Released WR", position: "WR", team: "Packers", is_active: false, year_signed: 2024,
    otc_id: n + 1, gsis_id: "00-9999999", season_history: [{ year: "2026", base_salary: 2, cap_number: 3 }],
  });
  return out;
}

/** What fetchContractSources returns: the contracts plus the whole file's active count. */
function sources(n: number, idMap: Map<string, string>, sourceUpdatedAt: string | null = null) {
  const list = contracts(n);
  return { contracts: list, activeInFile: list.filter((r) => r.is_active).length, gsisToSleeper: idMap, sourceUpdatedAt };
}

function ids(n: number, mapEvery = 1): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 1; i <= n; i++) if (i % mapEvery === 0) m.set(`00-${String(i).padStart(7, "0")}`, `s${i}`);
  return m;
}

const ORIG_ENV = {
  CRON_SECRET: process.env.CRON_SECRET,
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  fake = { upserts: [], failBatch: null };
  h.fetchContractSources.mockReset();
  h.fetchContractSources.mockResolvedValue(sources(1600, ids(6000), "2026-11-10T15:31:04.000Z"));
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service.role.key";
});

afterEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of [
    ["CRON_SECRET", ORIG_ENV.CRON_SECRET],
    ["NEXT_PUBLIC_SUPABASE_URL", ORIG_ENV.URL],
    ["SUPABASE_SERVICE_ROLE_KEY", ORIG_ENV.KEY],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET auth + env guards", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(h.fetchContractSources).not.toHaveBeenCalled();
  });

  it("returns 401 for a missing or wrong token and fetches nothing", async () => {
    const GET = await loadGET();
    expect((await GET(makeReq(undefined))).status).toBe(401);
    expect((await GET(makeReq("X".repeat(`Bearer ${SECRET}`.length)))).status).toBe(401);
    expect(h.fetchContractSources).not.toHaveBeenCalled();
  });

  it("returns 500 when the service-role env vars are absent", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/misconfiguration/i);
  });
});

describe("GET source guards (nothing written)", () => {
  it("answers 502 when the sources can't be fetched", async () => {
    h.fetchContractSources.mockRejectedValue(new Error("github 503"));
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    expect(fake.upserts).toHaveLength(0);
  });

  it("answers 502 when the parquet has too few active contracts (a truncated file)", async () => {
    h.fetchContractSources.mockResolvedValue(sources(200, ids(6000)));
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    expect((await res.json()).activeInFile).toBe(200);
    expect(fake.upserts).toHaveLength(0);
  });

  it("answers 502 when the crosswalk is too small (would blank every sleeper_id)", async () => {
    h.fetchContractSources.mockResolvedValue(sources(1600, ids(100)));
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    expect((await res.json()).idMappings).toBe(100);
    expect(fake.upserts).toHaveLength(0);
  });
});

describe("GET refresh", () => {
  it("upserts every kept player in batches of 500 on otc_id, released players included as inactive", async () => {
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true, rows: 1601, rowsWritten: 1601, failedBatches: 0, active: 1600,
      activeSkill: 800, activeSkillWithSleeperId: 800, sourceUpdatedAt: "2026-11-10T15:31:04.000Z",
    });
    expect(fake.upserts.map((u) => u.batch.length)).toEqual([500, 500, 500, 101]);
    expect(fake.upserts.every((u) => (u.opts as { onConflict: string }).onConflict === "otc_id")).toBe(true);

    const all = fake.upserts.flatMap((u) => u.batch) as { otc_id: number; is_active: boolean; sleeper_id: string | null; seasons: unknown[] }[];
    const released = all.find((r) => r.otc_id === 1601)!;
    expect(released.is_active).toBe(false);
    expect(released.sleeper_id).toBeNull();
    expect(all.find((r) => r.otc_id === 1)).toMatchObject({ sleeper_id: "s1", seasons: [expect.objectContaining({ year: 2025 })] });
  });

  it("counts unmatched skill players", async () => {
    // 18,000 ids mapping every third → 6,000 mappings, past the crosswalk floor.
    h.fetchContractSources.mockResolvedValue(sources(1600, ids(18000, 3)));
    const body = await (await (await loadGET())(makeReq(`Bearer ${SECRET}`))).json();
    // WRs are the odd ids; every third id is mapped → odd multiples of 3 up to 1600.
    expect(body.activeSkillWithSleeperId).toBe(267);
  });

  it("keeps going past a failed batch and answers 500 with ok:false", async () => {
    fake.failBatch = 1;
    const res = await (await loadGET())(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, failedBatches: 1, rowsWritten: 1101 });
    expect(fake.upserts).toHaveLength(4);
  });
});
