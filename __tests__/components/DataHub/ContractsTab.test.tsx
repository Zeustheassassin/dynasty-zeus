// Data Hub → Contracts: the sections, the filters and the user's call.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import type { ContractSituationResponse, PlayerSituation, RoomSituation, TeamSituation } from "@/lib/contractSituation";

const setOverride = vi.fn();
let hookState: Record<string, unknown> = {};
vi.mock("@/hooks/useContractSituation", () => ({ useContractSituation: () => hookState }));
// Raw FantasyCalc values (no league selected yet: the league-adjusted map is empty).
const RAW = { s1: 4200, s2: 3100, s3: 900, s4: 300 };
let valuesState: Record<string, unknown> = { rawFcValues: RAW, leagueAdjustedFcValues: {} };
vi.mock("@/lib/ValuesContext", () => ({ useValues: () => valuesState }));

import ContractsTab from "@/components/DataHub/ContractsTab";

const base: Omit<PlayerSituation, "otcId" | "sleeperId" | "name"> = {
  pos: "WR", teamId: 9, kind: "veteran", endYear: 2027, freeAgency: "UFA", apy: 10, capHit: 12, capHitEstimated: false,
  guaranteedThrough: null, futureGuaranteed: 0, fifthYearOption: null, invested: false, importance: "established",
  unavailable: false, age: 28.4, cut: null, stay: null, core: true,
};
const p = (otcId: number, sleeperId: string, name: string, extra: Partial<PlayerSituation>): PlayerSituation => ({ ...base, otcId, sleeperId, name, ...extra });
const players = {
  1: p(1, "s1", "Leaving Star", { endYear: 2026, stay: { call: "leaves", score: -1, reasons: ["37 in 2027"] } }),
  2: p(2, "s2", "Toss Up", { pos: "RB", endYear: 2026, stay: { call: "toss-up", score: 0, reasons: [] } }),
  3: p(3, "s3", "Cut Candidate", { cut: { level: "likely", score: 4, reasons: ["saves a lot"], savings: 12, deadMoney: 1 } }),
  4: p(4, "s4", "Deep Backup", { endYear: 2026, stay: { call: "leaves", score: -2, reasons: [] } }),
};
const room = (pos: RoomSituation["pos"], day12: number): RoomSituation => ({
  pos, players: [], outlook: [{ year: 2027, underContract: 2, invested: 1, openSpots: 0, capCommitted: 10 }], expectedCore: 1, openSpots: 0,
  pressure: { pos, openSpots: 0, round1: 0.1, day12, day3: 0.3, veteran: 0.1, any: day12, picks: [1, 2, 4], likelyTopTen: 0, uncertainPicks: 0, reasons: [] },
});
const team = (teamId: number, wr: number) => ({
  teamId, record: null, cap: [{ year: 2027, leagueCap: 326.9, committed: 300, estimated: 0, voidMoney: 0, contracts: 40, space: 26.9 }],
  rooms: { QB: room("QB", 0.1), RB: room("RB", 0.2), WR: room("WR", wr), TE: room("TE", 0.15) }, picks: [],
}) as unknown as TeamSituation;
const situation = {
  season: 2027, contractsUpdatedAt: "2026-11-10T15:31:04.000Z", pffSeasons: { current: 2026, prior: 2025 }, notes: [],
  players, bySleeper: { s1: 1, s2: 2, s3: 3, s4: 4 }, teams: [team(9, 0.22), team(20, 0.58)],
} as unknown as ContractSituationResponse;

const shares = { s2: { count: 2, leagues: ["a", "b"], starters: [] } };
const renderTab = () => render(<ContractsTab shares={shares} setPlayerProfileId={vi.fn()} />);
afterEach(cleanup);

beforeEach(() => {
  setOverride.mockReset();
  valuesState = { rawFcValues: RAW, leagueAdjustedFcValues: {} };
  hookState = { situation, overrides: {}, loading: false, error: null, setOverride, retry: vi.fn() };
});

describe("ContractsTab", () => {
  it("lists free agents to be by section, relevant players only by default", () => {
    renderTab();
    expect(within(screen.getByRole("region", { name: "Likely leaves" })).getByText("Leaving Star")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Toss-up" })).getByText("Toss Up")).toBeTruthy();
    expect(screen.queryByText("Deep Backup")).toBeNull(); // value 300 < 700
    fireEvent.click(screen.getByLabelText(/Value 700\+/));
    expect(screen.getByText("Deep Backup")).toBeTruthy();
  });

  it("lets the value filter step aside until values load", () => {
    valuesState = { rawFcValues: {}, leagueAdjustedFcValues: {} };
    renderTab();
    expect(screen.getByText("Deep Backup")).toBeTruthy();
    expect((screen.getByLabelText(/Value 700\+/) as HTMLInputElement).disabled).toBe(true);
  });

  it("filters to the user's players and by position", () => {
    renderTab();
    fireEvent.click(screen.getByLabelText(/On my teams/));
    expect(screen.queryByText("Leaving Star")).toBeNull();
    expect(screen.getByText("Toss Up")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/On my teams/));
    fireEvent.click(screen.getByRole("button", { name: "RB" }));
    expect(screen.queryByText("Leaving Star")).toBeNull();
  });

  it("shows cut candidates with the release math, and sends the user's call", () => {
    renderTab();
    fireEvent.click(screen.getByRole("tab", { name: "Cut candidates" }));
    const likely = screen.getByRole("region", { name: "Likely cut" });
    expect(within(likely).getByText("Cut Candidate")).toBeTruthy();
    expect(within(likely).getByText(/saves \$12\.0M \/ \$1\.0M dead/)).toBeTruthy();
    fireEvent.change(within(likely).getByLabelText("Your call on Cut Candidate for 2027"), { target: { value: "stays" } });
    expect(setOverride).toHaveBeenCalledWith(3, "stays");
  });

  it("ranks rooms by their odds of adding competition", () => {
    renderTab();
    fireEvent.click(screen.getByRole("tab", { name: "Rooms" }));
    fireEvent.click(screen.getByRole("button", { name: "WR" }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("NYJ");
    expect(rows[0].textContent).toContain("58%");
    expect(rows[1].textContent).toContain("GB");
  });

  it("says when there are no calls yet, and when contracts didn't load", () => {
    renderTab();
    fireEvent.click(screen.getByRole("tab", { name: "Your calls" }));
    expect(screen.getByText(/No calls yet/)).toBeTruthy();
    hookState = { ...hookState, situation: null, error: "HTTP 502" };
    renderTab();
    expect(screen.getByText(/Couldn.t load contracts \(HTTP 502\)/)).toBeTruthy();
  });
});
