// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import BigBoard from "@/components/scouting/BigBoard";
import type { ProspectWithStats, AEScoreLock } from "@/lib/types";

// The Big Board's Above Exp group: one column per metric (AAE, SRAE, SAE, cSAE,
// TE-SAER, TE-SAEB). The models themselves are tested in aboveExpected.test.ts
// and aggregateMerge.test.ts; here they're stubbed so the test pins the board's
// wiring — which value lands in which column, and how the columns sort.

// The headline calculators return samples (value + plays + noise), which the
// board shows as values and feeds to the AE Score. Each stub reads a per-id
// table, so a test can add prospects (the AE Score's QB pool) just by listing
// them. Noise is variance 4 (±2 pts) on 50 plays unless a test raises it.
const { TABLES, NOISE } = vi.hoisted(() => {
  const POOL_QB_AE = [-9, -6, -4, -2, 0, 1, 3, 5, 8, 12];
  const qb: Record<string, number | null> = { qb1: 3.5 };
  POOL_QB_AE.forEach((ae, i) => { qb[`pq${i}`] = ae; });
  return {
    NOISE: { variance: 4 },
    TABLES: {
      qb,
      rb: { rb1: -2 } as Record<string, number | null>,
      teRoute: { te1: 4.2, te2: null } as Record<string, number | null>,
      teBlock: { te1: -1.1, te2: null } as Record<string, number | null>,
    },
  };
});
vi.mock("@/lib/scouting/aboveExpected", () => {
  const samples = (table: Record<string, number | null>) => (prospects: { id: string }[]) =>
    new Map(prospects.filter((p) => p.id in table).map((p) => {
      const ae = table[p.id];
      return [p.id, ae == null ? null : { ae, n: 50, variance: NOISE.variance }];
    }));
  return {
    computeQBAboveExpectedSamples: samples(TABLES.qb),
    computeRBAboveExpectedSamples: samples(TABLES.rb),
    computeTERouteAboveExpectedSamples: samples(TABLES.teRoute),
    computeTEBlockAboveExpectedSamples: samples(TABLES.teBlock),
    aeValues: (m: Map<string, { ae: number } | null>) => new Map([...m].map(([id, v]) => [id, v?.ae ?? null])),
    computeQBThrowSliceAAE: () => new Map([["qb1", {
      outside: { ae: 1.5, n: 20 }, inside: { ae: 7.2, n: 12 }, deep: { ae: null, n: 4 },
      intermediate: { ae: -3, n: 11 }, short: { ae: 2, n: 17 },
    }]]),
    computeRBRunSliceSRAE: () => new Map([["rb1", {
      outside: { ae: 4, n: 12 }, inside: { ae: -5.5, n: 30 }, zone: { ae: null, n: 6 }, man_gap: { ae: 0.4, n: 36 },
    }]]),
  };
});

// The recruit index (247 HS class year, for estimated ages) is a table load;
// here a per-id stub, filled by the age tests.
const { HS_CLASS } = vi.hoisted(() => ({ HS_CLASS: {} as Record<string, number> }));
vi.mock("@/hooks/useRecruitIndex", () => ({
  useRecruitIndex: () => ({
    loaded: true,
    recruitCount: 0,
    matchProspect: (p: { name: string }) => {
      const id = Object.keys(HS_CLASS).find((k) => k === p.name);
      return id ? { year: HS_CLASS[id] } : null;
    },
  }),
}));

// The board sizes its proxy scrollbar with a ResizeObserver, which jsdom lacks.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(() => {
  cleanup();
  NOISE.variance = 4;
  for (const k of Object.keys(HS_CLASS)) delete HS_CLASS[k];
  localStorage.clear();
});

const prospect = (id: string, name: string, position: string, rank: number, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name, position, school: "State", conference: "", draft_class_year: 2027,
    height: "", weight: null, birthday: null, personal_rank: rank, overall_rank: rank,
    pre_draft_grade: null, post_draft_grade: null, draft_round: null,
    adj_success_above_exp: null, core_sae: null, sae_sample: null, core_sae_sample: null,
    ...extra,
  }) as ProspectWithStats;

