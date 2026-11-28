// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import type { SleeperLeague } from "@/lib/types";
import type { NflSeasonLinesState } from "@/hooks/useNflSeasonLines";
import type { LinePos, SeasonLine } from "@/lib/helpers/nflSeasonLines";
import type { DraftBoardProspect } from "@/lib/helpers/draftBoard";

// Stage 2 of the 2026-11-27 positional value plan: the Rookie Big Board's
// league picker re-sorts the board by OVR place → the user's Pick Values ×
// the league's multiplier for each position (League Formats' numbers).

const h = vi.hoisted(() => ({
  state: null as unknown as NflSeasonLinesState,
  enabled: [] as boolean[],
  prospects: [] as unknown[],
  pickFcValues: {} as Record<string, number>,
  selectedLeague: null as unknown,
}));

vi.mock("@/hooks/useNflSeasonLines", () => ({
  useNflSeasonLines: (enabled = true) => { h.enabled.push(enabled); return enabled ? h.state : { ...h.state, lines: null }; },
}));
vi.mock("@/lib/supabaseclient", () => {
  // prospects: select().eq().eq().in() resolves to the rows; rookie_board_tiers: …maybeSingle() to no notes.
  interface Chain extends PromiseLike<{ data: unknown; error: null }> {
    select(): Chain; eq(): Chain; in(): Chain; maybeSingle(): Promise<{ data: null; error: null }>;
  }
  const chain = {} as Chain;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (ok, bad) => Promise.resolve({ data: [...h.prospects], error: null }).then(ok, bad);
  return { supabase: { from: () => chain } };
});
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ supabaseUser: { id: "u1" } }) }));
vi.mock("@/lib/fcValuesStore", () => ({ getFcValuesRaw: () => Promise.resolve([]) }));
vi.mock("@/hooks/useDraftBoardClass", () => ({ useDraftBoardClass: () => ({ classYear: 2027, ready: true }) }));
vi.mock("@/lib/ValuesContext", () => ({ useValues: () => ({ pickFcValues: h.pickFcValues }) }));
vi.mock("@/lib/LeagueContext", () => ({ useLeague: () => ({ selectedLeague: h.selectedLeague }) }));

import RookieBigBoard from "@/components/draftHub/RookieBigBoard";
import { leagueFormat } from "@/lib/helpers/leagueFormat";
import { homeFormat, leagueValues } from "@/lib/helpers/positionalValue";
import { leagueOrder, pickValueCurve } from "@/lib/helpers/leagueBoard";

afterEach(cleanup);

const SF = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "BN"];
const league = (id: string, name: string, scoring: Record<string, number>): SleeperLeague =>
  ({
    league_id: id, name, season: "2026", season_type: "regular", status: "in_season", sport: "nfl", total_rosters: 12,
    roster_positions: SF, scoring_settings: scoring, avatar: null, draft_id: null, previous_league_id: null,
    settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, type: 2, draft_rounds: 4 },
  }) as SleeperLeague;
const YARDS = { pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, rec_td: 6 };
const LEAGUES = [
  league("1", "Alpha Dynasty", { ...YARDS, rec: 1, bonus_rec_te: 0.5, pass_td: 4 }),
  league("2", "Beta Dynasty", { ...YARDS, rec: 1, bonus_rec_te: 0.5, pass_td: 4 }),
  league("3", "Gamma TEP", { ...YARDS, rec: 1, bonus_rec_te: 1.5, pass_td: 4 }),
];

const line = (season: number, pos: LinePos, stats: Record<string, number>): SeasonLine => ({ season, pos, games: 16, stats });
const LINES: SeasonLine[] = [2024, 2025].flatMap((season) => [
  ...Array.from({ length: 30 }, (_, i) => line(season, "QB", { pass_td: 40 - i, pass_yd: 4500 - 60 * i })),
  ...Array.from({ length: 50 }, (_, i) => line(season, "RB", { rush_yd: 1600 - 25 * i, rec: 60 - i, rec_yd: 450 - 5 * i })),
  ...Array.from({ length: 70 }, (_, i) => line(season, "WR", { rec: 115 - i, rec_yd: 1500 - 17 * i, rec_td: 10 - i / 10 })),
  ...Array.from({ length: 35 }, (_, i) => line(season, "TE", { rec: 95 - 2 * i, rec_yd: 1100 - 25 * i, rec_td: 8 - i / 5 })),
]);

const PRICES = [7900, 6400, 5300, 5000, 4600, 4300, 3800, 3300, 3000, 2800, 2600, 2400];
const scores = (dynasty: number) => ({
  dynasty, plus: null, sample: { n: 300, share: 1, tier: "full" as const },
  weights: { age: 1, size: 1, draft: 1 }, saved_at: "2026-11-27T12:00:00Z",
});
const prospect = (id: string, position: string, rank: number | null, dynasty: number): DraftBoardProspect => ({
  id, name: id, position, school: "State", draft_class_year: 2027, overall_rank: rank,
  draft_round: null, draft_pick: null, draft_team: null, board_scores: scores(dynasty),
});
const PROSPECTS = [
  prospect("Wr One", "WR", 1, 2.6), prospect("Rb One", "RB", 2, 2.3), prospect("Wr Two", "WR", 3, 2.1),
  prospect("Qb One", "QB", 4, 1.9), prospect("Wr Three", "WR", 5, 1.6), prospect("Te One", "TE", 6, 1.4),
  prospect("Te Two", "TE", 7, 1.2), prospect("Rb Late", "RB", null, 0.4),
];

