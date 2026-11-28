// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup } from "@testing-library/react";
import type { RookieBoardPlayer, SleeperLeague } from "@/lib/types";
import type { NflSeasonLinesState } from "@/hooks/useNflSeasonLines";
import type { LinePos, SeasonLine } from "@/lib/helpers/nflSeasonLines";
import type { DraftBoardProspect } from "@/lib/helpers/draftBoard";

// Stage 3 of the 2026-11-27 positional value plan: the live draft reads the
// drafting league's view of the user's board (the Rookie Big Board's "Order
// for" order) for Top Available, the user's own predicted slots and the slot
// picker; OVR until it can.

const h = vi.hoisted(() => ({
  state: null as unknown as NflSeasonLinesState,
  enabled: [] as boolean[],
}));

vi.mock("@/hooks/useNflSeasonLines", () => ({
  useNflSeasonLines: (enabled = true) => { h.enabled.push(enabled); return enabled ? h.state : { ...h.state, lines: null }; },
}));
vi.mock("@/lib/PlayersContext", () => ({ usePlayers: () => ({}) }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ supabaseUser: null }) }));
vi.mock("@/lib/LeagueContext", () => ({
  useLeague: () => ({ selectedLeague: { league_id: "3", name: "Gamma TEP" }, rosters: [], users: {} }),
}));
vi.mock("@/lib/supabaseclient", () => ({ supabase: { from: vi.fn() } }));

import { useLiveDraftLeagueOrder, type LiveDraftOrderView } from "@/hooks/useLiveDraftLeagueOrder";
import LiveDraftBoard from "@/components/draftHub/LiveDraftBoard";
import { draftBoardRookies, unionRookies } from "@/lib/helpers/draftBoard";
import { leagueFormat } from "@/lib/helpers/leagueFormat";
import { homeFormat, leagueValues } from "@/lib/helpers/positionalValue";
import { leagueBoardRows, leaguePlaceTitle, pickValueCurve } from "@/lib/helpers/leagueBoard";

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
const PICK_VALUES = Object.fromEntries(PRICES.map((v, i) => [`2027-1.${String(i + 1).padStart(2, "0")}`, v]));
// Dynasty+ runs in another order (projected capital), so the test can tell which score the order read.
const prospect = (id: string, position: string, rank: number | null, dynasty: number, plus: number): DraftBoardProspect => ({
  id, name: id, position, school: "State", draft_class_year: 2027, overall_rank: rank,
  draft_round: null, draft_pick: null, draft_team: null,
  board_scores: {
    dynasty, plus, plus_projected: true, sample: { n: 300, share: 1, tier: "full" },
    weights: { age: 1, size: 1, draft: 2 }, saved_at: "2026-11-27T12:00:00Z",
  },
});
// In OVR order (= Dynasty order), as useDraftBoardProspects gives it.
const PROSPECTS = [
  prospect("Wr One", "WR", 1, 2.6, 2.0), prospect("Rb One", "RB", 2, 2.3, 3.1), prospect("Wr Two", "WR", 3, 2.1, 1.0),
  prospect("Qb One", "QB", 4, 1.9, 2.6), prospect("Wr Three", "WR", 5, 1.6, 0.8), prospect("Te One", "TE", 6, 1.4, 0.6),
  prospect("Te Two", "TE", 7, 1.2, 1.9), prospect("Rb Two", "RB", 8, 1.0, 0.5), prospect("Wr Four", "WR", 9, 0.9, 1.4),
  prospect("Qb Two", "QB", 10, 0.7, 0.3), prospect("Rb Three", "RB", 11, 0.5, 1.2), prospect("Wr Five", "WR", 12, 0.3, 0.1),
  prospect("Rb Late", "RB", null, 0.4, 0.2),
];
const dynastyOf = (p: DraftBoardProspect) => p.board_scores?.dynasty;
const plusOf = (p: DraftBoardProspect) => p.board_scores?.plus;
// The market pool: one board prospect Sleeper lists, plus a rookie the board doesn't have.
const POOL: RookieBoardPlayer[] = [
  { player_id: "s-te1", name: "Te One", position: "TE", team: "", adp: 9, fcValue: 2100 },
  { player_id: "s-x", name: "Pool Only", position: "WR", team: "", adp: 20, fcValue: 900 },
];

// What the helpers give for Gamma TEP against the usual format.
function expectedGamma(scoreOf = dynastyOf) {
  const formats = LEAGUES.map(leagueFormat);
  const mult = leagueValues(LINES, formats, homeFormat(formats)!).byLeague.get("3")!.mult;
  return { mult, ...leagueBoardRows(PROSPECTS, scoreOf, mult, pickValueCurve(PICK_VALUES, 2027)!)! };
}

