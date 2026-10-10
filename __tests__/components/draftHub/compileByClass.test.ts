import { describe, it, expect, vi } from "vitest";
import { compileByClass, type CompileEvent } from "@/components/draftHub/DraftHistory/hooks/compileByClass";

// Sleeper call-budget Stage 2 (2026-10-10): every compile call is paced at 450/min and a recent
// draft class alone is ~4,000 Sleeper calls, so the panel compiles one class per request (the
// route's 800s limit fits one class, not several) instead of sending every selected year at once.

const ndjson = (events: object[], status = 200) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { status });

function classStream(year: number) {
  return ndjson([
    { type: "status", message: `Mapping ${year}…`, progress: 50 },
    { type: "year_done", year, draftCount: 10, leagueCount: 9, playerCount: 40, connectedUserCount: 5 },
    { type: "done", message: "Compilation complete!", progress: 100 },
  ]);
}

function harness(respond: (year: number) => Response) {
  const requests: number[][] = [];
  const logs: string[] = [];
  const progress: number[] = [];
  const yearsDone: CompileEvent[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { years: number[]; accessToken: string };
    requests.push(body.years);
    return respond(body.years[0]);
  }) as unknown as typeof fetch;
  return {
    requests, logs, progress, yearsDone,
    run: (years: number[], token: string | null = "tok") =>
      compileByClass({
        years,
        sleeperUserId: "200",
        getAccessToken: async () => token,
        onLog: (m) => logs.push(m),
        onProgress: (p) => progress.push(p),
        onYearDone: (e) => yearsDone.push(e),
        fetchImpl,
      }),
  };
}

describe("compileByClass", () => {
  it("sends one class per request, oldest first", async () => {
    const h = harness(classStream);
    await h.run([2026, 2024, 2025]);

    expect(h.requests).toEqual([[2024], [2025], [2026]]);
    expect(h.yearsDone.map((e) => e.year)).toEqual([2024, 2025, 2026]);
    expect(h.logs.at(-1)).toBe("Compilation complete!");
    expect(h.logs).toContain("2024 (1/3): Mapping 2024…");
    expect(h.logs).toContain("2024 (1/3): done.");
  });

  it("reports progress across every class, not per request", async () => {
    const h = harness(classStream);
    await h.run([2024, 2025]);
    // 2024 at 50% → 25 overall; 2024 done → 50; 2025 at 50% → 75; 2025 done → 100.
    expect(h.progress).toEqual([25, 50, 75, 100]);
  });

  it("stops at the compile rate limit and names the classes still to do", async () => {
    const h = harness((year) => (year === 2025 ? new Response("", { status: 429 }) : classStream(year)));
    await h.run([2024, 2025, 2026]);

    expect(h.requests).toEqual([[2024], [2025]]);
    expect(h.yearsDone.map((e) => e.year)).toEqual([2024]);
    expect(h.logs.at(-1)).toMatch(/limit reached.*compile 2025, 2026/);
  });

  it("stops without a request when there's no session", async () => {
    const h = harness(classStream);
    await h.run([2024], null);
    expect(h.requests).toEqual([]);
    expect(h.logs.at(-1)).toMatch(/log in again, then compile 2024/);
  });

  it("a single class keeps the route's own messages unprefixed", async () => {
    const h = harness(classStream);
    await h.run([2025]);
    expect(h.logs).toEqual(["Mapping 2025…", "Compilation complete!"]);
  });
});