const PROSPECTS = [
  prospect("wr1", "Wide One", "WR", 1, { adj_success_above_exp: 8.8, core_sae: 6.1, pre_draft_grade: 92.4 }),
  prospect("wr2", "Wide Two", "WR", 2, { adj_success_above_exp: -0.4, core_sae: null }),
  prospect("qb1", "Quarter One", "QB", 3),
  prospect("rb1", "Running One", "RB", 4),
  prospect("te1", "Tight One", "TE", 5),
  prospect("te2", "Tight Two", "TE", 6),
];

const AE_LABELS = ["AAE", "SRAE", "SAE", "cSAE", "TE-SAER", "TE-SAEB"];

function renderBoard(
  prospects: ProspectWithStats[] = PROSPECTS,
  onUpdateDraftRound: (id: string, round: number | null) => Promise<boolean> = vi.fn(async () => true),
  extra: { scoresReady?: boolean; onLockAEScore?: (id: string, lock: AEScoreLock) => Promise<boolean> } = {},
) {
  return render(
    <BigBoard
      prospects={prospects}
      loading={false}
      onSelectProspect={vi.fn()}
      onUpdateRank={vi.fn()}
      onUpdateOverallRank={vi.fn()}
      onUpdateGrade={vi.fn()}
      onUpdateDraftRound={onUpdateDraftRound}
      draftYearFilter={null}
      setDraftYearFilter={vi.fn()}
      games={[]}
      rbPlays={[]}
      qbPlays={[]}
      tePlays={[]}
      loadPositionPlays={vi.fn()}
      {...extra}
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

  it("adds the QB breakdown to the QB tab, under its own header band", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /^QB/ }));
    const cols = ["AAE", "Outside", "Inside", "Deep", "Intermediate", "Short"];
    expect(headerLabels().slice(-cols.length)).toEqual(cols);
    expect(within(screen.getAllByRole("row")[0]).getAllByRole("columnheader").slice(-2).map((h) => h.textContent))
      .toEqual(["Above Exp", "AAE Breakdown"]);
    expect(cols.map((l) => cell("Quarter One", l))).toEqual(["+3.5", "+1.5", "+7.2", "—", "-3.0", "+2.0"]);
  });

  it("adds the RB breakdown to the RB tab", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /^RB/ }));
    const cols = ["SRAE", "Outside", "Inside", "Zone", "Man Gap"];
    expect(headerLabels().slice(-cols.length)).toEqual(cols);
    expect(cols.map((l) => cell("Running One", l))).toEqual(["-2.0", "+4.0", "-5.5", "—", "+0.4"]);
  });

  it("keeps breakdowns off the All tab", () => {
    renderBoard();
    for (const l of ["Outside", "Inside", "Deep", "Zone", "Man Gap"]) expect(headerLabels()).not.toContain(l);
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

  it("shows the grade tier legend and colours a grade by its tier", () => {
    renderBoard();
    const legend = screen.getByRole("list", { name: "Grade tiers" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Generational95+", "Cornerstone90–94.9", "Star85–89.9", "Starter80–84.9",
      "Rotational75–79.9", "Depth70–74.9", "Practice Squad65–69.9", "CFLUnder 65",
    ]);
    const grade = screen.getByText("92.4");
    expect(grade.className).toContain("text-violet-400");
    expect(grade.getAttribute("title")).toBe("Cornerstone (90–94.9)");
  });

  it("sinks an under-floor value below every real one", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("columnheader", { name: "cSAE" }));
    expect(names()[0]).toBe("Wide One");
    expect(names().indexOf("Wide Two")).toBeGreaterThan(0);
  });
});

