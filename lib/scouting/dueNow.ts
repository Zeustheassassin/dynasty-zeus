// ============================================================
// Analysis → Grading checks → Due now — client-safe, pure.
// ============================================================
// Stage 2 of the scouting plan (2026-11-26): one list of every re-check that
// comes due on a date or once the data is there, so none waits on someone
// remembering it.
//
//   Dated (calendarItems)  the plan's checkpoints for the class being
//                          scouted, e.g. the Catapult call in the first week
//                          of January, Fill 40s around Mar 1, the two review
//                          parts, draft week; the consensus upload every 30
//                          days or at a milestone; HANDOFF §23's dated items.
//   Data (dataItems)       HANDOFF §23's re-checks that wait on a sample:
//                          sub-routes at 500 routes, a passing tag test,
//                          garbage time, era drift, TE field time, the TE
//                          spread, the RB level shift, the provisional role
//                          scales, double coverage. Read off the Grading
//                          report and the plays.
//   Generational           how many reach Generational per class (the user:
//                          "really hard to hit"), flagged past a line.
//
// A check is marked done per cycle (scouting_due_marks, migration 106): a
// class year, a stage of one, or a model and tag. A dated check is due from
// its date until marked; a data check from when its trigger is met.
// ============================================================

import type { Prospect, QBPlay, RBPlay, TEPlay } from "../types";
import type { GradingReport } from "./gradingChecks";
import type { ProspectGameRouteTagCellsRow } from "./aggregateMerge";
import { releaseByProspect } from "./aggregateMerge";
import { GRADE_TIERS } from "./prospectGrade";
import { QB_RUN_TAG_MIN } from "./roleFitQB";
import { X_RELEASE_REPS } from "./roleFitWR";
import { scoutingClassYear } from "./chartNext";
import { sampleGameToProspect } from "./sampleGames";
import { latestConsensusAt } from "./consensusBoard";

export type DueState = "due" | "soon" | "waiting" | "later" | "watch" | "done";

/** A saved done mark (scouting_due_marks). */
export interface DueMark {
  doneAt: string;
  value: string | null;
}
export type DueMarks = ReadonlyMap<string, DueMark>;
export const markKey = (key: string, cycle: string) => `${key}|${cycle}`;

export interface DueChoice {
  value: string;
  label: string;
}

export interface DueItem {
  key: string;
  cycle: string;
  title: string;
  /** What to do, and where. */
  detail: string;
  /** When it comes due, as shown: "Jan 1–7, 2027", "at 30 TE games". */
  when: string;
  state: DueState;
  /** When it comes (or came) due, ms; null for data checks. */
  at: number | null;
  /** How far the data is toward the trigger. */
  progress?: { have: number; need: number; unit: string } | null;
  /** An extra line, e.g. the last consensus upload. */
  note?: string | null;
  /** "done": a Mark done button; "choice": one button per choice; null: clears itself. */
  mark: "done" | "choice" | null;
  choices?: readonly DueChoice[];
  /** The saved mark for this cycle, if any. */
  done?: DueMark | null;
}

/** A dated check counts as coming up this many days ahead. */
export const SOON_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
/** The day the plan was locked (2026-11-26): no check dated before it is carried as overdue. */
export const DUE_LIST_START = new Date(2026, 10, 26).getTime();

// ── Dates ───────────────────────────────────────────────────

