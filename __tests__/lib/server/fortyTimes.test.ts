// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { COMBINE_CSV_URL, fetchCombinePosition, fetchProjectedPosition, walterFootballUrl } from "@/lib/server/fortyTimes";

const answer = (status: number, body = "") => vi.fn(async () => new Response(body, { status }));

const PAGE = `<div class="panel" id="prpSlot_1"><b>Jadan Baugh*, RB, Florida <br> Height: 6-0. Weight: 228.<br>Projected 40 Time: 4.50.<br></b></div>`;
const CSV = "season,player_name,pos,school,wt,forty\n2026,Jeremiyah Love,RB,Notre Dame,212,4.36\n2026,Carnell Tate,WR,Ohio St.,192,4.53\n";

describe("fetchProjectedPosition", () => {
  it("reads WalterFootball's page for the position and class, cached a day, with its own User-Agent", async () => {
    const f = answer(200, PAGE);
    const rows = await fetchProjectedPosition(2027, "RB", f as unknown as typeof fetch);
    expect(rows).toEqual([{ name: "Jadan Baugh", school: "Florida", position: "RB", forty: 4.5, weight: 228 }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate: number } }];
    expect(url).toBe("https://walterfootball.com/RBRankings2027.php");
    expect(walterFootballUrl("TE", 2028)).toBe("https://walterfootball.com/TERankings2028.php");
    expect(init.next?.revalidate).toBe(86_400);
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^dynastyzeus-forty-reader/);
  });

  it("is empty for a class without a page, and throws on other failures", async () => {
    await expect(fetchProjectedPosition(2030, "QB", answer(404) as unknown as typeof fetch)).resolves.toEqual([]);
    await expect(fetchProjectedPosition(2027, "QB", answer(503) as unknown as typeof fetch)).rejects.toThrow(/WalterFootball answered 503/);
  });
});

describe("fetchCombinePosition", () => {
  it("reads nflverse's combine.csv for the year at the position", async () => {
    const f = answer(200, CSV);
    expect(await fetchCombinePosition(2026, "WR", f as unknown as typeof fetch))
      .toEqual([{ name: "Carnell Tate", school: "Ohio St.", position: "WR", forty: 4.53, weight: 192 }]);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(COMBINE_CSV_URL);
  });

  it("is null while the year's combine isn't in the file, and throws on a failed read", async () => {
    await expect(fetchCombinePosition(2027, "RB", answer(200, CSV) as unknown as typeof fetch)).resolves.toBeNull();
    await expect(fetchCombinePosition(2026, "RB", answer(502) as unknown as typeof fetch)).rejects.toThrow(/combine.csv answered 502/);
  });
});