describe("BigBoard AE Score", () => {
  // Ten more QBs, enough for QB to join the score (qb1 makes eleven).
  const POOL = Array.from({ length: 10 }, (_, i) => prospect(`pq${i}`, `Pool QB ${i}`, "QB", 10 + i));
  const scoreOf = (name: string) => cell(name, "AE Score");
  const scoreCell = (name: string) => within(rowFor(name)).getAllByRole("cell")[headerLabels().indexOf("AE Score")];

  it("sits in its own Composite band before the Above Exp metrics, on every tab", () => {
    renderBoard();
    const labels = headerLabels();
    expect(labels.indexOf("AE Score")).toBe(labels.indexOf("Wt") + 1);
    expect(labels.slice(labels.indexOf("AE Score"), labels.indexOf("AE Score") + 3)).toEqual(["AE Score", "Dynasty", "Dynasty+"]);
    expect(labels.indexOf("AAE")).toBe(labels.indexOf("Dynasty+") + 1);
    expect(within(screen.getAllByRole("row")[0]).getAllByRole("columnheader").map((h) => h.textContent))
      .toContain("Composite");
    fireEvent.click(screen.getByRole("button", { name: /^TE/ }));
    expect(headerLabels()).toContain("AE Score");
  });

  it("shows — and says why while a position has too few charted prospects", () => {
    renderBoard();
    expect(scoreOf("Quarter One")).toBe("—");
    expect(scoreCell("Quarter One").getAttribute("title")).toBe("QBs join the AE Score once 10 clear the AAE sample floor (1 now)");
    expect(screen.getByText(/AE Score true spread:/).textContent).toContain("TE joins at 10 (1 now)");
  });

  it("scores a position once it has the pool, and explains the number", () => {
    renderBoard([...PROSPECTS, ...POOL]);
    const score = scoreOf("Quarter One")!;
    expect(score).toMatch(/^\+0\.\d\d$/);
    const title = scoreCell("Quarter One").getAttribute("title")!;
    expect(title.split("\n")[0]).toBe(`${score} true-talent SDs vs the average charted QB`);
    expect(title).toContain("AAE +3.5 on 50 throws");
    expect(screen.getByText(/AE Score true spread:/).textContent).toMatch(/QB ±\d+\.\d pts \(11\)/);
    // Other positions are still short of the pool.
    expect(scoreOf("Running One")).toBe("—");
  });

  it("keeps a full pool out, and says so, when its spread is all noise", () => {
    NOISE.variance = 400; // ±20 pts each: the pool's ±6 is nothing but noise
    renderBoard([...PROSPECTS, ...POOL]);
    expect(scoreOf("Quarter One")).toBe("—");
    expect(scoreCell("Quarter One").getAttribute("title"))
      .toBe("QBs are out of the AE Score: their AAEs don't spread more than sample noise yet");
    expect(screen.getByText(/AE Score true spread:/).textContent).toContain("QB out, no spread beyond noise (11)");
  });

  it("sorts best-first on the first click, unscored rows sinking", () => {
    renderBoard([...PROSPECTS, ...POOL]);
    fireEvent.click(screen.getByRole("columnheader", { name: "AE Score" }));
    const order = names();
    expect(order[0]).toBe("Pool QB 9"); // +12
    expect(order.slice(0, 11).every((n) => n!.startsWith("Pool QB") || n === "Quarter One")).toBe(true);
    expect(order.indexOf("Pool QB 0")).toBe(10); // -9, last of the scored
  });
});

describe("BigBoard NFL draft round", () => {
  const roundSelect = (name: string) => screen.getByRole("combobox", { name: `NFL draft round for ${name}` }) as HTMLSelectElement;

  it("reads the saved round, labels 8 as Undrafted, and saves a change", () => {
    const save = vi.fn(async () => true);
    renderBoard([
      prospect("a", "Rd One", "WR", 1, { draft_round: 1 }),
      prospect("b", "No Pick", "WR", 2, { draft_round: 8 }),
      prospect("c", "Not Yet", "WR", 3),
    ], save);
    expect(roundSelect("Rd One").value).toBe("1");
    expect(roundSelect("No Pick").selectedOptions[0].textContent).toBe("Undrafted");
    expect(within(roundSelect("Not Yet")).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["—", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "Undrafted"]);
    fireEvent.change(roundSelect("Not Yet"), { target: { value: "8" } });
    expect(save).toHaveBeenCalledWith("c", 8);
    fireEvent.change(roundSelect("Rd One"), { target: { value: "" } });
    expect(save).toHaveBeenCalledWith("a", null);
  });

  it("moves rounds kept in this browser into the database once, never over a saved one", async () => {
    localStorage.setItem("nflDraftRound", JSON.stringify({ a: 3, b: 5, gone: 2 }));
    const save = vi.fn(async () => true);
    renderBoard([
      prospect("a", "Local Only", "WR", 1),
      prospect("b", "Saved Already", "WR", 2, { draft_round: 1 }),
    ], save);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("a", 3);
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("nflDraftRound")!)).toEqual({}));
  });

  it("keeps a local round whose database write failed", async () => {
    localStorage.setItem("nflDraftRound", JSON.stringify({ a: 3 }));
    const save = vi.fn(async () => false);
    renderBoard([prospect("a", "Local Only", "WR", 1)], save);
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("nflDraftRound")!)).toEqual({ a: 3 }));
  });
});