/** The NFL draft's first night: the fourth Thursday of April (Apr 23 in 2026, Apr 22 in 2027). */
export function nflDraftDay(year: number): Date {
  const firstWeekday = new Date(year, 3, 1).getDay();
  const firstThursday = 1 + ((4 - firstWeekday + 7) % 7);
  return new Date(year, 3, firstThursday + 21);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jan 5, 2027". */
export function dayText(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
/** "Jan 1–7, 2027", or "Apr 22, 2027" without an end. */
function windowText(start: Date, end?: Date): string {
  if (!end) return dayText(start);
  if (start.getMonth() === end.getMonth()) return `${MONTHS[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${dayText(end)}`;
}

function datedState(start: Date, now: Date, done: boolean): DueState {
  if (done) return "done";
  if (now.getTime() >= start.getTime()) return "due";
  return start.getTime() - now.getTime() <= SOON_DAYS * DAY ? "soon" : "later";
}

// ── The consensus upload ────────────────────────────────────

/** The last consensus upload before the app recorded them (the 11/5 CSV, 2027 class). */
export const CONSENSUS_LAST_UPLOAD = "2026-11-05T12:00:00Z";
/** Re-upload at least this often. */
export const CONSENSUS_EVERY_DAYS = 30;

/** The consensus board's milestones in a draft year: the news that moves it. */
export function consensusMilestones(year: number): { label: string; at: Date }[] {
  const draft = nflDraftDay(year);
  return [
    { label: "early-entry declarations (mid-January)", at: new Date(year, 0, 16) },
    { label: "the Senior Bowl (early February)", at: new Date(year, 1, 2) },
    { label: "the combine (early March)", at: new Date(year, 2, 4) },
    { label: "the week before the draft", at: new Date(draft.getTime() - 7 * DAY) },
  ];
}

/**
 * The consensus upload, due 30 days after the last one or at the next
 * milestone before then. The last one is the newest of: a save on the Big
 * Board's Consensus board panel (prospects' consensus_at, migration 109), a
 * Mark done (an upload made another way), and the Nov 5 CSV.
 */
function consensusItem(now: Date, year: number, marks: DueMarks, uploadedAt: string | null): DueItem {
  const mark = marks.get(markKey("consensus_upload", "")) ?? null;
  const times = [CONSENSUS_LAST_UPLOAD, mark?.doneAt, uploadedAt]
    .map((t) => (t ? Date.parse(t) : NaN)).filter((t) => Number.isFinite(t));
  const last = new Date(Math.max(...times));
  const byAge = new Date(last.getTime() + CONSENSUS_EVERY_DAYS * DAY);
  const milestones = [...consensusMilestones(year - 1), ...consensusMilestones(year)]
    .filter((m) => m.at.getTime() > last.getTime());
  const next = milestones.find((m) => m.at.getTime() < byAge.getTime()) ?? null;
  const dueAt = next ? next.at : byAge;
  const ago = Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY));
  const why = next ? `after ${next.label}` : `${CONSENSUS_EVERY_DAYS} days after the last one`;
  return {
    key: "consensus_upload", cycle: "",
    title: "Upload the consensus big board",
    detail: "Re-upload the consensus big board CSV (the same source as Nov 5) on Big Board → Consensus board: its ranks are the projected picks Dynasty+ reads until the draft. Saving it counts as the upload; Mark done is for one made another way.",
    when: `${dayText(dueAt)}, ${why}`,
    state: now.getTime() >= dueAt.getTime() ? "due" : dueAt.getTime() - now.getTime() <= SOON_DAYS * DAY ? "soon" : "later",
    at: dueAt.getTime(),
    note: `Last upload ${dayText(last)} (${ago} ${ago === 1 ? "day" : "days"} ago). Due every ${CONSENSUS_EVERY_DAYS} days, or sooner at a milestone: declarations, Senior Bowl, combine, the week before the draft.`,
    mark: "done",
    done: null,
  };
}

// ── Dated checks ────────────────────────────────────────────

interface DatedSpec {
  key: string;
  cycle: string;
  title: string;
  detail: string;
  start: Date;
  end?: Date;
  mark?: "done" | "choice";
  choices?: readonly DueChoice[];
}

/** The Catapult call's choices. Either way the slow-tape conferences get charted from then on. */
export const CATAPULT_CHOICES: readonly DueChoice[] = [
  { value: "access", label: "Catapult has them" },
  { value: "no_access", label: "No access: chart the slower tape" },
];

