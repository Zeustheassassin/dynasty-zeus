// nflDraftPicks: Wikipedia's "2027 NFL draft" trades section (the real page,
// saved 2026-11-11) → every team's picks, with the page's own inconsistencies
// flagged instead of guessed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  wikiTeamId, plainText, tradesSection, isConditionalPick, parseDraftTrades, draftCapital, pickKey, dayOfRound,
  DRAFT_ROUNDS, DRAFT_PICK_RESOLUTIONS,
} from "@/lib/nflDraftPicks";

const PAGE_2027 = readFileSync(join(process.cwd(), "__tests__/fixtures/wikipedia-2027-nfl-draft-trades-2026-11-11.txt"), "utf8");

const T = { ATL: 1, CHI: 3, CLE: 5, DAL: 6, DET: 8, GB: 9, TEN: 10, IND: 11, KC: 12, LAR: 14, MIA: 15, MIN: 16, NYJ: 20, NYG: 19, PHI: 21, ARI: 22, PIT: 23, LAC: 24, SF: 25, SEA: 26, WAS: 28, CAR: 29, JAX: 30, BAL: 33, HOU: 34, LV: 13 } as const;

describe("wikiTeamId", () => {
  it("reads the page's city names, its NY / LA shorthands, and falls back to nicknames", () => {
    expect(wikiTeamId("NY Jets")).toBe(T.NYJ);
    expect(wikiTeamId("the NY Giants")).toBe(T.NYG);
    expect(wikiTeamId("LA Rams")).toBe(T.LAR);
    expect(wikiTeamId("LA Chargers")).toBe(T.LAC);
    expect(wikiTeamId("Green Bay")).toBe(T.GB);
    expect(wikiTeamId("Las Vegas")).toBe(T.LV);
    expect(wikiTeamId("Washington")).toBe(T.WAS);
    expect(wikiTeamId("Eagles")).toBe(T.PHI);
    expect(wikiTeamId("Gotham")).toBeNull();
  });
});

describe("plainText", () => {
  it("drops refs, templates, link targets and bold marks", () => {
    const raw = "{{Anchor|X}}'''Dallas → Pittsburgh (PD).''' Dallas traded a pick for T [[Broderick Jones]] and DT [[Kenny Clark (defensive tackle)|Kenny Clark]].<ref group=Trade>{{cite web|title=x}}</ref>";
    expect(plainText(raw)).toBe("Dallas → Pittsburgh (PD). Dallas traded a pick for T Broderick Jones and DT Kenny Clark.");
  });
});

describe("tradesSection", () => {
  it("ends at the next real level-2 heading, not one inside a comment", () => {
    const page = "intro\n==Trades involving draft picks==\n===Round 1===\n*'''Dallas → NY Jets (PD).''' x\n<!--\n==Forfeited picks==\n-->\n*'''Seattle → Detroit (PD).''' y\n==References==\n*'''Miami → Buffalo (PD).''' z";
    const s = tradesSection(page);
    expect(s).toContain("Seattle → Detroit");
    expect(s).not.toContain("Miami → Buffalo");
    expect(s).not.toContain("Forfeited");
  });

  it("takes the text as given when there's no such heading (a section-only fetch)", () => {
    expect(tradesSection("===Round 1===\n*x")).toBe("===Round 1===\n*x");
  });
});

describe("isConditionalPick", () => {
  it("flags a condition on this round's pick, with no year or this year", () => {
    expect(isConditionalPick("Dallas traded a conditional sixth-round selection and a 2028 second-round selection", 6, 2027)).toBe(true);
    expect(isConditionalPick("traded a conditional 2027 seventh-round selection", 7, 2027)).toBe(true);
  });

  it("ignores a condition on another pick of the same trade", () => {
    // 2027 round 4, Minnesota → Carolina: the conditional pick is a 2026 seventh.
    expect(isConditionalPick("in exchange for a fifth-round selection, a conditional 2026 seventh-round selection and WR Adam Thielen", 4, 2027)).toBe(false);
    // 2028 round 2, Dallas → Pittsburgh: the conditional pick is the 2027 sixth.
    expect(isConditionalPick("Dallas traded a second-round selection and a 2027 conditional sixth-round selection", 2, 2028)).toBe(false);
    expect(isConditionalPick("a conditional seventh-round selection", 6, 2027)).toBe(false);
  });

  it("flags a 'whichever is earlier' pick", () => {
    expect(isConditionalPick("New York will receive whichever is earlier of Dallas' original selection or the selection they acquired from Green Bay.", 1, 2027)).toBe(true);
  });
});