describe("BigBoard ages", () => {
  it("shows an exact age from the birthday and a ~estimate from the HS class", () => {
    HS_CLASS["Est Age"] = 2023;
    renderBoard([
      prospect("a", "Has Bday", "WR", 1, { birthday: "2004-01-15" }),
      prospect("b", "Est Age", "WR", 2),
      prospect("c", "No Age", "WR", 3),
    ]);
    expect(cell("Has Bday", "Age")).toMatch(/^\d\d$/);
    expect(cell("Est Age", "Age")).toMatch(/^~\d\d$/);
    expect(cell("No Age", "Age")).toBe("—");
  });
});

describe("BigBoard Dynasty Score", () => {
  const POOL = Array.from({ length: 10 }, (_, i) => prospect(`pq${i}`, `Pool QB ${i}`, "QB", 10 + i));
  const scoreCellOf = (name: string, label: string) =>
    within(rowFor(name)).getAllByRole("cell")[headerLabels().indexOf(label)];

  it("needs an AE Score, and Plus also needs the draft round", () => {
    renderBoard([...PROSPECTS, ...POOL]);
    expect(cell("Running One", "Dynasty")).toBe("—"); // RB pool too small for an AE Score
    expect(cell("Quarter One", "Dynasty")).toMatch(/^[+-]\d\.\d\d$/);
    expect(cell("Quarter One", "Dynasty+")).toBe("—");
    expect(scoreCellOf("Quarter One", "Dynasty+").getAttribute("title")).toBe("Set the NFL draft round to see Dynasty Score Plus");
  });

  it("adds age and draft capital, and explains each piece", () => {
    renderBoard([...PROSPECTS.map((p) => (p.id === "qb1" ? { ...p, draft_round: 1, birthday: "2005-06-01" } : p)), ...POOL]);
    const ae = Number(cell("Quarter One", "AE Score"));
    const dyn = Number(cell("Quarter One", "Dynasty"));
    const plus = Number(cell("Quarter One", "Dynasty+"));
    // 22.25 as a rookie: a hair under the typical 22-year-old's window → small minus.
    expect(dyn).toBeLessThan(ae);
    expect(dyn).toBeGreaterThan(ae - 0.1);
    // Round 1 adds +2.00 at the default 2× draft weight.
    expect(plus).toBeCloseTo(dyn + 2, 2);
    const title = scoreCellOf("Quarter One", "Dynasty+").getAttribute("title")!;
    expect(title).toContain("AE Score ");
    expect(title).toContain("Age 22.3 as a rookie");
    expect(title).toContain("Drafted: 1st → +2.00");
  });

  it("re-weights from the sliders", () => {
    renderBoard([...PROSPECTS.map((p) => (p.id === "qb1" ? { ...p, draft_round: 8 } : p)), ...POOL]);
    const dyn = Number(cell("Quarter One", "Dynasty"));
    expect(Number(cell("Quarter One", "Dynasty+"))).toBeCloseTo(dyn - 2, 2); // Undrafted −2.00 at 2×
    fireEvent.change(screen.getByRole("slider", { name: "Draft weight" }), { target: { value: "0.5" } });
    expect(Number(cell("Quarter One", "Dynasty+"))).toBeCloseTo(dyn - 0.5, 2);
    expect(JSON.parse(localStorage.getItem("dynastyScoreWeights")!)).toMatchObject({ draft: 0.5 });
  });

  it("sorts best-first on the first click", () => {
    renderBoard([...PROSPECTS, ...POOL]);
    fireEvent.click(screen.getByRole("columnheader", { name: "Dynasty" }));
    expect(names()[0]).toBe("Pool QB 9");
  });
});