/** The plan's dated checks for class `year`, and the HANDOFF's dated re-checks. */
function datedSpecs(year: number): DatedSpec[] {
  const season = year - 1;
  const draft = nflDraftDay(year);
  const specs: DatedSpec[] = [
    {
      key: "catapult", cycle: `${year}`, mark: "choice", choices: CATAPULT_CHOICES,
      title: "The Catapult call",
      detail: `Does Catapult have Big Ten, Big 12, FCS and Independents tape yet? If not, chart the slower tape. Either answer turns on those conferences in Chart Next for the ${year} class.`,
      start: new Date(year, 0, 1), end: new Date(year, 0, 7),
    },
    {
      key: "class_check", cycle: `${season}`,
      title: `The ${season} class check`,
      detail: `After NFL week 18: the ${season} class's draft-day snapshot against its rookie year (Draft History's outcome tiers; 50 WRs + 11 RBs). A reading, not a retune.`,
      start: new Date(year, 0, 5),
    },
    {
      key: "qb_cutoffs", cycle: `${season}`,
      title: `QB cutoffs on the full ${season} season`,
      detail: `Once the ${season} college season is over: PFF Links → Refresh QB stats, then re-check the QB rushing cut points (26 / 62 yds a game, set on 2024–25) and the middle-of-the-field cutoffs (20.5 / 17.7 / 24.1 / 28.3).`,
      start: new Date(year, 0, 21),
    },
    {
      key: "senior_bowl", cycle: `${year}`,
      title: "Senior Bowl measurements",
      detail: "Prospect Data → Measured sizes → Paste a list (source Senior Bowl, the weigh-in day). They replace the listed height and weight until the combine; the Shrine Bowl and other all-star games the same way.",
      start: new Date(year, 1, 2),
    },
    {
      key: "fill_40s", cycle: `${year}`,
      title: "Fill 40s",
      detail: "Prospect Data → Fill 40s, then Measured sizes → Read the combine, once the combine's out (nflverse). The 40 only counts pre-draft; the weigh-ins come with it, and the combine's height and weight outrank every other measurement.",
      start: new Date(year, 2, 2),
    },
    {
      key: "review_1", cycle: `${year}`,
      title: "Review part 1 (after the combine)",
      detail: "Speed-floor lines, the RB level lines (65 / 55), TE and QB role orders, the Generational count, the TE calls you flagged, and the TE season units (Grading checks → Season units, then SEASON_UNITS_ON with your OK).",
      start: new Date(year, 2, 5),
    },
    {
      key: "birthdays", cycle: `${year}-combine`,
      title: "Birthday refill (after the combine)",
      detail: "Prospect Data → Fill from PFF, then ask Claude for the Wikipedia birthday pass for the blanks.",
      start: new Date(year, 2, 9),
    },
    {
      key: "review_2", cycle: `${year}`,
      title: "Review part 2 + draft rehearsal",
      detail: "Before the draft (rookie drafts start the day after it): landing-spot values, QB prime 34, the capital tables; then rehearse draft night on the Big Board's Post-Draft tab.",
      start: new Date(year, 3, 1), end: new Date(draft.getTime() - 7 * DAY),
    },
    {
      key: "draft_week", cycle: `${year}`,
      title: "Draft week",
      detail: "Apply the picks each night (Post-Draft tab), load and save the NFL rooms soon after, the surprise picks on Saturday (Post-Draft → Surprise picks), then Load UDFA signings there over the next days. Then the board is done.",
      start: draft, end: new Date(draft.getTime() + 2 * DAY),
    },
    {
      key: "birthdays", cycle: `${year}-draft`,
      title: "Birthday refill (after the draft)",
      detail: "Prospect Data → Fill from PFF, then ask Claude for the Wikipedia birthday pass for the blanks.",
      start: new Date(draft.getTime() + 7 * DAY),
    },
  ];
  // One-time checks.
  if (year === 2027) {
    specs.push(
      {
        key: "league_renewal", cycle: "2027",
        title: "Sleeper league renewal (Management Hub)",
        detail: "Before the leagues renew (~Feb–Mar): Commissioner flag, Paid years, status, payments and bylaws are keyed by the old league id, so they vanish for a renewed league. Ask Claude for the carry-over (HANDOFF §23, \"Sleeper renewal time bomb\"); whether status and amount carry is your call.",
        start: new Date(2027, 0, 15),
      },
      {
        key: "post_curve", cycle: "2027",
        title: "After the draft: Dynasty+ → Post curve",
        detail: "May–Aug: build the Dynasty+ → Post curve and refill the 2026 class's Post grades from it; chart the 2025 validation set (the first ~10 WRs + 10 RBs drafted and ~6 TEs, 2–3 games each).",
        start: new Date(2027, 4, 4),
      },
    );
  }
  return specs;
}

/** The goal Chart Next tracks: OVR top 60 at a full sample, due by mid-Feb to early March. */
export interface GoalProgress {
  done: number;
  slots: number;
  ranked: number;
}

