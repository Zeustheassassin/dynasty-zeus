// ============================================================
// The numbers on a prospect's Overview page (the report's top page), per
// position, and where each one ranks among every prospect at his position.
// ============================================================
// Two kinds of number, never labelled on the page (only the tooltip says which,
// by the user's call 2026-10-06):
//   - the user's charting makes the win / loss calls: open rate vs coverage
//     (WR / TE), run success by scheme (RB), on-target rate (QB), block wins;
//   - box-score numbers PFF also counts (targets, catches, drops, YPRR, aDOT,
//     contested catches, ...) come from PFF over exactly the charted games
//     (lib/pff/totals.ts pffValues), so they match PFF. Without PFF stats the
//     charted count stands in where one exists.
// Definitions match the boards and the Analysis tables: QB graded throws are
// thrown balls with accuracy charted, tipped excluded; RB runs are designed
// carries; press is folded into man, as on the boards. Pure.
// ============================================================

import type { ProspectWithStats, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../types";
import type { PffValues } from "../pff/totals";

export type OverviewFmt = "pct0" | "pct1" | "dec1" | "dec2" | "int" | "text";
/** Which bar colour: the user's charting or PFF. */
export type OverviewTone = "chart" | "pff";

export interface OverviewStat {
  key: string;
  label: string;
  /** Small text after the label, e.g. "(incl. press)". */
  note?: string;
  value: number | null;
  fmt: OverviewFmt;
  /** Shown after the number, e.g. " Y/C". */
  unit?: string;
  /** For fmt "text": the whole value as written. */
  text?: string;
  /** The line under the number, e.g. "84 / 146". */
  detail?: string;
  /** Bar length 0–100; none = no bar. */
  bar?: number | null;
  tone: OverviewTone;
  /** 1 = higher is better, −1 = lower is better, 0 = describes (no percentile). */
  dir: 1 | -1 | 0;
  /** The sample behind the number, and the least it needs to be ranked. */
  n: number;
  minN: number;
  /** Where the number comes from and how it's counted. */
  tooltip: string;
}

export interface OverviewSection {
  key: string;
  /** null = continues the section above it (a second row, no heading). */
  title: string | null;
  /** "lg" / "md" / "sm" = number tiles, biggest first; "list" = label-and-number rows. */
  size: "lg" | "md" | "sm" | "list";
  stats: OverviewStat[];
}

export interface OverviewPage {
  /** Header facts: "9 games", "486 snaps", ... */
  meta: string[];
  /** Full-width sections, top to bottom. */
  main: OverviewSection[];
  /** The band of narrow sections at the bottom. */
  columns: OverviewSection[];
}

/** How many of his charted games PFF stats cover (for the tooltips). */
export interface PffCover { games: number; charted: number }

/** "1 game", "9 games". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const pctOf = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
const clampBar = (v: number | null) => (v == null ? null : Math.max(0, Math.min(100, v)));

interface RateOpts {
  tone: OverviewTone;
  dir: 1 | -1 | 0;
  minN: number;
  tooltip: string;
  note?: string;
  fmt?: "pct0" | "pct1";
  detail?: string;
}
/** A share: num ÷ den as a percent, with "num / den" under it. */
function rate(key: string, label: string, num: number, den: number, o: RateOpts): OverviewStat {
  const value = pctOf(num, den);
  return {
    key, label, note: o.note, value, fmt: o.fmt ?? "pct0",
    detail: den > 0 ? (o.detail ?? `${num} / ${den}`) : undefined,
    bar: clampBar(value), tone: o.tone, dir: o.dir, n: den, minN: o.minN, tooltip: o.tooltip,
  };
}

interface MetricOpts {
  tone: OverviewTone;
  dir: 1 | -1 | 0;
  minN: number;
  n: number;
  tooltip: string;
  detail?: string;
  unit?: string;
  /** Value at a full bar; none = no bar. */
  barMax?: number;
}
/** A number that isn't a share (YPRR, aDOT, a grade). */
function metric(key: string, label: string, value: number | null, fmt: OverviewFmt, o: MetricOpts): OverviewStat {
  return {
    key, label, value, fmt, unit: o.unit, detail: value == null ? undefined : o.detail,
    bar: o.barMax != null && value != null ? clampBar((value / o.barMax) * 100) : undefined,
    tone: o.tone, dir: o.dir, n: o.n, minN: o.minN, tooltip: o.tooltip,
  };
}

const num = (pff: PffValues, k: string): number => pff[k] ?? 0;
const hasPff = (pff: PffValues) => (pff.pff_g ?? 0) > 0;

/** "PFF, over the 9 charted games" / "PFF, over 7 of his 9 charted games". */
export function pffSource(cover: PffCover | null): string {
  if (!cover || cover.games === 0) return "PFF";
  const g = cover.games === cover.charted
    ? `the ${cover.games} charted game${cover.games === 1 ? "" : "s"}`
    : `${cover.games} of his ${cover.charted} charted games (the rest aren't linked or imported)`;
  return `PFF, over ${g}`;
}
const CHARTED = "Your charting";
const NO_PFF = "Your charting (no PFF stats imported for his games)";

// ── WR ───────────────────────────────────────────────────────

export function wrOverview(p: ProspectWithStats, pff: PffValues, cover: PffCover | null): OverviewPage {
  const PFF = pffSource(cover);
  const cv = p.coverage_stats;
  const open = p.has_charted_open_data;
  const cov = (key: string, label: string, s: { count: number; open: number }, minN: number, note?: string) =>
    rate(key, label, open ? s.open : 0, open ? s.count : 0, {
      tone: "chart", dir: 1, minN, note,
      tooltip: `${CHARTED}: routes against ${label.toLowerCase()}${note ? " or press" : ""} coverage where he got open, all charted games.`,
    });
  const man = { count: cv.man.count + cv.press.count, open: cv.man.open + cv.press.open };

  const target: OverviewStat[] = hasPff(pff)
    ? [
      rate("tprr", "Routes targeted", num(pff, "pff_tgt"), num(pff, "pff_routes"), { tone: "pff", dir: 1, minN: 50, fmt: "pct1", tooltip: `${PFF}: targets ÷ routes run.` }),
      rate("rprr", "Routes w/ catch", num(pff, "pff_rec"), num(pff, "pff_routes"), { tone: "pff", dir: 1, minN: 50, fmt: "pct1", tooltip: `${PFF}: catches ÷ routes run.` }),
      rate("catch", "Catch rate", num(pff, "pff_rec"), num(pff, "pff_tgt"), { tone: "pff", dir: 1, minN: 15, fmt: "pct1", tooltip: `${PFF}: catches ÷ targets.` }),
      rate("drop", "Drop rate", num(pff, "pff_drops"), num(pff, "pff_catchable"), { tone: "pff", dir: -1, minN: 15, fmt: "pct1", detail: `${num(pff, "pff_drops")} / ${num(pff, "pff_catchable")} catchable`, tooltip: `${PFF}: drops ÷ (catches + drops).` }),
      metric("yprr", "Yards / route", pff.pff_yprr ?? null, "dec2", { tone: "pff", dir: 1, minN: 50, n: num(pff, "pff_routes"), barMax: 4, detail: `${num(pff, "pff_recyds")} yds / ${num(pff, "pff_routes")}`, tooltip: `${PFF}: receiving yards ÷ routes run.` }),
      metric("adot", "aDOT", pff.pff_radot ?? null, "dec1", { tone: "pff", dir: 0, minN: 0, n: num(pff, "pff_tgt"), barMax: 25, detail: "yards downfield per target", tooltip: `${PFF}: average depth of target.` }),
    ]
    : [
      rate("tprr", "Routes targeted", p.targets, p.total_routes, { tone: "chart", dir: 1, minN: 50, fmt: "pct1", tooltip: `${NO_PFF}: targets ÷ routes.` }),
      rate("rprr", "Routes w/ catch", p.catches, p.total_routes, { tone: "chart", dir: 1, minN: 50, fmt: "pct1", tooltip: `${NO_PFF}: catches ÷ routes.` }),
      rate("catch", "Catch rate", p.catches, p.targets, { tone: "chart", dir: 1, minN: 15, fmt: "pct1", tooltip: `${NO_PFF}: catches ÷ targets.` }),
      rate("drop", "Drop rate", p.drops, p.catches + p.drops, { tone: "chart", dir: -1, minN: 15, fmt: "pct1", detail: `${p.drops} / ${p.catches + p.drops} catchable`, tooltip: `${NO_PFF}: drops ÷ (catches + drops).` }),
    ];

  const columns: OverviewSection[] = [];
  const lu = p.lined_up;
  if (lu && lu.snaps > 0) {
    const share = (key: string, label: string, n: number) =>
      rate(key, label, n, lu.snaps, { tone: "chart", dir: 0, minN: 0, tooltip: `${CHARTED}, games charted in the app: share of his snaps, runs included.` });
    columns.push({
      key: "aligned", title: "Aligned", size: "list", stats: [
        share("al_left", "Outside left", lu.left_on + lu.left_off),
        share("al_right", "Outside right", lu.right_on + lu.right_off),
        share("al_slot", "Slot", lu.slot_on + lu.slot_off),
        share("al_bf", "Backfield", lu.backfield),
      ],
    });
    const on = lu.slot_on + lu.left_on + lu.right_on;
    columns.push({
      key: "depth", title: "Depth", size: "list", stats: [
        share("dp_on", "On the LOS", on),
        share("dp_off", "Off the LOS", lu.snaps - on),
      ],
    });
  } else if (pff.pff_wide_pct != null || pff.pff_slot_pct != null) {
    // Only imported games: their alignment isn't a per-play record, so PFF's.
    const share = (key: string, label: string, k: string) =>
      metric(key, label, pff[k] ?? null, "pct0", { tone: "pff", dir: 0, minN: 0, n: num(pff, "pff_align_n"), barMax: 100, tooltip: `${PFF}: share of his snaps (no games charted in the app to say where he lined up).` });
    columns.push({ key: "aligned", title: "Aligned", size: "list", stats: [share("al_wide", "Wide", "pff_wide_pct"), share("al_slot", "Slot", "pff_slot_pct")] });
  }
  columns.push({
    key: "contested", title: "Contested catch", size: "md", stats: [
      hasPff(pff)
        ? rate("cc", "Conversion rate", num(pff, "pff_crec"), num(pff, "pff_ctgt"), { tone: "pff", dir: 1, minN: 6, tooltip: `${PFF}: contested catches ÷ contested targets.` })
        : rate("cc", "Conversion rate", p.contested_catches, p.contested, { tone: "chart", dir: 1, minN: 6, tooltip: `${NO_PFF}: contested catches ÷ contested targets.` }),
    ],
  });

  return {
    meta: [count(p.total_games, "game"), count(p.total_snaps, "snap"), count(p.total_routes, "route")],
    main: [
      {
        key: "coverage", title: "Winning routes · open rate vs coverage", size: "lg", stats: [
          cov("cv_man", "Man", man, 15, "(incl. press)"),
          cov("cv_zone", "Zone", cv.zone, 15),
          cov("cv_press", "Press", cv.press, 10),
          cov("cv_double", "Double", cv.double, 10),
        ],
      },
      { key: "targets", title: "Target data", size: "md", stats: target },
    ],
    columns,
  };
}

// ── QB ───────────────────────────────────────────────────────

const isThrown = (pl: QBPlay) =>
  pl.play_type !== "run" && pl.timing !== "scramble" && pl.timing !== "sack" && pl.timing !== "throw_away";

export function qbOverview(plays: readonly QBPlay[], pff: PffValues, cover: PffCover | null, games: number): OverviewPage {
  const PFF = pffSource(cover);
  const graded = plays.filter((pl) => isThrown(pl) && pl.accuracy != null && pl.accuracy !== "tipped_ball");
  const onTgt = (list: readonly QBPlay[], key: string, label: string, minN: number, what: string) =>
    rate(key, label, list.filter((pl) => pl.accuracy === "on_target").length, list.length, {
      tone: "chart", dir: 1, minN,
      tooltip: `${CHARTED}: ${what} on target, of graded throws (accuracy charted, tipped balls left out).`,
    });
  const depth = (prefix: string) => graded.filter((pl) => pl.depth_zone?.startsWith(prefix));
  const pressured = graded.filter((pl) => pl.pressure && pl.pressure !== "clean");

  const main: OverviewSection[] = [
    {
      key: "accuracy", title: "Accuracy · on-target rate", size: "lg", stats: [
        onTgt(graded, "ot_all", "All throws", 50, "throws"),
        onTgt(depth("short_"), "ot_short", "Short · under 10", 20, "throws under 10 yards"),
        onTgt(depth("mid_"), "ot_mid", "Intermediate · 10–20", 15, "throws of 10–20 yards"),
        onTgt(depth("deep_"), "ot_deep", "Deep · 20+", 10, "throws of 20+ yards"),
      ],
    },
    {
      key: "accuracy2", title: null, size: "md", stats: [
        onTgt(graded.filter((pl) => pl.coverage === "man"), "ot_man", "vs Man", 20, "throws against man coverage"),
        onTgt(graded.filter((pl) => pl.coverage === "zone"), "ot_zone", "vs Zone", 20, "throws against zone coverage"),
        onTgt(graded.filter((pl) => pl.pressure === "clean"), "ot_clean", "Clean pocket", 20, "throws from a clean pocket"),
        onTgt(pressured, "ot_pressured", "Pressured", 10, "throws under pressure"),
      ],
    },
  ];
  if (hasPff(pff)) {
    main.push({
      key: "passing", title: "Passing", size: "md", stats: [
        metric("adj", "Adj. completion", pff.pff_adj ?? null, "pct1", { tone: "pff", dir: 1, minN: 50, n: num(pff, "pff_aimed"), detail: `${num(pff, "pff_cmp") + num(pff, "pff_rdrops")} / ${num(pff, "pff_aimed")} aimed`, tooltip: `${PFF}: (completions + drops) ÷ aimed passes.` }),
        rate("btt", "Big-time throw %", num(pff, "pff_btt"), num(pff, "pff_all_att"), { tone: "pff", dir: 1, minN: 50, fmt: "pct1", tooltip: `${PFF}: big-time throws ÷ attempts.` }),
        rate("twp", "Turnover-worthy %", num(pff, "pff_twp"), num(pff, "pff_all_db"), { tone: "pff", dir: -1, minN: 50, fmt: "pct1", detail: `${num(pff, "pff_twp")} / ${num(pff, "pff_all_db")} dropbacks`, tooltip: `${PFF}: turnover-worthy plays ÷ dropbacks.` }),
        metric("padot", "aDOT", pff.pff_padot ?? null, "dec1", { tone: "pff", dir: 0, minN: 0, n: num(pff, "pff_att"), detail: "yards downfield per attempt", tooltip: `${PFF}: average depth of target.` }),
        metric("ttt", "Time to throw", pff.pff_ttt ?? null, "dec2", { tone: "pff", dir: 0, minN: 0, n: num(pff, "pff_db"), unit: "s", detail: "average per dropback", tooltip: `${PFF}: average time to throw, seconds.` }),
        rate("p2s", "Pressure → sack", num(pff, "pff_sk"), num(pff, "pff_prf"), { tone: "pff", dir: -1, minN: 15, fmt: "pct1", detail: `${num(pff, "pff_sk")} / ${num(pff, "pff_prf")} pressures`, tooltip: `${PFF}: sacks ÷ pressured dropbacks.` }),
      ],
    });
  }

  const plat = (key: string, label: string, list: readonly QBPlay[]) => {
    const ot = list.filter((pl) => pl.accuracy === "on_target").length;
    return rate(key, label, ot, list.length, { tone: "chart", dir: 1, minN: 10, detail: `on target · ${ot} / ${list.length}`, tooltip: `${CHARTED}: graded throws on target, by platform.` });
  };
  const columns: OverviewSection[] = [
    {
      key: "platform", title: "Platform", size: "list", stats: [
        plat("pl_on", "On platform", graded.filter((pl) => pl.platform === "on_platform")),
        plat("pl_off", "Off platform", graded.filter((pl) => pl.platform === "off_platform")),
        plat("pl_run", "On the run", graded.filter((pl) => pl.platform === "on_the_run")),
      ],
    },
  ];
  if (hasPff(pff)) {
    columns.push({
      key: "pressure", title: "Under pressure", size: "list", stats: [
        rate("pr_rate", "Pressured dropbacks", num(pff, "pff_prf"), num(pff, "pff_db"), { tone: "pff", dir: 0, minN: 0, tooltip: `${PFF}: dropbacks under pressure.` }),
        rate("sk_rate", "Sack rate", num(pff, "pff_sk"), num(pff, "pff_db"), { tone: "pff", dir: -1, minN: 50, fmt: "pct1", tooltip: `${PFF}: sacks ÷ dropbacks.` }),
        metric("blz_adj", "Blitzed, adj. completion", pff.pff_blz_adj ?? null, "pct1", { tone: "pff", dir: 1, minN: 20, n: num(pff, "pff_blz_aimed"), barMax: 100, detail: `${num(pff, "pff_blz_aimed")} aimed when blitzed`, tooltip: `${PFF}: adjusted completion % when the defense blitzed.` }),
      ],
    });
  }
  const tagged = plays.filter((pl) => pl.run_success != null);
  const rushing: OverviewStat[] = [];
  if (hasPff(pff) && num(pff, "pff_dsgn") > 0) {
    rushing.push(metric("dsgn_ypc", "Designed runs", num(pff, "pff_dsgn_yds") / num(pff, "pff_dsgn"), "dec1", { tone: "pff", dir: 1, minN: 15, n: num(pff, "pff_dsgn"), unit: " Y/C", detail: `${num(pff, "pff_dsgn_yds")} yds on ${num(pff, "pff_dsgn")}`, tooltip: `${PFF}: yards per designed run.` }));
  }
  if (hasPff(pff) && num(pff, "pff_scr") > 0) {
    rushing.push(metric("scr_ypc", "Scrambles", num(pff, "pff_scr_yds") / num(pff, "pff_scr"), "dec1", { tone: "pff", dir: 1, minN: 10, n: num(pff, "pff_scr"), unit: " Y/C", detail: `${num(pff, "pff_scr_yds")} yds on ${num(pff, "pff_scr")}`, tooltip: `${PFF}: yards per scramble.` }));
  }
  if (tagged.length > 0) {
    const won = tagged.filter((pl) => pl.run_success === true).length;
    rushing.push(rate("run_succ", "Run success", won, tagged.length, { tone: "chart", dir: 1, minN: 10, detail: `${won} / ${tagged.length} tagged runs`, tooltip: `${CHARTED}: designed runs and scrambles marked a success (tagged games only).` }));
  }
  if (rushing.length) columns.push({ key: "rushing", title: "Rushing", size: "list", stats: rushing });

  return { meta: [count(games, "game"), count(plays.length, "play"), count(graded.length, "graded throw")], main, columns };
}

// ── RB ───────────────────────────────────────────────────────

/** A designed carry: not a block, decoy or route (same as the RB board). */
export const isRBRun = (p: RBPlay): boolean =>
  p.run_type !== "pass_block" && p.run_type !== "run_block" && p.run_type !== "decoy" && p.run_type !== "route";

export function rbOverview(plays: readonly RBPlay[], pff: PffValues, cover: PffCover | null, games: number): OverviewPage {
  const PFF = pffSource(cover);
  const runs = plays.filter(isRBRun);
  const scheme = (key: string, label: string, type: RBPlay["run_type"]) => {
    const list = runs.filter((pl) => pl.run_type === type);
    return rate(key, label, list.filter((pl) => pl.success === true).length, list.length, { tone: "chart", dir: 1, minN: 10, tooltip: `${CHARTED}: ${label.toLowerCase()} runs marked a success.` });
  };
  const flag = (key: string, label: string, hit: (pl: RBPlay) => boolean, dir: 1 | -1, what: string) =>
    rate(key, label, runs.filter(hit).length, runs.length, { tone: "chart", dir, minN: 25, tooltip: `${CHARTED}: carries ${what}, of all carries.` });

  const main: OverviewSection[] = [
    {
      key: "schemes", title: "Winning runs · success rate by scheme", size: "lg", stats: [
        scheme("sr_iz", "Inside zone", "inside_zone"),
        scheme("sr_oz", "Outside zone", "outside_zone"),
        scheme("sr_ig", "Inside gap", "inside_man_gap"),
        scheme("sr_og", "Outside gap", "outside_man_gap"),
      ],
    },
    {
      key: "runflags", title: null, size: "md", stats: [
        rate("sr_all", "All runs", runs.filter((pl) => pl.success === true).length, runs.length, { tone: "chart", dir: 1, minN: 25, tooltip: `${CHARTED}: carries marked a success.` }),
        // Broken tackles and explosive runs come from PFF since 2026-10-07 (Rushing below).
        flag("stuffed", "Stuffed", (pl) => pl.run_stuff, -1, "stuffed"),
      ],
    },
  ];
  if (hasPff(pff)) {
    const car = num(pff, "pff_car");
    const rushing: OverviewStat[] = [
      metric("ypc", "Yards / carry", pff.pff_ypc ?? null, "dec1", { tone: "pff", dir: 1, minN: 25, n: car, detail: `${num(pff, "pff_ryds")} yds / ${car}`, tooltip: `${PFF}: rushing yards ÷ carries.` }),
      metric("yco", "After contact / carry", pff.pff_yco_a ?? null, "dec2", { tone: "pff", dir: 1, minN: 25, n: car, detail: `${car} carries`, tooltip: `${PFF}: yards after contact ÷ carries.` }),
      metric("mtf", "Missed tackles / carry", pff.pff_mtf_a ?? null, "dec2", { tone: "pff", dir: 1, minN: 25, n: car, detail: `${num(pff, "pff_rmtf")} / ${car}`, tooltip: `${PFF}: avoided tackles as a runner ÷ carries.` }),
      rate("r10", "10+ yard runs", num(pff, "pff_10p"), car, { tone: "pff", dir: 1, minN: 25, fmt: "pct1", tooltip: `${PFF}: carries of 10+ yards (explosive runs).` }),
      rate("r15", "15+ yard runs", num(pff, "pff_15p"), car, { tone: "pff", dir: 1, minN: 25, fmt: "pct1", tooltip: `${PFF}: carries of 15+ yards.` }),
      rate("fum", "Fumbles", num(pff, "pff_fum"), num(pff, "pff_touches"), { tone: "pff", dir: -1, minN: 25, fmt: "pct1", detail: `${num(pff, "pff_fum")} / ${num(pff, "pff_touches")} touches`, tooltip: `${PFF}: fumbles ÷ touches (carries + catches).` }),
    ];
    const gap = pff.pff_gap_pct;
    if (gap != null) {
      rushing.push({ ...metric("zone_gap", "Zone / gap", null, "text", { tone: "pff", dir: 0, minN: 0, n: car, tooltip: `${PFF}: share of his runs by blocking scheme.` }), text: `${Math.round(100 - gap)} / ${Math.round(gap)}`, detail: "share of his runs" });
    }
    main.push({ key: "rushing", title: "Rushing", size: "md", stats: rushing });
  }

  const routes = plays.filter((pl) => pl.run_type === "route");
  const receiving: OverviewStat[] = hasPff(pff)
    ? [
      rate("rb_tprr", "Routes targeted", num(pff, "pff_tgt"), num(pff, "pff_routes"), { tone: "pff", dir: 1, minN: 30, tooltip: `${PFF}: targets ÷ routes run.` }),
      metric("rb_yprr", "Yards / route", pff.pff_yprr ?? null, "dec2", { tone: "pff", dir: 1, minN: 30, n: num(pff, "pff_routes"), detail: `${num(pff, "pff_recyds")} yds / ${num(pff, "pff_routes")}`, tooltip: `${PFF}: receiving yards ÷ routes run.` }),
      rate("rb_drop", "Drop rate", num(pff, "pff_drops"), num(pff, "pff_catchable"), { tone: "pff", dir: -1, minN: 10, fmt: "pct1", detail: `${num(pff, "pff_drops")} / ${num(pff, "pff_catchable")} catchable`, tooltip: `${PFF}: drops ÷ (catches + drops).` }),
    ]
    : [
      rate("rb_tprr", "Routes targeted", routes.filter((pl) => pl.targeted).length, routes.length, { tone: "chart", dir: 1, minN: 30, tooltip: `${NO_PFF}: targets ÷ routes.` }),
    ];
  receiving.push(rate("rb_open", "Got open", routes.filter((pl) => pl.was_open).length, routes.length, { tone: "chart", dir: 1, minN: 15, detail: `${routes.filter((pl) => pl.was_open).length} / ${routes.length} routes`, tooltip: `${CHARTED}: routes where he got open.` }));

  const passBlocks = plays.filter((pl) => pl.run_type === "pass_block");
  const passPro: OverviewStat[] = [
    rate("pb_won", "Block won", passBlocks.filter((pl) => pl.success === true).length, passBlocks.length, { tone: "chart", dir: 1, minN: 10, tooltip: `${CHARTED}: pass-block reps marked a win.` }),
  ];
  if (hasPff(pff)) {
    passPro.push(rate("pb_pr", "Pressures allowed", num(pff, "pff_pr_allowed"), num(pff, "pff_pblk"), { tone: "pff", dir: -1, minN: 20, fmt: "pct1", detail: `${num(pff, "pff_pr_allowed")} / ${num(pff, "pff_pblk")} pass-block snaps`, tooltip: `${PFF}: pressures allowed ÷ pass-block snaps.` }));
  }
  const usage = (key: string, label: string, hit: (pl: RBPlay) => boolean, what: string) =>
    rate(key, label, runs.filter(hit).length, runs.length, { tone: "chart", dir: 0, minN: 0, detail: `${runs.filter(hit).length} / ${runs.length} runs`, tooltip: `${CHARTED}: carries ${what}.` });

  return {
    meta: [count(games, "game"), count(plays.length, "snap"), count(runs.length, "carry", "carries")],
    main,
    columns: [
      { key: "receiving", title: "Receiving", size: "list", stats: receiving },
      { key: "passpro", title: "Pass pro", size: "list", stats: passPro },
      {
        key: "usage", title: "Usage", size: "list", stats: [
          usage("u_gun", "Shotgun", (pl) => pl.formation === "gun", "from the shotgun"),
          usage("u_uc", "Under center", (pl) => pl.formation === "under_center", "with the QB under center"),
          usage("u_box", "Loaded box", (pl) => pl.loaded_box, "into a loaded box"),
        ],
      },
    ],
  };
}

// ── TE ───────────────────────────────────────────────────────

export function teOverview(plays: readonly TEPlay[], pff: PffValues, cover: PffCover | null, games: number): OverviewPage {
  const PFF = pffSource(cover);
  const routes = plays.filter((pl) => pl.play_type === "route_run");
  const blocks = plays.filter((pl) => pl.play_type === "run_block" || pl.play_type === "pass_block");
  const cov = (key: string, label: string, hit: (pl: TEPlay) => boolean, minN: number, note?: string) => {
    const list = routes.filter(hit);
    return rate(key, label, list.filter((pl) => pl.was_open === true).length, list.length, {
      tone: "chart", dir: 1, minN, note,
      tooltip: `${CHARTED}: routes against ${label.toLowerCase()}${note ? " or press" : ""} coverage where he got open.`,
    });
  };
  const blk = (key: string, label: string, hit: (pl: TEPlay) => boolean, what: string) => {
    const list = blocks.filter(hit);
    return rate(key, label, list.filter((pl) => pl.block_success === true).length, list.length, { tone: "chart", dir: 1, minN: 15, tooltip: `${CHARTED}: ${what} marked a win.` });
  };

  const target: OverviewStat[] = hasPff(pff)
    ? [
      rate("te_tprr", "Routes targeted", num(pff, "pff_tgt"), num(pff, "pff_routes"), { tone: "pff", dir: 1, minN: 50, fmt: "pct1", tooltip: `${PFF}: targets ÷ routes run.` }),
      rate("te_catch", "Catch rate", num(pff, "pff_rec"), num(pff, "pff_tgt"), { tone: "pff", dir: 1, minN: 15, fmt: "pct1", tooltip: `${PFF}: catches ÷ targets.` }),
      rate("te_drop", "Drop rate", num(pff, "pff_drops"), num(pff, "pff_catchable"), { tone: "pff", dir: -1, minN: 15, fmt: "pct1", detail: `${num(pff, "pff_drops")} / ${num(pff, "pff_catchable")} catchable`, tooltip: `${PFF}: drops ÷ (catches + drops).` }),
      metric("te_yprr", "Yards / route", pff.pff_yprr ?? null, "dec2", { tone: "pff", dir: 1, minN: 50, n: num(pff, "pff_routes"), barMax: 4, detail: `${num(pff, "pff_recyds")} yds / ${num(pff, "pff_routes")}`, tooltip: `${PFF}: receiving yards ÷ routes run.` }),
      rate("te_part", "Route participation", num(pff, "pff_routes"), num(pff, "pff_tdb"), { tone: "pff", dir: 0, minN: 0, detail: `${num(pff, "pff_routes")} / ${num(pff, "pff_tdb")} team dropbacks`, tooltip: `${PFF}: routes ÷ his team's dropbacks.` }),
    ]
    : (() => {
      const tgt = routes.filter((pl) => pl.targeted === true);
      const caught = tgt.filter((pl) => pl.caught === true).length;
      const dropped = tgt.filter((pl) => pl.dropped === true).length;
      return [
        rate("te_tprr", "Routes targeted", tgt.length, routes.length, { tone: "chart", dir: 1, minN: 50, fmt: "pct1", tooltip: `${NO_PFF}: targets ÷ routes.` }),
        rate("te_catch", "Catch rate", caught, tgt.length, { tone: "chart", dir: 1, minN: 15, fmt: "pct1", tooltip: `${NO_PFF}: catches ÷ targets.` }),
        rate("te_drop", "Drop rate", dropped, caught + dropped, { tone: "chart", dir: -1, minN: 15, fmt: "pct1", detail: `${dropped} / ${caught + dropped} catchable`, tooltip: `${NO_PFF}: drops ÷ (catches + drops).` }),
      ];
    })();

  // Where he lined up: every TE game is charted in the app, so the charting's.
  const align = (key: string, label: string, hit: (pl: TEPlay) => boolean) =>
    rate(key, label, plays.filter(hit).length, plays.length, { tone: "chart", dir: 0, minN: 0, tooltip: `${CHARTED}: share of his snaps.` });
  const contestedT = routes.filter((pl) => pl.contested_target === true);
  const blocking: OverviewStat[] = [];
  if (hasPff(pff)) {
    blocking.push(
      metric("te_rbg", "Run-block grade", pff.pff_gr_rblk ?? null, "dec1", { tone: "pff", dir: 1, minN: 30, n: num(pff, "pff_rblk"), detail: `${num(pff, "pff_rblk")} run-block snaps`, tooltip: `${PFF}: PFF's run-blocking grade.` }),
      rate("te_pr", "Pressures allowed", num(pff, "pff_pr_allowed"), num(pff, "pff_pblk"), { tone: "pff", dir: -1, minN: 15, fmt: "pct1", detail: `${num(pff, "pff_pr_allowed")} / ${num(pff, "pff_pblk")} pass-block snaps`, tooltip: `${PFF}: pressures allowed ÷ pass-block snaps.` }),
    );
  }

  const columns: OverviewSection[] = [
    {
      key: "aligned", title: "Aligned", size: "list", stats: [
        align("te_inline", "Inline", (pl) => pl.positioning === "inline"),
        align("te_slot", "Slot", (pl) => pl.positioning === "slot"),
        align("te_wide", "Wide", (pl) => pl.positioning === "wide"),
        align("te_bf", "Backfield / wing", (pl) => pl.positioning === "full_back" || pl.positioning === "running_back" || pl.positioning === "wing_back"),
      ],
    },
  ];
  if (blocking.length) columns.push({ key: "blocking", title: "Blocking", size: "list", stats: blocking });
  columns.push({
    key: "contested", title: "Contested catch", size: "md", stats: [
      hasPff(pff)
        ? rate("te_cc", "Conversion rate", num(pff, "pff_crec"), num(pff, "pff_ctgt"), { tone: "pff", dir: 1, minN: 6, tooltip: `${PFF}: contested catches ÷ contested targets.` })
        : rate("te_cc", "Conversion rate", contestedT.filter((pl) => pl.contested_catch === true).length, contestedT.length, { tone: "chart", dir: 1, minN: 6, tooltip: `${NO_PFF}: contested catches ÷ contested targets.` }),
    ],
  });

  return {
    meta: [count(games, "game"), count(plays.length, "snap"), count(routes.length, "route"), count(blocks.length, "block")],
    main: [
      {
        key: "coverage", title: "Winning routes · open rate vs coverage", size: "lg", stats: [
          cov("te_man", "Man", (pl) => pl.coverage === "man" || pl.coverage === "press", 15, "(incl. press)"),
          cov("te_zone", "Zone", (pl) => pl.coverage === "zone", 15),
          cov("te_press", "Press", (pl) => pl.coverage === "press", 10),
          cov("te_double", "Double", (pl) => pl.coverage === "double", 10),
        ],
      },
      {
        key: "blocks", title: "Winning blocks · block win rate", size: "lg", stats: [
          blk("bk_run", "Run block", (pl) => pl.play_type === "run_block", "run-block reps"),
          blk("bk_pass", "Pass block", (pl) => pl.play_type === "pass_block", "pass-block reps"),
          blk("bk_inline", "Inline", (pl) => pl.block_type === "inline", "inline blocks"),
          blk("bk_move", "Movement", (pl) => pl.block_type === "movement", "movement blocks"),
        ],
      },
      { key: "targets", title: "Target data", size: "md", stats: target },
    ],
    columns,
  };
}

// ── Percentiles ──────────────────────────────────────────────

/** A stat is ranked only once this many prospects have enough of a sample for it. */
export const PERCENTILE_MIN_POOL = 10;

function allStats(page: OverviewPage): OverviewStat[] {
  return [...page.main, ...page.columns].flatMap((s) => s.stats);
}

/**
 * Where each prospect's numbers rank among every prospect at the position with
 * enough of a sample for that number (stat key → prospect id → 1–99). Mid-rank
 * against the others: the best of the pool reads 99, the worst 1, a tie splits
 * the difference. A stat with fewer than PERCENTILE_MIN_POOL qualifiers isn't
 * ranked at all, and a describing stat (dir 0) never is.
 */
export function percentileRanks(pages: ReadonlyMap<string, OverviewPage>): Map<string, Map<string, number>> {
  const pools = new Map<string, { id: string; v: number; dir: 1 | -1 }[]>();
  for (const [id, page] of pages) {
    for (const s of allStats(page)) {
      if (s.dir === 0 || s.value == null || s.n < s.minN) continue;
      const list = pools.get(s.key) ?? [];
      list.push({ id, v: s.value, dir: s.dir });
      pools.set(s.key, list);
    }
  }
  const out = new Map<string, Map<string, number>>();
  for (const [key, list] of pools) {
    if (list.length < PERCENTILE_MIN_POOL) continue;
    const ranks = new Map<string, number>();
    for (const me of list) {
      let worse = 0, tied = 0;
      for (const o of list) {
        if (o === me) continue;
        const d = (me.v - o.v) * me.dir;
        if (d > 0) worse++;
        else if (d === 0) tied++;
      }
      const p = ((worse + tied / 2) / (list.length - 1)) * 100;
      ranks.set(me.id, Math.max(1, Math.min(99, Math.round(p))));
    }
    out.set(key, ranks);
  }
  return out;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ... */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

export interface OverviewPoolInput {
  prospectId: string;
  prospects: readonly ProspectWithStats[];
  games: readonly ScoutingGame[];
  qbPlays: readonly QBPlay[];
  rbPlays: readonly RBPlay[];
  tePlays: readonly TEPlay[];
  /** PFF over each prospect's charted games (pffValues). */
  pffVals: ReadonlyMap<string, PffValues>;
  /** Charted games with imported PFF stats, per prospect (PffTotals.games). */
  pffGames: ReadonlyMap<string, number>;
}

/**
 * The Overview page of every prospect at this prospect's position (his among
 * them): his page, and the pool his percentile chips rank against. Empty when
 * the prospect isn't found or isn't at a scored position.
 */
export function overviewPagesFor(inp: OverviewPoolInput): Map<string, OverviewPage> {
  const out = new Map<string, OverviewPage>();
  const me = inp.prospects.find((x) => x.id === inp.prospectId);
  const pos = me?.position;
  if (pos !== "QB" && pos !== "RB" && pos !== "WR" && pos !== "TE") return out;
  const gameCount = new Map<string, number>();
  for (const g of inp.games) gameCount.set(g.prospect_id, (gameCount.get(g.prospect_id) ?? 0) + 1);
  const coverOf = (id: string): PffCover | null => {
    const g = inp.pffGames.get(id);
    return g == null ? null : { games: g, charted: gameCount.get(id) ?? 0 };
  };
  const pffOf = (id: string) => inp.pffVals.get(id) ?? {};
  const atPos = inp.prospects.filter((x) => x.position === pos);
  if (pos === "WR") {
    for (const x of atPos) out.set(x.id, wrOverview(x, pffOf(x.id), coverOf(x.id)));
  } else if (pos === "QB") {
    const by = playsByProspect(inp.qbPlays, inp.games);
    for (const x of atPos) out.set(x.id, qbOverview(by.get(x.id) ?? [], pffOf(x.id), coverOf(x.id), gameCount.get(x.id) ?? 0));
  } else if (pos === "RB") {
    const by = playsByProspect(inp.rbPlays, inp.games);
    for (const x of atPos) out.set(x.id, rbOverview(by.get(x.id) ?? [], pffOf(x.id), coverOf(x.id), gameCount.get(x.id) ?? 0));
  } else {
    const by = playsByProspect(inp.tePlays, inp.games);
    for (const x of atPos) out.set(x.id, teOverview(by.get(x.id) ?? [], pffOf(x.id), coverOf(x.id), gameCount.get(x.id) ?? 0));
  }
  return out;
}

/** Each prospect's plays, by the games that are his. */
export function playsByProspect<P extends { game_id: string }>(plays: readonly P[], games: readonly Pick<ScoutingGame, "id" | "prospect_id">[]): Map<string, P[]> {
  const g2p = new Map(games.map((g) => [g.id, g.prospect_id]));
  const out = new Map<string, P[]>();
  for (const pl of plays) {
    const pid = g2p.get(pl.game_id);
    if (!pid) continue;
    const list = out.get(pid) ?? [];
    list.push(pl);
    out.set(pid, list);
  }
  return out;
}
