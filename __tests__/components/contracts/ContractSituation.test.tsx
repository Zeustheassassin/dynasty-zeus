// The contract surfaces render the situation and send the user's call.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ContractSituationResponse, PlayerSituation, RoomSituation, TeamSituation } from "@/lib/contractSituation";

const setOverride = vi.fn();
let hookState: Record<string, unknown> = {};
vi.mock("@/hooks/useContractSituation", () => ({ useContractSituation: () => hookState }));

import { ContractChips, ContractSituationCard, RoomLine, TradeContractNote } from "@/components/contracts/ContractSituation";

const player = (extra: Partial<PlayerSituation>): PlayerSituation => ({
  otcId: 1, sleeperId: "s1", name: "Josh Jacobs", pos: "RB", teamId: 9, kind: "veteran", endYear: 2027, freeAgency: "UFA",
  apy: 12, capHit: 16.6, capHitEstimated: false, guaranteedThrough: 2026, futureGuaranteed: 0, fifthYearOption: null,
  invested: true, importance: "established", unavailable: true, age: 29.6,
  cut: { level: "likely", score: 3, reasons: ["releasing him in 2027 saves $13.5M for $3.1M dead", "missed most of this season"], savings: 13.5, deadMoney: 3.1 },
  stay: null, core: false, ...extra,
});
const room: RoomSituation = {
  pos: "RB", players: [1],
  outlook: [{ year: 2027, underContract: 1, invested: 1, openSpots: 0, capCommitted: 16.6 }],
  expectedCore: 0, openSpots: 1,
  pressure: { pos: "RB", openSpots: 0, round1: 0.03, day12: 0.12, day3: 0.4, veteran: 0.077, any: 0.19, picks: [0, 2, 5], likelyTopTen: 0, uncertainPicks: 0, reasons: ["0 of 1 starting RB spot open"] },
};
const team = { teamId: 9, record: { winPct: 0.667, gamesPlayed: 9 }, cap: [{ year: 2027, leagueCap: 326.9, committed: 324.5, estimated: 0, voidMoney: 0, contracts: 40, space: 2.4 }],
  rooms: { RB: room, QB: room, WR: room, TE: room }, picks: [{ year: 2027, byRound: [0, 1, 1, 1, 1, 2, 1], byDay: [0, 2, 5], conditional: 0 }] } as unknown as TeamSituation;
const situation = { season: 2027, players: { 1: player({}) }, bySleeper: { s1: 1 }, teams: [team] } as unknown as ContractSituationResponse;

beforeEach(() => {
  setOverride.mockReset();
  hookState = { situation, overrides: {}, loading: false, error: null, setOverride, retry: vi.fn() };
});

describe("ContractChips", () => {
  it("shows the deal and the coming season's call, nothing for an unknown player", () => {
    const { container } = render(<div><ContractChips sleeperId="s1" /><ContractChips sleeperId="nobody" /></div>);
    expect(screen.getByText("thru '27")).toBeTruthy();
    expect(screen.getByText("Likely cut")).toBeTruthy();
    expect(container.querySelectorAll("span")).toHaveLength(2);
  });

  it("marks the user's own call", () => {
    hookState = { ...hookState, overrides: { "1": { call: "stays", season: 2027 } } };
    render(<ContractChips sleeperId="s1" />);
    expect(screen.getByText("Stays ✓")).toBeTruthy();
  });
});

describe("ContractSituationCard", () => {
  it("explains the call and the room, and sends the user's call", () => {
    render(<ContractSituationCard sleeperId="s1" position="RB" />);
    expect(screen.getByText(/saves \$13\.5M, leaves \$3\.1M dead/)).toBeTruthy();
    expect(screen.getByText("missed most of this season")).toBeTruthy();
    expect(screen.getByText(/day 1–2/).textContent).toContain("12%");
    fireEvent.click(screen.getByRole("button", { name: "Stays" }));
    expect(setOverride).toHaveBeenCalledWith(1, "stays");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(setOverride).toHaveBeenLastCalledWith(1, null);
  });

  it("says when contracts didn't load, and renders nothing off QB / RB / WR / TE", () => {
    hookState = { ...hookState, situation: null, error: "HTTP 502" };
    render(<ContractSituationCard sleeperId="s1" position="RB" />);
    expect(screen.getByText(/HTTP 502/)).toBeTruthy();
    const { container } = render(<ContractSituationCard sleeperId="s1" position="K" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ContractChips compact", () => {
  it("drops the guarantee from the deal chip", () => {
    hookState = { ...hookState, situation: { ...situation, players: { 1: player({ endYear: 2029, guaranteedThrough: 2027, cut: null }) } } };
    render(<div><ContractChips sleeperId="s1" compact /><ContractChips sleeperId="s1" /></div>);
    expect(screen.getByText("thru '29")).toBeTruthy();
    expect(screen.getByText("thru '29 · gtd '27")).toBeTruthy();
  });
});

describe("TradeContractNote", () => {
  it("notes the warnings on each side of a trade, nothing when there are none", () => {
    render(<TradeContractNote give={[]} receive={["s1", "nobody"]} />);
    expect(screen.getByText("You'd get:")).toBeTruthy();
    expect(screen.getByText("Jacobs: likely cut before 2027")).toBeTruthy();
    expect(screen.queryByText("You'd give:")).toBeNull();
    const { container } = render(<TradeContractNote give={["nobody"]} receive={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("drops a player the user says stays", () => {
    hookState = { ...hookState, overrides: { "1": { call: "stays", season: 2027 } } };
    const { container } = render(<TradeContractNote give={["s1"]} receive={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("RoomLine", () => {
  it("shows the expected open spots and the competition odds for the team's room", () => {
    const { container } = render(<RoomLine teamAbbr="GB" pos="RB" />);
    expect(screen.getByText(/day 1–2 RB/).textContent).toContain("12%");
    expect(container.textContent).toContain("2027: 1 open");
    expect(container.firstElementChild?.getAttribute("title")).toContain("0 of 1 starting RB spots open on contracts; 1 once likely cuts");
  });
});