function goalItem(now: Date, year: number, goal: GoalProgress | null): DueItem {
  const start = new Date(year, 1, 15);
  const end = new Date(year, 2, 1);
  const met = goal != null && goal.ranked >= goal.slots && goal.done >= goal.slots;
  return {
    key: "top60_goal", cycle: `${year}`,
    title: `Top 60 at a full sample (${year})`,
    detail: "Scouting → Chart Next lists who's short and the tape in hand. Clears itself once all 60 have a full sample.",
    when: windowText(start, end),
    state: met ? "done" : datedState(start, now, false),
    at: start.getTime(),
    progress: goal ? { have: goal.done, need: goal.slots, unit: "done" } : null,
    mark: null,
    done: null,
  };
}

/**
 * The dated checks for the class being scouted at `now`, the consensus
 * upload, the top-60 goal and the Generational count, each with its mark.
 */
export function calendarItems(
  now: Date,
  marks: DueMarks,
  goal: GoalProgress | null,
  prospects: readonly Pick<Prospect, "name" | "draft_class_year" | "pre_draft_grade" | "consensus_at">[],
): DueItem[] {
  const year = scoutingClassYear(now);
  // The class flips in May, with draft-week checks still open: last class's
  // checks that came due and aren't marked stay on (from the day the list
  // started, so nothing from before it shows up as overdue).
  const carried = datedSpecs(year - 1).filter((s) =>
    s.start.getTime() >= DUE_LIST_START && s.start.getTime() <= now.getTime() && !marks.has(markKey(s.key, s.cycle)));
  const items: DueItem[] = [...carried, ...datedSpecs(year)].map((s) => {
    const done = marks.get(markKey(s.key, s.cycle)) ?? null;
    return {
      key: s.key, cycle: s.cycle, title: s.title, detail: s.detail,
      when: windowText(s.start, s.end),
      state: datedState(s.start, now, done != null),
      at: s.start.getTime(),
      mark: s.mark ?? "done", choices: s.choices, done,
    };
  });
  items.push(consensusItem(now, year, marks, latestConsensusAt(prospects)), goalItem(now, year, goal), generationalItem(prospects, marks));
  return items;
}

// ── Generational per class ──────────────────────────────────

/** Pre grade for Generational (prospectGrade.ts GRADE_TIERS, Dynasty +2.25). */
export const GENERATIONAL_MIN = GRADE_TIERS[0].min;
/** More than this many in one class and the count is flagged (my line; the user: "really hard to hit"). */
export const GENERATIONAL_WATCH_MAX = 2;

export function generationalByClass(
  prospects: readonly Pick<Prospect, "name" | "draft_class_year" | "pre_draft_grade">[],
): { year: number; names: string[] }[] {
  const by = new Map<number, { name: string; grade: number }[]>();
  for (const p of prospects) {
    const g = p.pre_draft_grade;
    if (g == null || g < GENERATIONAL_MIN) continue;
    const list = by.get(p.draft_class_year) ?? [];
    list.push({ name: p.name, grade: g });
    by.set(p.draft_class_year, list);
  }
  return [...by].sort((a, b) => a[0] - b[0])
    .map(([year, list]) => ({ year, names: list.sort((a, b) => b.grade - a.grade).map((x) => `${x.name} ${x.grade.toFixed(1)}`) }));
}

function generationalItem(
  prospects: readonly Pick<Prospect, "name" | "draft_class_year" | "pre_draft_grade">[],
  marks: DueMarks,
): DueItem {
  const classes = generationalByClass(prospects);
  const over = classes.filter((c) => c.names.length > GENERATIONAL_WATCH_MAX);
  // Marked per count, so a new name brings it back.
  const cycle = over.map((c) => `${c.year}:${c.names.length}`).join(",");
  const done = over.length ? marks.get(markKey("generational", cycle)) ?? null : null;
  return {
    key: "generational", cycle,
    title: "Generational count",
    detail: `Pre ${GENERATIONAL_MIN}+ (Dynasty +2.25). It should be really hard to hit; flagged past ${GENERATIONAL_WATCH_MAX} in one class.`,
    when: `more than ${GENERATIONAL_WATCH_MAX} in a class`,
    state: over.length === 0 ? "watch" : done ? "done" : "due",
    at: null,
    note: classes.length ? classes.map((c) => `${c.year}: ${c.names.join(", ")}`).join(" · ") : "No one at Generational yet.",
    mark: over.length ? "done" : null,
    done,
  };
}