function Harness() {
  const [id, setId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  return (
    <RookieBigBoard nflState={null} draftedPlayerIds={new Set()} rookieSearch={search} setRookieSearch={setSearch}
      onOpenScouting={() => {}} leagues={LEAGUES} leagueViewId={id} setLeagueViewId={setId} />
  );
}

const shownNames = (container: HTMLElement) =>
  [...container.querySelectorAll("span.font-medium.truncate")].map((el) => el.textContent);

beforeEach(() => {
  h.state = { lines: LINES, seasons: [2024, 2025], error: null, retry: vi.fn() };
  h.enabled.length = 0;
  h.prospects = PROSPECTS;
  h.pickFcValues = Object.fromEntries(PRICES.map((v, i) => [`2027-1.${String(i + 1).padStart(2, "0")}`, v]));
  h.selectedLeague = LEAGUES[0];
});

describe("RookieBigBoard league picker", () => {
  it("shows OVR order with tier dividers until a league is picked, and loads no seasons before then", async () => {
    const { container } = render(<Harness />);
    await screen.findByText("Wr One");
    expect(shownNames(container)).toEqual(PROSPECTS.map((p) => p.id));
    expect(screen.getByText("OVR")).toBeTruthy();
    expect(screen.getAllByText(/^Tier \d/).length).toBeGreaterThan(0);
    expect(h.enabled.every((e) => !e)).toBe(true);
    const picker = screen.getByLabelText("Order for") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Your usual format (OVR)", "Alpha Dynasty", "Beta Dynasty", "Gamma TEP"]);
  });

  it("re-sorts by the league's numbers on the user's pick values, with the move and its math", async () => {
    const { container } = render(<Harness />);
    await screen.findByText("Wr One");
    fireEvent.change(screen.getByLabelText("Order for"), { target: { value: "3" } });

    // The order the helpers give for Gamma TEP against the usual format.
    const formats = LEAGUES.map(leagueFormat);
    const { byLeague } = leagueValues(LINES, formats, homeFormat(formats)!);
    const mult = byLeague.get("3")!.mult;
    expect(mult.TE!).toBeGreaterThan(1.05);
    const ranked = PROSPECTS.filter((p) => p.overall_rank != null);
    const { order } = leagueOrder(ranked, (p) => p.position, mult, pickValueCurve(h.pickFcValues, 2027)!);
    const expected = [...order.map((p) => p.id), "Rb Late"];
    await waitFor(() => expect(shownNames(container)).toEqual(expected));
    expect(expected.indexOf("Te One")).toBeLessThan(5);

    // The two league columns replace OVR; tier dividers go (the T column stays).
    expect(screen.queryByText("OVR")).toBeNull();
    expect(screen.getByText("#")).toBeTruthy();
    expect(screen.getByText("±")).toBeTruthy();
    expect(screen.queryAllByText(/^Tier \d/)).toHaveLength(0);
    expect(screen.getAllByText(/^T\d$/).length).toBeGreaterThan(0);

    const teRow = screen.getByText("Te One").closest("div.grid") as HTMLElement;
    // The ± cell (sm and up) and the mark under the place (a phone): CSS shows one at a time.
    const [upPhone, up] = within(teRow).getAllByLabelText(/^Up \d+ from OVR 6$/);
    expect(upPhone.textContent).toBe(up.textContent);
    expect(upPhone.getAttribute("title")).toBe(up.getAttribute("title"));
    expect(up.getAttribute("title")).toMatch(/^OVR 6 → your 2027 1\.06 \(4,300\) × TE ×\d\.\d\d = [\d,]+ → \d in Gamma TEP \(up \d+\)\.$/);
    // Same-position order holds.
    expect(expected.indexOf("Te One")).toBeLessThan(expected.indexOf("Te Two"));
    expect(expected.indexOf("Wr One")).toBeLessThan(expected.indexOf("Wr Two"));

    // What it rests on, and where TAKEN comes from.
    expect(screen.getByText(/^QB ×\d\.\d\d · RB ×\d\.\d\d · WR ×\d\.\d\d · TE ×\d\.\d\d$/)).toBeTruthy();
    expect(screen.getByText(/TAKEN marks are from Alpha Dynasty's draft/)).toBeTruthy();
    expect(screen.getByText(/Gamma TEP's order: OVR × positional value/)).toBeTruthy();
    expect(h.enabled).toContain(true);

    // Back to OVR.
    fireEvent.change(screen.getByLabelText("Order for"), { target: { value: "" } });
    expect(shownNames(container)).toEqual(PROSPECTS.map((p) => p.id));
  });

  it("stays in OVR order, saying why, while the seasons load, when they fail, or with no pick values", async () => {
    h.state = { lines: null, seasons: [2024, 2025], error: null, retry: vi.fn() };
    const first = render(<Harness />);
    await screen.findByText("Wr One");
    fireEvent.change(screen.getByLabelText("Order for"), { target: { value: "3" } });
    expect(screen.getByText(/Reading the 2024–2025 NFL seasons for Gamma TEP's numbers/)).toBeTruthy();
    expect(shownNames(first.container)).toEqual(PROSPECTS.map((p) => p.id));
    first.unmount();

    const retry = vi.fn();
    h.state = { lines: null, seasons: [2024, 2025], error: "The NFL season stats couldn't be loaded.", retry };
    render(<Harness />);
    await screen.findByText("Wr One");
    fireEvent.change(screen.getByLabelText("Order for"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();

    h.state = { lines: LINES, seasons: [2024, 2025], error: null, retry: vi.fn() };
    h.pickFcValues = {};
    const last = render(<Harness />);
    await screen.findByText("Wr One");
    fireEvent.change(screen.getByLabelText("Order for"), { target: { value: "3" } });
    expect(screen.getByText(/No pick values for this class yet/)).toBeTruthy();
    expect(shownNames(last.container)).toEqual(PROSPECTS.map((p) => p.id));
  });
});
