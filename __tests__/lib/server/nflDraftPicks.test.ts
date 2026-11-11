// @vitest-environment node
// fetchDraftCapital: one cached MediaWiki read per draft year, a missing page
// as null, and Wikipedia's errors thrown (never parsed as an empty draft).

import { describe, it, expect, vi } from "vitest";
import { fetchDraftCapital, fetchDraftPage, draftPageApiUrl, DRAFT_PAGE_REVALIDATE_S } from "@/lib/server/nflDraftPicks";

const PAGE = [
  "==Trades involving draft picks==",
  "===Round 1===",
  "*'''Green Bay → Dallas (PD).''' Green Bay traded a first-round selection to Dallas.",
  "==References==",
].join("\n");

const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("draftPageApiUrl", () => {
  it("asks the MediaWiki API for the page's wikitext and revision", () => {
    const url = new URL(draftPageApiUrl(2027));
    expect(url.origin + url.pathname).toBe("https://en.wikipedia.org/w/api.php");
    expect(url.searchParams.get("page")).toBe("2027_NFL_draft");
    expect(url.searchParams.get("prop")).toBe("wikitext|revid");
    expect(url.searchParams.get("redirects")).toBe("1");
  });
});

describe("fetchDraftPage", () => {
  it("reads through the Data Cache for a day with a descriptive User-Agent", async () => {
    const fetchFn = answer({ parse: { revid: 7, wikitext: PAGE } });
    expect(await fetchDraftPage(2027, fetchFn)).toEqual({ year: 2027, revid: 7, wikitext: PAGE });
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(init.next?.revalidate).toBe(DRAFT_PAGE_REVALIDATE_S);
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/draft/);
  });

  it("returns null for a year with no page yet", async () => {
    expect(await fetchDraftPage(2031, answer({ error: { code: "missingtitle", info: "The page you specified doesn't exist." } }))).toBeNull();
  });

  it("throws on any other error, a bad status, or no wikitext", async () => {
    await expect(fetchDraftPage(2027, answer({ error: { code: "ratelimited", info: "slow down" } }))).rejects.toThrow(/ratelimited/);
    await expect(fetchDraftPage(2027, answer({}, 503))).rejects.toThrow(/503/);
    await expect(fetchDraftPage(2027, answer({ parse: { revid: 1 } }))).rejects.toThrow(/no wikitext/);
  });
});

describe("fetchDraftCapital", () => {
  it("parses the page into every team's picks", async () => {
    const cap = await fetchDraftCapital(2027, answer({ parse: { revid: 9, wikitext: PAGE } }));
    expect(cap?.revid).toBe(9);
    expect(cap?.tradedPicks).toBe(1);
    expect(cap?.teams.find((t) => t.teamId === 6)?.byRound[0]).toBe(2);
    expect(cap?.teams.find((t) => t.teamId === 9)?.byRound[0]).toBe(0);
  });

  it("is null when the page doesn't exist", async () => {
    expect(await fetchDraftCapital(2031, answer({ error: { code: "missingtitle" } }))).toBeNull();
  });
});