// ── Data checks ─────────────────────────────────────────────

/** A sub-route goes on at this many routes even without a passing test (the user's rule, 2026-11-13). */
export const SUB_ROUTE_ON_AT = 500;
/** TE field time dials: hone after this many TE games charted since they were set (2026-10-21). */
export const TE_FIELD_TIME_GAMES = 30;
export const TE_FIELD_TIME_SINCE = "2026-10-21";
/** TE-SAER spread: τ was 0 on 2026-10-21; re-read it once this many TEs have this many rated routes. */
export const TE_SPREAD_TES = 10;
export const TE_SPREAD_ROUTES = 70;
/** The RB AE level shift (−0.2 → −0.1, 2026-11-22): re-check after the next batch of runs. */
export const RB_LEVEL_SINCE = "2026-11-22";
export const RB_LEVEL_RUNS = 300;
/** The provisional role scales: re-calibrate once this many players have the reps. */
export const ROLE_SCALE_PLAYERS = 10;
/** Double coverage: re-read its tag readiness once this many doubled routes are charted. */
export const DOUBLE_COVERAGE_ROUTES = 30;

export interface DueDataInputs {
  report: GradingReport;
  games: readonly { id: string; prospect_id: string; count_in_sample?: boolean }[];
  qbPlays: readonly Pick<QBPlay, "game_id" | "run_success">[];
  rbPlays: readonly Pick<RBPlay, "created_at" | "run_type" | "success">[];
  tePlays: readonly Pick<TEPlay, "game_id" | "created_at" | "play_type" | "was_open">[];
  routeTagCells: readonly ProspectGameRouteTagCellsRow[];
}

const RUN_SCHEMES = new Set(["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"]);

function threshold(
  base: Omit<DueItem, "state" | "at" | "mark" | "done" | "progress">,
  have: number, need: number, unit: string, marks: DueMarks,
): DueItem {
  const done = marks.get(markKey(base.key, base.cycle)) ?? null;
  return {
    ...base, at: null, mark: "done", done,
    progress: { have, need, unit },
    state: done ? "done" : have >= need ? "due" : "waiting",
  };
}

