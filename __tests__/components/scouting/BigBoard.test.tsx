// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import BigBoard from "@/components/scouting/BigBoard";
import type { ProspectWithStats } from "@/lib/types";

// The Big Board's Above Exp group: one column per metric (AAE, SRAE, SAE, cSAE,
// TE-SAER, TE-SAEB). The models themselves are tested in aboveExpected.test.ts
// and aggregateMerge.test.ts; here they're stubbed so the test pins the board's
// wiring — which value lands in which column, and how the columns sort.

vi.mock("@/lib/scouting/aboveExpected", () => ({
  computeQBAboveExpected: () => new Map([["qb1", 3.5]]),
  computeRBAboveExpected: () => new Map([["rb1", -2]]),
  computeTERouteAboveExpected: () => new Map([["te1", 4.2], ["te2", null]]),
  computeTEBlockAboveExpected: () => new Map([["te1", -1.1], ["te2", null]]),
}));

// The board sizes its proxy scrollbar with a ResizeObserver, which jsdom lacks.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(cleanup);

const prospect = (id: string, name: string, position: string, rank: number, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name, position, school: "State", conference: "", draft_class_year: 2027,
    height: "", weight: null, birthday: null, personal_rank: rank, overall_rank: rank,
    pre_draft_grade: null, post_draft_grade: null,
    adj_success_above_exp: null, core_sae: null,
    ...extra,
  }) as ProspectWithStats;

const PROSPECTS = [
  prospect("wr1", "Wide One", "WR", 1, { adj_success_above_exp: 8.8, core_sae: 6.1 }),
  prospect("wr2", "Wide Two", "WR", 2, { adj_success_above_exp: -0.4, core_sae: null }),
  prospect("qb1", "Quarter One", "QB", 3),
  prospect("rb1", "Running One", "RB", 4),
  prospect("te1", "Tight One", "TE", 5),
  prospect("te2", "Tight Two", "TE", 6),
];

const AE_LABELS = ["AAE", "SRAE", "SAE", "cSAE", "TE-SAER", "TE-SAEB"];

function renderBoard() {
  render(
    <BigBoard
      prospects={PROSPECTS}
      loading={false}
      onSelectProspect={vi.fn()}
      onUpdateRank={vi.fn()}
      onUpdateOverallRank={vi.fn()}
      onUpdateGrade={vi.fn()}
      draftYearFilter={null}
      setDraftYearFilter={vi.fn()}
      games={[]}
      rbPlays={[]}
      qbPlays={[]}
      tePlays={[]}
      loadPositionPlays={vi.fn()}
    />,
  );
}

// Second header row = one <th> per column, lined up 1:1 with each body row's cells.
const headerLabels = () =>
  within(screen.getAllByRole("row")[1]).getAllByRole("columnheader").map((h) => h.textContent!.replace(/[↑↓]$/, ""));
const bodyRows = () => screen.getAllByRole("row").slice(2);
const rowFor = (name: string) => bodyRows().find((r) => within(r).queryByText(name))!;
const cell = (name: string, label: string) =>
  within(rowFor(name)).getAllByRole("cell")[headerLabels().indexOf(label)].textContent;
const aeRow = (name: string) => AE_LABELS.map((l) => cell(name, l));
const names = () => bodyRows().map((r) => within(r).getAllByRole("cell")[2].textContent);

describe("BigBoard Above Exp columns", () => {
  it("shows every AE metric on the All tab, each row filling only its own position's", () => {
    renderBoard();
    expect(headerLabels().filter((l) => AE_LABELS.includes(l))).toEqual(AE_LABELS);
    //                              AAE     SRAE    SAE     cSAE    TE-SAER TE-SAEB
    expect(aeRow("Wide One")).toEqual(["", "", "+8.8", "+6.1", "", ""]);
    expect(aeRow("Quarter One")).toEqual(["+3.5", "", "", "", "", ""]);
    expect(aeRow("Running One")).toEqual(["", "-2.0", "", "", "", ""]);
    expect(aeRow("Tight One")).toEqual(["", "", "", "", "+4.2", "-1.1"]);
  });

  it("shows — only where a metric applies but is under its sample floor", () => {
    renderBoard();
    expect(aeRow("Wide Two")).toEqual(["", "", "-0.4", "—", "", ""]);
    expect(aeRow("Tight Two")).toEqual(["", "", "", "", "—", "—"]);
  });

  it("narrows to the tab's own metrics on a position tab", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /^TE/ }));
    expect(headerLabels().filter((l) => AE_LABELS.includes(l))).toEqual(["TE-SAER", "TE-SAEB"]);
    fireEvent.click(screen.getByRole("button", { name: /^WR/ }));
    expect(headerLabels().filter((l) => AE_LABELS.includes(l))).toEqual(["SAE", "cSAE"]);
  });

  it("sorts an AE column best-first on the first click, other positions sinking both ways", () => {
    renderBoard();
    const others = ["Quarter One", "Running One", "Tight One", "Tight Two"];
    fireEvent.click(screen.getByRole("columnheader", { name: "SAE" }));
    expect(names().slice(0, 2)).toEqual(["Wide One", "Wide Two"]);
    expect(names().slice(2)).toEqual(others);
    fireEvent.click(screen.getByRole("columnheader", { name: /^SAE/ }));
    expect(names().slice(0, 2)).toEqual(["Wide Two", "Wide One"]);
    expect(names().slice(2)).toEqual(others);
  });

  it("sinks an under-floor value below every real one", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("columnheader", { name: "cSAE" }));
    expect(names()[0]).toBe("Wide One");
    expect(names().indexOf("Wide Two")).toBeGreaterThan(0);
  });
});
