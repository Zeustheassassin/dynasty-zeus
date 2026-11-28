import { describe, it, expect } from "vitest";
import {
  calendarItems,
  consensusMilestones,
  dataItems,
  generationalByClass,
  markKey,
  nflDraftDay,
  slowTapeOpen,
  sortDue,
  type DueDataInputs,
  type DueItem,
  type DueMark,
} from "../../../lib/scouting/dueNow";
import type { GradingReport, ModelCheck } from "../../../lib/scouting/gradingChecks";

// Stage 2 of the 2026-11-26 scouting plan: Analysis → Grading checks → Due
// now, the plan's dated checkpoints and HANDOFF §23's re-checks in one list.

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
const marks = (entries: [string, string, DueMark][] = []) =>
  new Map(entries.map(([k, c, m]) => [markKey(k, c), m]));
const find = (items: DueItem[], key: string, cycle?: string) =>
  items.find((i) => i.key === key && (cycle == null || i.cycle === cycle));

describe("dates", () => {
  it("the draft is the fourth Thursday of April", () => {
    expect(nflDraftDay(2026)).toEqual(new Date(2026, 3, 23));
    expect(nflDraftDay(2027)).toEqual(new Date(2027, 3, 22));
    expect(nflDraftDay(2028)).toEqual(new Date(2028, 3, 27));
  });

  it("consensus milestones: declarations, Senior Bowl, combine, the week before the draft", () => {
    expect(consensusMilestones(2027).map((m) => m.at)).toEqual([
      new Date(2027, 0, 16), new Date(2027, 1, 2), new Date(2027, 2, 4), new Date(2027, 3, 15),
    ]);
  });
});

describe("calendarItems", () => {
  const none = marks();

  it("on 2026-11-27: the 2027 class's checks, the consensus upload coming up, the rest later", () => {
    const items = calendarItems(day(2026, 11, 27), none, null, []);
    const consensus = find(items, "consensus_upload")!;
    // Nov 5 + 30 days, before any milestone.
    expect([consensus.state, consensus.when]).toEqual(["soon", "Dec 5, 2026, 30 days after the last one"]);
    expect(find(items, "catapult", "2027")!.state).toBe("later");
    expect(find(items, "class_check", "2026")!.when).toBe("Jan 5, 2027");
    expect(find(items, "review_2", "2027")!.when).toBe("Apr 1–15, 2027");
    expect(find(items, "draft_week", "2027")!.when).toBe("Apr 22–24, 2027");
    // Draft Saturday, the night before rookie drafts start.
    expect(find(items, "draft_realign", "2027")!.when).toBe("Apr 24, 2027");
    expect(find(items, "draft_realign", "2027")!.detail).toMatch(/Realign ranks → By Dynasty\+/);
    expect(find(items, "league_renewal")).toBeTruthy();
    // Nothing from before the list started shows as overdue.
    expect(items.filter((i) => i.state === "due")).toEqual([]);
  });

  it("a dated check is due from its date until marked, then done", () => {
    const jan2 = day(2027, 1, 2);
    expect(find(calendarItems(jan2, none, null, []), "catapult")!.state).toBe("due");
    const marked = marks([["catapult", "2027", { doneAt: "2027-01-02T15:00:00Z", value: "no_access" }]]);
    const c = find(calendarItems(jan2, marked, null, []), "catapult")!;
    expect([c.state, c.done?.value, c.mark, c.choices?.length]).toEqual(["done", "no_access", "choice", 2]);
  });

  it("the consensus upload: 30 days after the last, or sooner at a milestone", () => {
    const dec10 = marks([["consensus_upload", "", { doneAt: new Date(2026, 11, 10, 12).toISOString(), value: null }]]);
    expect(find(calendarItems(day(2026, 12, 20), dec10, null, []), "consensus_upload")!.when).toBe("Jan 9, 2027, 30 days after the last one");
    const jan10 = marks([["consensus_upload", "", { doneAt: new Date(2027, 0, 10, 12).toISOString(), value: null }]]);
    const c = find(calendarItems(day(2027, 1, 17), jan10, null, []), "consensus_upload")!;
    expect([c.state, c.when]).toEqual(["due", "Jan 16, 2027, after early-entry declarations (mid-January)"]);
  });

  it("a consensus save on the Big Board counts as the upload (the newest of it, a mark and Nov 5)", () => {
    const saved = [{ name: "A", draft_class_year: 2027, pre_draft_grade: null, consensus_at: new Date(2026, 11, 10, 12).toISOString() }];
    const c = find(calendarItems(day(2026, 12, 20), none, null, saved), "consensus_upload")!;
    expect([c.state, c.when]).toEqual(["soon", "Jan 9, 2027, 30 days after the last one"]);
    expect(c.note).toMatch(/^Last upload Dec 10, 2026 \(10 days ago\)/);
    // A later mark wins over an older save.
    const jan5 = marks([["consensus_upload", "", { doneAt: new Date(2027, 0, 5, 12).toISOString(), value: null }]]);
    expect(find(calendarItems(day(2027, 1, 6), jan5, null, saved), "consensus_upload")!.note).toMatch(/^Last upload Jan 5, 2027/);
    // Before any save, Nov 5's CSV.
    expect(find(calendarItems(day(2026, 11, 27), none, null, []), "consensus_upload")!.note).toMatch(/^Last upload Nov 5, 2026/);
  });

  it("the class flips in May; last class's open checks carry over until marked", () => {
    const may10 = day(2027, 5, 10);
    const items = calendarItems(may10, none, null, []);
    expect(find(items, "catapult", "2028")!.state).toBe("later");
    expect(find(items, "draft_week", "2027")!.state).toBe("due");
    expect(find(items, "draft_realign", "2027")!.state).toBe("due");
    expect(find(items, "birthdays", "2027-draft")!.state).toBe("due");
    expect(find(items, "post_curve", "2027")!.state).toBe("due");
    const marked = marks([["draft_week", "2027", { doneAt: "2027-04-26T12:00:00Z", value: null }]]);
    expect(find(calendarItems(may10, marked, null, []), "draft_week", "2027")).toBeUndefined();
  });

  it("the top-60 goal reads Chart Next's progress and clears itself when met", () => {
    const g = find(calendarItems(day(2027, 2, 20), none, { done: 41, slots: 60, ranked: 60 }, []), "top60_goal")!;
    expect([g.state, g.progress, g.mark]).toEqual(["due", { have: 41, need: 60, unit: "done" }, null]);
    expect(find(calendarItems(day(2027, 2, 20), none, { done: 60, slots: 60, ranked: 60 }, []), "top60_goal")!.state).toBe("done");
  });
});