/** HANDOFF §23's re-checks that wait on a sample, read off the Grading report and the plays. */
export function dataItems(inp: DueDataInputs, marks: DueMarks): DueItem[] {
  const { report, games, qbPlays, rbPlays, tePlays, routeTagCells } = inp;
  const out: DueItem[] = [];
  const marked = (key: string, cycle: string) => marks.get(markKey(key, cycle)) ?? null;

  // Sub-routes at 500 routes, and a passing sub-route or tag test, per model.
  let closest: { label: string; reps: number } | null = null;
  for (const m of report.models) {
    const subTests = new Map(m.subRouteTests.map((t) => [t.column, t]));
    for (const r of m.subRoutes) {
      if (r.enabled) continue;
      if (r.reps >= SUB_ROUTE_ON_AT) {
        const cycle = `${m.key}:${r.id}`;
        const done = marked("sub_route_500", cycle);
        out.push({
          key: "sub_route_500", cycle, title: `${m.label}: switch on ${r.label}`,
          detail: `${Math.round(r.reps)} routes: at ${SUB_ROUTE_ON_AT} a sub-route goes on even without a passing test (your rule); its test is reported, not a gate. Ask Claude to switch it on.`,
          when: `at ${SUB_ROUTE_ON_AT} routes`, state: done ? "done" : "due", at: null, mark: "done", done,
          progress: { have: Math.round(r.reps), need: SUB_ROUTE_ON_AT, unit: "routes" },
        });
      } else {
        if (!closest || r.reps > closest.reps) closest = { label: `${m.label} ${r.label}`, reps: r.reps };
        const t = subTests.get(r.id);
        if (t?.improves) {
          const cycle = `${m.key}:${r.id}`;
          const done = marked("sub_route_test", cycle);
          out.push({
            key: "sub_route_test", cycle, title: `${m.label}: ${r.label} passes its test`,
            detail: `Held-out loss ${t.baseLoss.toFixed(4)} → ${t.withLoss.toFixed(4)} (${t.foldsBetter}/${t.foldsRun} folds). It can go on before ${SUB_ROUTE_ON_AT} routes, with your OK. Mark it done to keep it off.`,
            when: "when its test passes", state: done ? "done" : "due", at: null, mark: "done", done,
          });
        }
      }
    }
    const tests = new Map(m.tests.map((t) => [t.column, t]));
    for (const r of m.readiness) {
      const t = tests.get(r.column);
      if (r.enabled || !t?.improves) continue;
      const cycle = `${m.key}:${r.column}`;
      const done = marked("tag_test", cycle);
      out.push({
        key: "tag_test", cycle, title: `${m.label}: the ${r.label} tag passes its test`,
        detail: `Held-out loss ${t.baseLoss.toFixed(4)} → ${t.withLoss.toFixed(4)}. Switch it on (ENABLED_TAG_CORRECTIONS) with your OK; mark it done to keep it off.`,
        when: "when its test passes", state: done ? "done" : "due", at: null, mark: "done", done,
      });
    }
    if (m.garbage.best != null && m.garbage.best !== m.garbageWeight) {
      const done = marked("garbage_weight", m.key);
      out.push({
        key: "garbage_weight", cycle: m.key, title: `${m.label}: garbage-time weight`,
        detail: `Its test's best weight is ${m.garbage.best}; ${m.garbageWeight} is in use (GARBAGE_TIME_WEIGHT). Change it with your OK, or mark it done to leave it.`,
        when: "when testable", state: done ? "done" : "due", at: null, mark: "done", done,
      });
    }
    if (m.drift.flagged && !m.recentered) {
      const done = marked("era_drift", m.key);
      out.push({
        key: "era_drift", cycle: m.key, title: `${m.label}: tagged plays drifted`,
        detail: "The tagged era sits beyond 2 SE of the in-app one (Era scale check below). Re-center it (RECENTER_TAGGED) with your OK.",
        when: "when the era check flags it", state: done ? "done" : "due", at: null, mark: "done", done,
      });
    }
  }
  if (closest) {
    out.push({
      key: "sub_route_next", cycle: "", title: "Next sub-route to 500",
      detail: `The closest still-pooled sub-route: ${closest.label}. Every sub-route goes on at ${SUB_ROUTE_ON_AT} routes.`,
      when: `at ${SUB_ROUTE_ON_AT} routes`, state: "waiting", at: null, mark: null,
      progress: { have: Math.round(closest.reps), need: SUB_ROUTE_ON_AT, unit: "routes" },
    });
  }

  // Double coverage: the tag's routes on the WR and TE route models.
  const doubled = report.models.reduce((s, m) =>
    s + (m.readiness.find((r) => r.column === "double_coverage")?.onPlays.on ?? 0), 0);
  out.push(threshold({
    key: "double_coverage", cycle: "",
    title: "Re-read double coverage",
    detail: "The WR and TE route models count the tag from the first doubled route; re-read its row in Difficulty tags below once there are enough.",
    when: `at ${DOUBLE_COVERAGE_ROUTES} doubled routes`,
  }, doubled, DOUBLE_COVERAGE_ROUTES, "doubled routes", marks));

  // TE field time: TE games with a play saved since the dials were set.
  const teSince = Date.parse(`${TE_FIELD_TIME_SINCE}T00:00:00Z`);
  const teGames = new Set(tePlays.filter((pl) => Date.parse(pl.created_at) >= teSince).map((pl) => pl.game_id)).size;
  out.push(threshold({
    key: "te_field_time", cycle: TE_FIELD_TIME_SINCE,
    title: "Hone the TE field time dials",
    detail: "TE_FIELD_TIME (fieldTime.ts) was set on Oct 21, 2026; hone it once there are 30–40 more TE games.",
    when: `at ${TE_FIELD_TIME_GAMES} TE games since Oct 21, 2026`,
  }, teGames, TE_FIELD_TIME_GAMES, "TE games", marks));

  // TE-SAER spread: TEs with enough rated routes in their sample (sampleGames.ts).
  const prospectOf = sampleGameToProspect(games);
  const rated = new Map<string, number>();
  for (const pl of tePlays) {
    if (pl.play_type !== "route_run" || pl.was_open == null) continue;
    const id = prospectOf.get(pl.game_id);
    if (id) rated.set(id, (rated.get(id) ?? 0) + 1);
  }
  out.push(threshold({
    key: "te_spread", cycle: "",
    title: "Re-read the TE spread",
    detail: "TE-SAER / TE-SAEB's spread (τ) was 0 on Oct 21, 2026. Re-read it on the Big Board's status line once enough TEs have the routes.",
    when: `at ${TE_SPREAD_TES} TEs with ${TE_SPREAD_ROUTES}+ rated routes`,
  }, [...rated.values()].filter((n) => n >= TE_SPREAD_ROUTES).length, TE_SPREAD_TES, "TEs", marks));

  // RB level shift: known runs saved since the change.
  const rbSince = Date.parse(`${RB_LEVEL_SINCE}T00:00:00Z`);
  const rbRuns = rbPlays.filter((pl) => RUN_SCHEMES.has(pl.run_type) && pl.success != null && Date.parse(pl.created_at) >= rbSince).length;
  out.push(threshold({
    key: "rb_level", cycle: RB_LEVEL_SINCE,
    title: "Re-check the RB level shift",
    detail: "RB AE's level moved −0.2 → −0.1 on Nov 22, 2026. Re-check Keyjuan Brown against the 2.25 line (2.19 at the change) and the 2027 top-34 RB count (10 then).",
    when: `after ${RB_LEVEL_RUNS} RB runs since Nov 22, 2026`,
  }, rbRuns, RB_LEVEL_RUNS, "runs", marks));

  // Provisional role scales.
  const qbRuns = new Map<string, number>();
  for (const pl of qbPlays) {
    if (pl.run_success == null) continue;
    const id = prospectOf.get(pl.game_id);
    if (id) qbRuns.set(id, (qbRuns.get(id) ?? 0) + 1);
  }
  out.push(threshold({
    key: "qb_run_scale", cycle: "",
    title: "Re-calibrate the QB run-success scale",
    detail: "The Dual-threat role's tagged run success scale (roleFitQB.ts runSucc 8) is provisional: set before any tagged QB runs existed.",
    when: `at ${ROLE_SCALE_PLAYERS} QBs with ${QB_RUN_TAG_MIN}+ tagged runs`,
  }, [...qbRuns.values()].filter((n) => n >= QB_RUN_TAG_MIN).length, ROLE_SCALE_PLAYERS, "QBs", marks));

  const release = releaseByProspect(routeTagCells).byProspect;
  out.push(threshold({
    key: "wr_release_scale", cycle: "",
    title: "Re-calibrate the WR release scale",
    detail: "X's release-vs-press scale (roleFitWR.ts release 10) is provisional: set before any tagged press reps existed.",
    when: `at ${ROLE_SCALE_PLAYERS} WRs with ${X_RELEASE_REPS}+ tagged press reps`,
  }, [...release.values()].filter((r) => r.n >= X_RELEASE_REPS).length, ROLE_SCALE_PLAYERS, "WRs", marks));

  return out;
}

// ── The list ────────────────────────────────────────────────

const STATE_ORDER: Record<DueState, number> = { due: 0, soon: 1, waiting: 2, later: 3, watch: 4, done: 5 };

/** Due first (soonest date first), then coming up, waiting (closest first), later, watch, done (latest first). */
export function sortDue(items: readonly DueItem[]): DueItem[] {
  const ratio = (i: DueItem) => (i.progress && i.progress.need > 0 ? i.progress.have / i.progress.need : 0);
  return [...items].sort((a, b) => {
    const s = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (s) return s;
    if (a.state === "done") return Date.parse(b.done?.doneAt ?? "") - Date.parse(a.done?.doneAt ?? "") || 0;
    if (a.state === "waiting") return ratio(b) - ratio(a);
    return (a.at ?? Infinity) - (b.at ?? Infinity) || a.title.localeCompare(b.title);
  });
}

/** Whether Chart Next shows the slow-tape conferences for `year` (the Catapult call is made). */
export function slowTapeOpen(marks: DueMarks | null, year: number): boolean {
  return marks?.has(markKey("catapult", `${year}`)) ?? false;
}