describe("BigBoard opponent strength", () => {
  it("says it's waiting on the per-game WR data until it loads", () => {
    renderBoard();
    expect(screen.getByText(/Opponent strength \(scores only\):/).textContent).toContain("migration 058");
  });
});

describe("BigBoard drafted classes", () => {
  const POOL = Array.from({ length: 10 }, (_, i) => prospect(`pq${i}`, `Pool QB ${i}`, "QB", 10 + i));
  const as2026 = (p: ProspectWithStats) => ({ ...p, draft_class_year: 2026 }) as ProspectWithStats;
  afterEach(() => { vi.useRealTimers(); });

  it("scores a rookie's age as of the rookie season, so years later nothing moves", () => {
    const board = [...PROSPECTS.map((p) => (p.id === "qb1" ? { ...p, birthday: "2005-06-01" } : p)), ...POOL];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const first = renderBoard(board);
    const then = { dyn: cell("Quarter One", "Dynasty"), age: cell("Quarter One", "Age") };
    first.unmount();
    vi.setSystemTime(new Date("2031-10-01T12:00:00Z"));
    renderBoard(board);
    expect(cell("Quarter One", "Dynasty")).toBe(then.dyn);
    expect(Number(cell("Quarter One", "Age"))).toBe(Number(then.age) + 5); // only the display ages
  });

  it("freezes the AE Score of a drafted class once everything has loaded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const lock = vi.fn(async () => true);
    const board = [...PROSPECTS.map((p) => (p.id === "qb1" ? as2026(p) : p)), ...POOL.map((p, i) => (i < 3 ? as2026(p) : p))];
    const { unmount } = renderBoard(board, undefined, { scoresReady: false, onLockAEScore: lock });
    expect(lock).not.toHaveBeenCalled(); // not until the plays and opponent data are in
    unmount();
    renderBoard(board, undefined, { scoresReady: true, onLockAEScore: lock });
    await vi.waitFor(() => expect(lock).toHaveBeenCalledTimes(4));
    const ids = (lock.mock.calls as unknown as [string, AEScoreLock][]).map(([id]) => id).sort();
    expect(ids).toEqual(["pq0", "pq1", "pq2", "qb1"]); // the 2026 class only
    const [, saved] = (lock.mock.calls as unknown as [string, AEScoreLock][]).find(([id]) => id === "qb1")!;
    expect(cell("Quarter One", "AE Score")).toBe(`${saved.score >= 0 ? "+" : ""}${saved.score.toFixed(2)}`);
    expect(saved.components[0]).toMatchObject({ key: "aae", tau: expect.any(Number) });
  });

  it("shows a saved lock instead of the live score, and builds Dynasty on it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const saved: AEScoreLock = {
      score: -0.42,
      components: [{ key: "aae", label: "AAE", weight: 1, ae: -2, n: 80, reliability: 0.3, z: -0.42, tau: 2 }],
      locked_at: "2026-09-01T00:00:00.000Z",
    };
    const board = [...PROSPECTS.map((p) => (p.id === "qb1" ? { ...as2026(p), ae_score_lock: saved } : p)), ...POOL];
    renderBoard(board);
    expect(cell("Quarter One", "AE Score")).toBe("-0.42🔒");
    const title = within(rowFor("Quarter One")).getAllByRole("cell")[headerLabels().indexOf("AE Score")].getAttribute("title")!;
    expect(title).toContain("Locked");
    expect(title).toContain("the 2026 class has been drafted");
    // Dynasty adds only age/size to the locked -0.42 (no birthday or size here: +0).
    expect(cell("Quarter One", "Dynasty")).toBe("-0.42");
  });
});
