import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The public /board/{token} page's read (migration 105): one row through
// get_shared_big_board with the anon key, never a user id.

const h = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));

const TOKEN = "0123456789abcdef0123456789abcdef";

async function load() {
  vi.resetModules();
  return import("@/lib/server/sharedBoard");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createClient.mockImplementation(() => ({ rpc: h.rpc }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("loadSharedBoard", () => {
  it("reads the token's board with the anon key and checks the rows", async () => {
    h.rpc.mockResolvedValue({
      data: [{ class_year: 2027, updated_at: "2026-11-25T18:00:00Z", rows: [{ name: "A", ovr: 1, pos: "WR" }, { ovr: 2 }] }],
      error: null,
    });
    const { loadSharedBoard } = await load();
    const r = await loadSharedBoard(TOKEN);
    expect(h.createClient).toHaveBeenCalledWith("https://test.supabase.co", "anon-key", expect.anything());
    expect(h.rpc).toHaveBeenCalledWith("get_shared_big_board", { p_token: TOKEN });
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.board.classYear).toBe(2027);
    expect(r.board.rows.map((x) => x.name)).toEqual(["A"]);
  });

  it("a malformed token never reaches the database", async () => {
    const { loadSharedBoard } = await load();
    expect(await loadSharedBoard("../../etc")).toEqual({ status: "missing" });
    expect(await loadSharedBoard(TOKEN.toUpperCase())).toEqual({ status: "missing" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("an unknown token, or migration 105 not applied, reads as not found; anything else as an error", async () => {
    const { loadSharedBoard } = await load();
    h.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadSharedBoard(TOKEN)).toEqual({ status: "missing" });
    const { loadSharedBoard: again } = await load();
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await again(TOKEN)).toEqual({ status: "missing" });
    const { loadSharedBoard: third } = await load();
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "timeout" } });
    expect(await third(TOKEN)).toEqual({ status: "error" });
  });
});