describe("Generational count", () => {
  const p = (name: string, year: number, grade: number | null) => ({ name, draft_class_year: year, pre_draft_grade: grade });

  it("lists who's at Pre 95+ per class, best first", () => {
    expect(generationalByClass([p("Smith", 2027, 96), p("Two", 2027, 95.2), p("Below", 2027, 94.9), p("Next", 2028, 97)])).toEqual([
      { year: 2027, names: ["Smith 96.0", "Two 95.2"] }, { year: 2028, names: ["Next 97.0"] },
    ]);
  });

  it("is a watch item until a class has more than two, then due until marked for that count", () => {
    const one = find(calendarItems(day(2026, 11, 27), marks(), null, [p("Smith", 2027, 96)]), "generational")!;
    expect([one.state, one.note]).toEqual(["watch", "2027: Smith 96.0"]);
    const three = [p("A", 2027, 96), p("B", 2027, 95.5), p("C", 2027, 95)];
    const due = find(calendarItems(day(2026, 11, 27), marks(), null, three), "generational")!;
    expect([due.state, due.cycle]).toEqual(["due", "2027:3"]);
    const seen = marks([["generational", "2027:3", { doneAt: "2026-11-27T12:00:00Z", value: null }]]);
    expect(find(calendarItems(day(2026, 11, 27), seen, null, three), "generational")!.state).toBe("done");
    expect(find(calendarItems(day(2026, 11, 27), seen, null, [...three, p("D", 2027, 99)]), "generational")!.state).toBe("due");
  });
});