describe("parseDraftTrades (2027 page, 2026-11-11)", () => {
  const parse = parseDraftTrades(PAGE_2027, 2027);

  it("reads every traded-pick bullet", () => {
    expect(parse.trades).toHaveLength(81);
    expect(parse.unparsed).toEqual([]);
    expect(parse.trades.filter((t) => t.round === 1)).toHaveLength(6);
  });

  it("reads a multi-trade path from the header, original first", () => {
    const multi = parse.trades.find((t) => t.round === 6 && t.chain[0] === T.BAL);
    expect(multi?.chain).toEqual([T.BAL, T.SF, T.IND]);
    expect(multi?.text).toContain("Keenan Allen");
  });

  it("uses the trade a 'See Round' bullet points at", () => {
    const see = parse.trades.find((t) => t.round === 4 && t.chain[0] === T.PIT);
    expect(see?.chain).toEqual([T.PIT, T.DAL]);
    expect(see?.text).toContain("Dallas traded third- and sixth-round selections to Pittsburgh");
  });

  it("flags only picks that carry their own condition", () => {
    const conditional = parse.trades.filter((t) => t.conditional).map((t) => `${t.round}:${t.chain[0]}`).sort();
    expect(conditional).toEqual([`1:${T.DAL}`, `6:${T.DAL}`, `7:${T.ATL}`, `7:${T.LAC}`, `7:${T.NYG}`].sort());
  });

  it("puts an unknown team in unparsed instead of guessing", () => {
    const p = parseDraftTrades("===Round 2===\n*'''Gotham → Dallas (PD).''' x", 2027);
    expect(p.trades).toEqual([]);
    expect(p.unparsed).toEqual(["Gotham → Dallas (PD). x"]);
  });
});

