// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import PostDraftTab from "@/components/scouting/PostDraftTab";
import { DEFAULT_DYNASTY_WEIGHTS } from "@/lib/scouting/dynastyScore";
import { SAMPLE_FULL, type SampleSize } from "@/lib/scouting/sampleSize";
import { sampleTier } from "@/lib/scouting/sampleTiers";
import type { DraftPickRow } from "@/lib/nflDraft";
import type { Prospect } from "@/lib/types";

// The Post-Draft tab's Surprise picks (stage 8 of the 2026-11-26 scouting plan).

const { QUERY } = vi.hoisted(() => ({ QUERY: { rows: [] as unknown[], calls: [] as string[] } }));
vi.mock("@/lib/supabaseclient", () => {
  const chain = {
    select: (cols: string) => { QUERY.calls.push(`select ${cols}`); return chain; },
    eq: (c: string, v: unknown) => { QUERY.calls.push(`eq ${c} ${v}`); return chain; },
    is: (c: string, v: unknown) => { QUERY.calls.push(`is ${c} ${v}`); return chain; },
    in: (c: string, v: unknown[]) => { QUERY.calls.push(`in ${c} ${v.join(",")}`); return Promise.resolve({ data: QUERY.rows, error: null }); },
  };
  return { supabase: { from: (t: string) => { QUERY.calls.push(`from ${t}`); return chain; } } };
});

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-04-26T12:00:00Z"));
  QUERY.rows = []; QUERY.calls = [];
});
afterEach(() => { vi.useRealTimers(); });

const prospect = (id: string, name: string, position: string) =>
  ({ id, name, position, school: "State", draft_class_year: 2027, draft_round: null, draft_pick: null, draft_team: null }) as unknown as Prospect;
const sample = (pos: "WR" | "TE", n: number): SampleSize => {
  const f = SAMPLE_FULL[pos];
  return { ...f, n, share: Math.min(1, n / f.full), tier: sampleTier(n, f.full) };
};
const pick = (overall: number, name: string, position: string, college: string | null = null): DraftPickRow => ({
  year: 2027, overall, round: Math.ceil(overall / 32), pick: ((overall - 1) % 32) + 1, nfl_team_id: 20, nfl_team: "Jets", position, name, college,
});

const PROSPECTS = [prospect("w1", "Wide One", "WR"), prospect("w2", "Thin Two", "WR"), prospect("t1", "Tight Udfa", "TE")];
const SAMPLES = new Map([["w1", sample("WR", 150)], ["w2", sample("WR", 20)], ["t1", sample("TE", 5)]]);

function renderTab(samplesReady = true, picks = [pick(5, "Wide One", "Wide Receiver"), pick(40, "Thin Two", "Wide Receiver"), pick(77, "Off Board", "Tight End", "Iowa")]) {
  render(<PostDraftTab prospects={PROSPECTS} draftPicks={picks} dynasty={new Map()} weights={DEFAULT_DYNASTY_WEIGHTS}
    roleFits={new Map()} standings={new Map()} samples={SAMPLES} samplesReady={samplesReady} />);
  return screen.getByRole("region", { name: /^Surprise picks/ });
}

describe("Post-Draft → Surprise picks", () => {
  it("lists the drafted players off the board or thinly charted", () => {
    const sec = renderTab();
    expect(within(sec).getByRole("heading", { name: "Surprise picks (2)" })).toBeTruthy();
    const rows = within(sec).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows[0]).toContain("Thin Two");
    expect(rows[0]).toContain("Under a quarter sample: 20 of 160 routes");
    expect(rows[1]).toContain("Off Board");
    expect(rows[1]).toContain("Iowa");
    expect(rows[1]).toContain("Not on your board");
    expect(within(sec).queryByText("Wide One")).toBeNull();
  });

  it("holds the thin check until the plays load", () => {
    const sec = renderTab(false);
    expect(within(sec).getByRole("heading", { name: "Surprise picks (1)" })).toBeTruthy();
    expect(within(sec).getByText(/Thin samples show once every play has loaded/)).toBeTruthy();
  });

  it("reads the class's undrafted signings from the contracts table and adds them", async () => {
    QUERY.rows = [
      { otc_id: 1, player: "Tight Udfa", position: "TE", team: "Bills", is_active: true, contract_type: "UDFA", draft_year: 2027, draft_round: null },
      { otc_id: 2, player: "New Guy", position: "RB", team: "Rams", is_active: false, contract_type: "UDFA", draft_year: 2027, draft_round: null },
    ];
    const sec = renderTab();
    fireEvent.click(within(sec).getByRole("button", { name: "Load UDFA signings" }));
    expect(await within(sec).findByRole("heading", { name: "Surprise picks (4)" })).toBeTruthy();
    expect(QUERY.calls).toEqual([
      "from nfl_contracts", "select otc_id,player,position,team,is_active,contract_type,draft_year,draft_round",
      "eq draft_year 2027", "is draft_round null", "in position QB,RB,FB,WR,TE",
    ]);
    const rows = within(sec).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows[2]).toContain("Bills · UDFA");
    expect(rows[2]).toContain("Under a quarter sample: 5 of 140 routes");
    expect(rows[3]).toContain("Rams · UDFA(released)");
    expect(within(sec).getByRole("button", { name: "Reload UDFA signings" })).toBeTruthy();
  });

  it("says to load the draft first when nothing is stored", () => {
    const sec = renderTab(true, []);
    expect(within(sec).getByText("Load the 2027 draft results first.")).toBeTruthy();
  });
});