beforeEach(() => {
  h.state = { lines: LINES, seasons: [2024, 2025], error: null, retry: vi.fn() };
  h.enabled.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

const run = (leagueId: string | null, enabled: boolean, pickValues = PICK_VALUES) =>
  renderHook(() => useLiveDraftLeagueOrder(PROSPECTS, LEAGUES, leagueId, pickValues, enabled)).result.current;

describe("useLiveDraftLeagueOrder", () => {
  it("puts the board in the drafting league's order, the same as the Rookie Big Board's Order for", () => {
    const { rows, view } = run("3", true);
    const want = expectedGamma();
    expect(want.mult.TE!).toBeGreaterThan(1.05);
    expect(rows.map((p) => p.id)).toEqual(want.rows.map((p) => p.id));
    expect(rows.map((p) => p.id).indexOf("Te One")).toBeLessThan(5);
    expect(rows[rows.length - 1].id).toBe("Rb Late");
    expect(view.format?.name).toBe("Gamma TEP");
    expect(view.value?.mult).toEqual(want.mult);
    expect(view.curve?.year).toBe(2027);
    expect(view.scoreName).toBe("Dynasty");
    expect(view.rate).toEqual(want.rate);
    // Places by place on the live board; the unranked have none.
    expect(view.places.size).toBe(12);
    rows.slice(0, 12).forEach((p, i) => expect(view.places.get(i + 1)).toEqual(want.places.get(p)));
    expect(h.enabled).toContain(true);
  });

  it("reads Dynasty until the NFL draft is over, then Dynasty+ (from the Sunday the rookie drafts start)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 3, 24, 22, 0));
    expect(run("3", true).view.scoreName).toBe("Dynasty");
    vi.setSystemTime(new Date(2027, 3, 25, 0, 1));
    const after = run("3", true);
    expect(after.view.scoreName).toBe("Dynasty+");
    expect(after.rows.map((p) => p.id)).toEqual(expectedGamma(plusOf).rows.map((p) => p.id));
  });

  it("stays in OVR order and loads no seasons when off (in season, another Draft Hub tab) or with no league", () => {
    const off = run("3", false);
    expect(off.rows).toBe(PROSPECTS);
    expect(off.view.places.size).toBe(0);
    const none = run(null, true);
    expect(none.rows).toBe(PROSPECTS);
    expect(none.view.format).toBeNull();
    expect(h.enabled.every((e) => !e)).toBe(true);
  });

  it("stays in OVR order while the seasons load, when they fail, and with no pick values", () => {
    h.state = { lines: null, seasons: [2024, 2025], error: null, retry: vi.fn() };
    const loading = run("3", true);
    expect(loading.rows).toBe(PROSPECTS);
    expect(loading.view.format?.name).toBe("Gamma TEP");
    expect(loading.view.value).toBeNull();

    h.state = { lines: null, seasons: [2024, 2025], error: "The NFL season stats couldn't be loaded.", retry: vi.fn() };
    expect(run("3", true).rows).toBe(PROSPECTS);

    h.state = { lines: LINES, seasons: [2024, 2025], error: null, retry: vi.fn() };
    const noCurve = run("3", true, {});
    expect(noCurve.rows).toBe(PROSPECTS);
    expect(noCurve.view.value).not.toBeNull();
    expect(noCurve.view.curve).toBeNull();

    // Too few scored places among the priced picks to read what a point is worth.
    const sparse = PROSPECTS.map((p, i) => (i < 8 ? p : { ...p, board_scores: null }));
    const thin = renderHook(() => useLiveDraftLeagueOrder(sparse, LEAGUES, "3", PICK_VALUES, true)).result.current;
    expect(thin.rows).toBe(sparse);
    expect(thin.view.curve).not.toBeNull();
    expect(thin.view.rate).toBeNull();
  });

  it("feeds the live draft's lists: board ranks are league places, the user's slots go down it, then the pool", () => {
    const { rows } = run("3", true);
    const board = draftBoardRookies(rows, POOL);
    expect(board.map((r) => r.boardRank)).toEqual(rows.map((_, i) => i + 1));
    expect(board.find((r) => r.name === "Te One")).toMatchObject({ player_id: "s-te1", fcValue: 2100 });
    const myPickList = unionRookies(board, POOL);
    expect(myPickList.map((r) => r.name)).toEqual([...rows.map((p) => p.name), "Pool Only"]);
  });
});

function renderBoard(view: LiveDraftOrderView, top: RookieBoardPlayer[], withDraft = false) {
  render(
    <LiveDraftBoard
      myDraftSlotPicks={{}} setMyDraftSlotPicks={vi.fn()}
      draftSlotEditing={null} setDraftSlotEditing={vi.fn()}
      draftSlotSearchQuery="" setDraftSlotSearchQuery={vi.fn()}
      user={{ user_id: "me" } as never}
      draftSettings={withDraft ? ({ status: "pre_draft", settings: { rounds: 4 } } as never) : null}
      draftPicks={[]} draftOrder={{}} allPicks={[]}
      boardRookies={top} myPickList={top} draftedPlayerIds={new Set()}
      predictedDraftPicks={{}} draftPoolRanks={{ byPlayerId: {}, byName: {} }} topAvailableRookies={top}
      orderView={view}
      refreshDraftBoard={vi.fn()} loadDraftScout={vi.fn()} loadingDraftRefresh={false}
      dormant={false}
    />,
  );
}

describe("LiveDraftBoard in the drafting league's order", () => {
  it("says which order Top Available is in, and each card's OVR place, move and math", () => {
    const { rows, view } = run("3", true);
    const top = draftBoardRookies(rows, POOL).slice(0, 10);
    renderBoard(view, top, true);

    expect(screen.getByText(/^QB ×\d\.\d\d · RB ×\d\.\d\d · WR ×\d\.\d\d · TE ×\d\.\d\d$/)).toBeTruthy();
    expect(screen.getByText(/^QB [+−]\d\.\d\d · RB [+−]\d\.\d\d · WR [+−]\d\.\d\d · TE \+\d\.\d\d$/)).toBeTruthy();
    expect(screen.getByText(/Gamma TEP's order:/)).toBeTruthy();
    expect(screen.getByText(/\+1\.00 Dynasty is worth ×\d\.\d\d on your 2027 Pick Values/)).toBeTruthy();
    expect(screen.getByText(/everyone else's predictions still\s+read the market/)).toBeTruthy();
    expect(screen.getByText("Your slots: your board in Gamma TEP's order (Top Available below says how)")).toBeTruthy();

    const place = rows.findIndex((p) => p.id === "Te One") + 1;
    const lp = view.places.get(place)!;
    const move = screen.getByLabelText(`Up ${6 - place} from OVR 6`);
    expect(move.textContent).toBe(`OVR 6 ▲${6 - place}`);
    expect(move.getAttribute("title")).toBe(leaguePlaceTitle(lp, "TE", "Dynasty", "Gamma TEP"));
    expect(move.parentElement?.textContent).toBe(`#${place}OVR 6 ▲${6 - place}`);
  });

  it("is the OVR board, saying why, with no league, while loading, on an error (Retry), or with too few scores", () => {
    const top = draftBoardRookies(PROSPECTS, POOL).slice(0, 3);
    const ovr = run(null, true).view;
    renderBoard(ovr, top, true);
    expect(screen.getByText(/Your Rookie Big Board \(Scouting OVR order\)\. Players drop off/)).toBeTruthy();
    expect(screen.queryByText(/OVR \d/)).toBeNull();
    expect(screen.queryByText(/^Your slots:/)).toBeNull();
    cleanup();

    h.state = { lines: null, seasons: [2024, 2025], error: null, retry: vi.fn() };
    renderBoard(run("3", true).view, top);
    expect(screen.getByText(/Reading the 2024–2025 NFL seasons for Gamma TEP's numbers… your board stays in OVR order/)).toBeTruthy();
    cleanup();

    const retry = vi.fn();
    h.state = { lines: null, seasons: [2024, 2025], error: "The NFL season stats couldn't be loaded.", retry };
    renderBoard(run("3", true).view, top);
    expect(screen.getByText(/Your board stays in OVR order here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();

    h.state = { lines: LINES, seasons: [2024, 2025], error: null, retry: vi.fn() };
    const sparse = PROSPECTS.map((p, i) => (i < 8 ? p : { ...p, board_scores: null }));
    renderBoard(renderHook(() => useLiveDraftLeagueOrder(sparse, LEAGUES, "3", PICK_VALUES, true)).result.current.view, top);
    expect(screen.getByText(/Too few of your top 12 have a Dynasty score/)).toBeTruthy();
    expect(screen.queryByText(/OVR \d/)).toBeNull();
  });
});