describe("draftCapital (2027 page, 2026-11-11)", () => {
  const cap = draftCapital(parseDraftTrades(PAGE_2027, 2027));
  const team = (id: number) => cap.teams.find((t) => t.teamId === id)!;

  it("accounts for all 224 picks, one owner each", () => {
    expect(cap.teams).toHaveLength(32);
    expect(cap.teams.reduce((s, t) => s + t.picks.length, 0)).toBe(32 * DRAFT_ROUNDS);
    for (const t of cap.teams) expect(t.byDay.reduce((a, b) => a + b, 0)).toBe(t.picks.length);
  });

  it("moves round-1 picks: the Jets hold three, Dallas the Packers' 1st, Green Bay none", () => {
    expect(team(T.NYJ).byRound[0]).toBe(3);
    expect(team(T.NYJ).picks.filter((p) => p.round === 1).map((p) => p.original).sort((a, b) => a - b)).toEqual([T.DAL, T.IND, T.NYJ]);
    expect(team(T.DAL).picks.filter((p) => p.round === 1).map((p) => p.original)).toEqual([T.GB]);
    expect(team(T.GB).byRound[0]).toBe(0);
    expect(team(T.TEN).byDay).toEqual([2, 3, 4]);
  });

  it("keeps a team's own pick when it was never traded", () => {
    const own = team(T.WAS).picks.find((p) => p.round === 1)!;
    expect(own).toMatchObject({ original: T.WAS, owner: T.WAS, via: [T.WAS], trade: null, conditional: false, relabeled: false });
  });

  // The user's 2027 cross-check (2026-11-11). Replaying the page's moves gives every answer on its own.
  const pick = (round: number, original: number) => cap.teams.flatMap((t) => t.picks).find((p) => p.round === round && p.original === original)!;
  it.each([
    // The page writes Minnesota → New England for the second hop: Minnesota's own 7th had gone to the Jets.
    ["Philadelphia's 7th → New England, via Minnesota", 7, T.PHI, 17, [T.PHI, T.MIN, 17], true],
    ["Houston's 7th → Cleveland", 7, T.HOU, T.CLE, [T.HOU, T.CLE], false],
    ["Philadelphia's 6th → Jets", 6, T.PHI, T.NYJ, [T.PHI, T.NYJ], false],
    ["Kansas City's 7th → 49ers", 7, T.KC, T.SF, [T.KC, T.SF], false],
    ["Minnesota's 7th → Jets", 7, T.MIN, T.NYJ, [T.MIN, T.NYJ], false],
    ["Dallas's 6th → Pittsburgh", 6, T.DAL, T.PIT, [T.DAL, T.PIT], false],
  ])("matches the user's list: %s", (_, round, original, owner, via, relabeled) => {
    expect(pick(round, original)).toMatchObject({ owner, via, relabeled });
  });

  it("sends an acquired pick when the page names one already gone (counts right: Houston 0 7ths, Philadelphia 1)", () => {
    // Houston's own 7th went to Cleveland first, so its Detroit and Dallas trades sent the 7ths it had acquired.
    expect(pick(7, T.LAC)).toMatchObject({ owner: T.DET, via: [T.LAC, T.HOU, T.DET], relabeled: true });
    expect(pick(7, 17)).toMatchObject({ owner: T.DAL, via: [17, T.HOU, T.DAL], relabeled: true });
    expect(team(T.HOU).byRound[6]).toBe(0);
    expect(team(T.PHI).byRound[6]).toBe(1);
    expect(team(T.MIN).byRound[6]).toBe(0);
    expect(team(T.KC).byRound[6]).toBe(0);
    // Dallas sent two 6ths to Pittsburgh: its own, and Pittsburgh's back. Green Bay's 6th came back the same way.
    expect(pick(6, T.PIT)).toMatchObject({ owner: T.PIT, via: [T.PIT, T.DAL, T.PIT], relabeled: true });
    expect(team(T.PIT).byRound[5]).toBe(2);
    expect(team(T.DAL).byRound[5]).toBe(0);
    expect(pick(6, T.GB)).toMatchObject({ owner: T.GB, via: [T.GB, T.PHI, T.GB] });
    expect(cap.issues.filter((i) => i.kind === "relabeled")).toHaveLength(8);
    expect(cap.issues.filter((i) => i.kind === "short")).toEqual([]);
  });

  it("flags the conditional picks for the user", () => {
    expect(cap.issues.filter((i) => i.kind === "conditional")).toHaveLength(5);
    expect(pick(1, T.DAL)).toMatchObject({ owner: T.NYJ, conditional: true });
  });

  it("holds the user's answers: marked resolved, nothing flagged", () => {
    const withAnswers = draftCapital(parseDraftTrades(PAGE_2027, 2027), DRAFT_PICK_RESOLUTIONS);
    const resolved = withAnswers.teams.flatMap((t) => t.picks).filter((p) => p.resolved);
    expect(resolved).toHaveLength(6);
    expect(withAnswers.issues.some((i) => i.kind === "resolution")).toBe(false);
    expect(withAnswers.teams.map((t) => t.byRound)).toEqual(cap.teams.map((t) => t.byRound));
  });

  it("an answer that disagrees swaps with a relabeled pick (counts unchanged), or is flagged if there's none", () => {
    const swapped = draftCapital(parseDraftTrades(PAGE_2027, 2027), { [pickKey(2027, 7, T.HOU)]: T.DET });
    const all = swapped.teams.flatMap((t) => t.picks);
    expect(all.find((p) => p.round === 7 && p.original === T.HOU)).toMatchObject({ owner: T.DET, resolved: true });
    expect(all.find((p) => p.round === 7 && p.original === T.LAC)).toMatchObject({ owner: T.CLE });
    expect(swapped.teams.map((t) => t.byRound)).toEqual(cap.teams.map((t) => t.byRound));

    const stale = draftCapital(parseDraftTrades(PAGE_2027, 2027), { [pickKey(2027, 7, T.HOU)]: T.SEA });
    expect(stale.issues.filter((i) => i.kind === "resolution")).toMatchObject([{ round: 7, original: T.HOU, owners: [T.SEA] }]);
    expect(stale.teams.flatMap((t) => t.picks).find((p) => p.round === 7 && p.original === T.HOU)).toMatchObject({ owner: T.CLE, resolved: false });
  });

  it("flags a move whose sender holds no pick that round, and doesn't apply it", () => {
    const c = draftCapital(parseDraftTrades([
      "===Round 6===",
      "*'''Jacksonville → Miami (PD).''' Jacksonville traded a sixth-round selection to Miami.",
      "*'''Jacksonville → New Orleans (PD).''' Jacksonville traded a conditional sixth-round selection to New Orleans.",
    ].join("\n"), 2028));
    expect(c.issues.filter((i) => i.kind === "short")).toMatchObject([{ round: 6, original: T.JAX, owners: [18] }]);
    expect(c.teams.find((t) => t.teamId === T.MIA)!.byRound[5]).toBe(2);
    expect(c.teams.find((t) => t.teamId === 18)!.byRound[5]).toBe(1);
  });

  it("counts an exact repeat of one bullet once, with no flag", () => {
    const bullet = "*'''Seattle → Detroit (PD).''' Seattle traded a fifth-round selection to Detroit for a player.";
    const c = draftCapital(parseDraftTrades(`===Round 5===\n${bullet}\n${bullet}`, 2027));
    expect(c.issues).toEqual([]);
    expect(c.teams.find((t) => t.teamId === T.DET)!.byRound[4]).toBe(2);
    expect(c.teams.find((t) => t.teamId === T.SEA)!.byRound[4]).toBe(0);
  });
});

describe("dayOfRound", () => {
  it("day 1 = round 1, day 2 = rounds 2–3, day 3 = rounds 4–7", () => {
    expect([1, 2, 3, 4, 7].map(dayOfRound)).toEqual([1, 2, 2, 3, 3]);
  });
});