describe("dataItems", () => {
  const model = (extra: Partial<ModelCheck>): ModelCheck => ({
    key: "wr_sae", label: "WR SAE", readiness: [], tests: [], subRoutes: [], subRouteTests: [],
    garbage: { prospects: 0, garbagePlays: 0, testable: false, errors: null, best: null }, garbageWeight: 1,
    eras: {}, drift: { drift: null, se: null, flagged: false, enough: false }, recentered: false,
    ...extra,
  } as ModelCheck);
  const sub = (id: `${string}:${string}`, reps: number, enabled = false) =>
    ({ id, label: id, reps, wins: 0, prospects: 20, restReps: 0, restWins: 0, testable: true, short: null, enabled });
  const readiness = (column: string, on: number, enabled = false) =>
    ({ column, label: column, taggedPlays: on, onPlays: { on }, prospects: 10, testable: true, short: null, enabled });
  const test = (column: string, improves: boolean) =>
    ({ column, label: column, baseLoss: 0.6, withLoss: improves ? 0.59 : 0.61, effects: {}, improves, foldsBetter: 4, foldsRun: 5 });

  const report = {
    models: [
      model({
        subRoutes: [sub("out:short", 520), sub("nine:plain", 600, true), sub("dig:intermediate", 310), sub("post:deep", 120)],
        subRouteTests: [test("post:deep", true)],
        readiness: [readiness("red_zone", 200), readiness("double_coverage", 25), readiness("play_action", 300, true)],
        tests: [test("red_zone", true), test("play_action", true)],
        garbage: { prospects: 12, garbagePlays: 400, testable: true, errors: {}, best: 0.5 }, garbageWeight: 1,
      }),
      model({
        key: "te_saer", label: "TE-SAER", readiness: [readiness("double_coverage", 6)],
        drift: { drift: 4, se: 1, flagged: true, enough: true },
      }),
    ],
    components: { QB: [], RB: [], WR: [], TE: [] },
  } as unknown as GradingReport;

  const games = [{ id: "te1", prospect_id: "teA" }, { id: "te2", prospect_id: "teB" }, { id: "qb1", prospect_id: "qbA" }];
  const tePlays = [
    ...Array.from({ length: 70 }, () => ({ game_id: "te1", created_at: "2026-11-01T00:00:00Z", play_type: "route_run", was_open: true })),
    { game_id: "te2", created_at: "2026-10-01T00:00:00Z", play_type: "route_run", was_open: false },
  ] as DueDataInputs["tePlays"];
  const rbPlays = [
    ...Array.from({ length: 300 }, () => ({ created_at: "2026-11-23T00:00:00Z", run_type: "inside_zone", success: true })),
    { created_at: "2026-11-20T00:00:00Z", run_type: "inside_zone", success: true },
  ] as DueDataInputs["rbPlays"];
  const qbPlays = Array.from({ length: 10 }, () => ({ game_id: "qb1", run_success: true })) as DueDataInputs["qbPlays"];
  const routeTagCells = [{ prospect_id: "wrA", game_id: "g", cells: { "curl|press|left|on|0|0|0|0|won|-": [12, 9] } }] as DueDataInputs["routeTagCells"];
  const inputs: DueDataInputs = { report, games, qbPlays, rbPlays, tePlays, routeTagCells };
  const items = dataItems(inputs, marks());

  it("a sub-route at 500 routes and not on is due; one already on isn't listed", () => {
    expect(find(items, "sub_route_500", "wr_sae:out:short")!.state).toBe("due");
    expect(find(items, "sub_route_500", "wr_sae:nine:plain")).toBeUndefined();
  });

  it("shows the closest pooled sub-route's progress toward 500", () => {
    expect(find(items, "sub_route_next")!.progress).toEqual({ have: 310, need: 500, unit: "routes" });
  });

  it("a passing test that's off is due (tag or sub-route); one that's on isn't", () => {
    expect(find(items, "tag_test", "wr_sae:red_zone")!.state).toBe("due");
    expect(find(items, "tag_test", "wr_sae:play_action")).toBeUndefined();
    expect(find(items, "sub_route_test", "wr_sae:post:deep")!.state).toBe("due");
  });

  it("garbage-time weight and era drift", () => {
    expect(find(items, "garbage_weight", "wr_sae")!.state).toBe("due");
    expect(find(items, "era_drift", "te_saer")!.state).toBe("due");
    expect(find(items, "era_drift", "wr_sae")).toBeUndefined();
  });

  it("thresholds read off the plays: due once met, waiting with progress before", () => {
    const state = (key: string) => { const i = find(items, key)!; return [i.state, i.progress?.have]; };
    expect(state("double_coverage")).toEqual(["due", 31]);
    expect(state("te_field_time")).toEqual(["waiting", 1]);
    expect(state("te_spread")).toEqual(["waiting", 1]);
    expect(state("rb_level")).toEqual(["due", 300]);
    expect(state("qb_run_scale")).toEqual(["waiting", 1]);
    expect(state("wr_release_scale")).toEqual(["waiting", 1]);
  });

  it("a mark makes a data check done", () => {
    const marked = dataItems(inputs, marks([["rb_level", "2026-11-22", { doneAt: "2026-11-27T12:00:00Z", value: null }]]));
    expect(find(marked, "rb_level")!.state).toBe("done");
  });
});

describe("sortDue and slowTapeOpen", () => {
  it("due by date, then coming up, waiting (closest first), later, watch, done", () => {
    const item = (key: string, state: DueItem["state"], at: number | null, progress?: [number, number]): DueItem =>
      ({ key, cycle: "", title: key, detail: "", when: "", state, at, mark: null, progress: progress ? { have: progress[0], need: progress[1], unit: "" } : null });
    const sorted = sortDue([
      item("watch", "watch", null), item("later", "later", 5), item("w-far", "waiting", null, [1, 10]),
      item("due2", "due", 2), item("w-near", "waiting", null, [9, 10]), item("soon", "soon", 3), item("due1", "due", 1),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["due1", "due2", "soon", "w-near", "w-far", "later", "watch"]);
  });

  it("Chart Next shows slow tape once that class's Catapult call is marked", () => {
    const m = marks([["catapult", "2027", { doneAt: "2027-01-03T12:00:00Z", value: "access" }]]);
    expect([slowTapeOpen(m, 2027), slowTapeOpen(m, 2028), slowTapeOpen(null, 2027)]).toEqual([true, false, false]);
  });
});
