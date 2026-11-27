// ============================================================
// Score rules popout (stage 7 of the 2026-11-26 scouting plan)
// ============================================================
// One list per position of every piece of the AE Score, the Dynasty Score
// and Dynasty+, with its size and whether it's on, read from the constants
// the scores themselves use, so it can't drift from the code. Not per player
// (the user, 11/26: "no per-player view; a click-open rules popout per
// position"). The Big Board's sliders are the only live inputs: a piece
// behind a slider at 0 reads off.
//
// Sizes are before the slider; the state says the slider and what it comes
// to at the current weight. Pieces measured from the data (a metric's spread,
// the opponent-tier effects) say how they're measured, not today's number.
// Pure.
// ============================================================

import {
  MIN_POOL, POSITION_BASELINE, QB_FULL_TRUST, RB_FULL_TRUST, RB_FIELD_TIME_PAIR, TE_BLOCK_WEIGHT, TE_FIELD_TIME_PAIR,
  TE_ROUTE_WEIGHT, TE_SPREAD_FLOOR, WR_ALL_FULL_TRUST, WR_ALL_WEIGHT, WR_CORE_FULL_TRUST, WR_CORE_WEIGHT, WR_FIELD_TIME_PAIR,
  FIELD_TIME_MODIFIERS, type CompositePos,
} from "./aeComposite";
import { COMPONENT_SPREAD_FLOOR, componentWeight } from "./aeComponents";
import { CHARTED_COMPONENTS } from "./chartedComponents";
import { PFF_COMPONENTS } from "./pffComponents";
import { TAG_COMPONENTS, TAG_STAT_FLOOR } from "./tagStats";
import type { CountStatDef } from "./countComponents";
import { CAST_ON, OPPONENT_SP, SEASON_UNITS_ON, WEATHER_ON, type HeadlineKey } from "./contextGrading";
import { SEASON_UNIT_INPUTS } from "./gameContext";
import {
  CORRECTION_LABEL, DIFFICULTY_TAGS, ENABLED_SUB_ROUTES, ENABLED_TAG_CORRECTIONS, GARBAGE_TIME_WEIGHT, NEVER_WON_SUB_ROUTES,
  OWN_LEVEL_FAMILIES, RECENTER_TAGGED, TAG_CORRECTION_LAMBDA, subRouteLabel, type CorrectionKey,
} from "./tagCorrection";
import { ALIGN_FULL, ALIGN_START, SIDE_MAX_PENALTY, SLOT_MAX_PENALTY } from "./alignmentPenalty";
import {
  MIDDLE_BONUS_FULL, MIDDLE_BONUS_START, MIDDLE_MAX, MIDDLE_PENALTY_FULL, MIDDLE_PENALTY_START, MIDDLE_POOL_SHARE, MIDDLE_SHRINK_ATTEMPTS,
} from "./middleUsage";
import { RB_PASS_DOWNS, TE_FIELD_TIME, WR_RUN_DOWNS, type FieldTimeDials } from "./fieldTime";
import { NFL_RUN_MIX, RUN_MIX_PRIOR } from "./runMix";
import { MIN_P4_REPS, MIN_PROSPECTS, MIN_TIER_REPS, RB_SHARE_OF_WR, SHRINK_REPS } from "./opponentAdjust";
import { SEASON_DECAY } from "./seasonWeight";
import { LEFT_EARLY_WEIGHT, PLAYED_HURT_WEIGHT } from "./gameFlags";
import { PRESS_REDEFINED_AT } from "./coverageEra";
import { SAMPLE_FULL_PLAYS } from "./sampleTiers";
import {
  COMPETITION_CAP, COMPETITION_FULL_GAP, COMPETITION_PER_PLAYER, CONSENSUS_WINDOW, DRAFT_CAPITAL, FRAME_NORMS, LANDING_FIRST_CLASS,
  LAST_PICK, PRIME_END_AGE, QB_DRAFT_CAPITAL, QB_FULL_CAPITAL_LAST, QB_PREDRAFT_SCALE, QB_SLOT_RATES, RB_DRAFT_CAPITAL,
  REFERENCE_ROOKIE_AGE, SIZE_CAP, SIZE_PER_SD, WR_LIGHT_PENALTY, WR_LIGHT_WEIGHT, careerWindowAdjustment, draftCapitalForPick,
  qbSlotValue, type DynastyWeights,
} from "./dynastyScore";
import { PRO_DAY_ADJUST, RB_SPEED_FLOOR } from "./speedFloor";
import { LIGHT_INSIDE } from "./lightInsideFlag";
import { RUSH_BONUS_MAX, RUSH_YPG_FULL, RUSH_YPG_START } from "./qbRushing";
import { ROLE_STANDING_MAX } from "./roleStanding";
import {
  OFFENSE_VALUE, PATH_VALUE, PECKING_VALUE, QB_CAP, QB_GRADE_CENTER, QB_PER_POINT, QB_SHARE, ROLE_PASS_SHARE,
} from "./teamLanding";
import { UNDRAFTED_ROUND } from "../draftRound";

export interface ScoreRule {
  key: string;
  label: string;
  /** How much it can move the score, before any slider: "weight 0.40 (up to 13%)", "up to −0.70". */
  size: string;
  on: boolean;
  /** What switches it, or why it's off: "Speed slider 1.00×", "weight 0: shown in Grading checks, not scored". */
  state?: string;
  detail: string;
}

export interface RuleSection {
  key: "skill" | "added" | "reading" | "dynasty" | "plus";
  title: string;
  /** How the section's pieces combine. */
  note: string;
  rules: ScoreRule[];
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** "+0.20" / "−0.20" / "0.00". */
export function signedText(v: number, dp = 2): string {
  const r = Number(v.toFixed(dp));
  if (r === 0) return (0).toFixed(dp);
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(dp)}`;
}
const num = (v: number, dp = 2) => v.toFixed(dp);
const pct = (share: number, dp = 0) => `${(share * 100).toFixed(dp)}%`;
const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const SLIDER_LABEL: Record<keyof DynastyWeights, string> = {
  age: "Age", size: "Size", speed: "Speed", lightInside: "Light Inside", rushing: "QB Rushing",
  draft: "Draft", landing: "Landing", role: "Role", offense: "Offense",
};
/** On while the slider is above 0; the state names the slider and its weight. */
function slider(w: DynastyWeights, key: keyof DynastyWeights, extra?: string): Pick<ScoreRule, "on" | "state"> {
  const v = w[key] ?? 0;
  const head = `${SLIDER_LABEL[key]} slider ${num(v)}×${v > 0 ? "" : ": off"}`;
  return { on: v > 0, state: extra ? `${head}; ${extra}` : head };
}

// ── AE Score: the skill pieces ──────────────────────────────────────────────

interface Headline { key: string; contextKey: HeadlineKey; label: string; weight: number; full: string; detail: string }

/** The headline metrics as buildAEComposite weighs them. */
const HEADLINES: Record<CompositePos, readonly Headline[]> = {
  QB: [{
    key: "aae", contextKey: "qb_aae", label: "AAE", weight: 1, full: `counts in full at ${QB_FULL_TRUST} graded throws`,
    detail: "Accuracy above expected: each graded throw against the QB difficulty model's expected accuracy for that throw.",
  }],
  RB: [{
    key: "srae", contextKey: "rb_srae", label: "SRAE (NFL run mix)", weight: 1, full: `counts in full at ${RB_FULL_TRUST} runs`,
    detail: "Success rate above expected on designed runs, against the RB difficulty model, with his runs re-weighted to the NFL run mix.",
  }],
  WR: [
    {
      key: "csae", contextKey: "wr_csae", label: "cSAE", weight: WR_CORE_WEIGHT, full: `counts in full at ${WR_CORE_FULL_TRUST} core routes`,
      detail: "Open rate above expected on the routes a receiver is trying to win: no nines, no screens. The primary metric: a WR needs a cSAE sample to be scored.",
    },
    {
      key: "sae", contextKey: "wr_sae", label: "SAE", weight: WR_ALL_WEIGHT, full: `counts in full at ${WR_ALL_FULL_TRUST} routes`,
      detail: "Open rate above expected on every route, nines and screens included, so in effect those count at about 30%.",
    },
  ],
  TE: [
    {
      key: "te_saer", contextKey: "te_saer", label: "TE-SAER", weight: TE_ROUTE_WEIGHT, full: "full-trust point matched to WR's",
      detail: `Route success above expected. Its spread is floored at ${num(TE_SPREAD_FLOOR, 1)} of the observed spread until the TE pool shows its own.`,
    },
    {
      key: "te_saeb", contextKey: "te_saeb", label: "TE-SAEB", weight: TE_BLOCK_WEIGHT, full: "full-trust point matched to WR's",
      detail: "Block success above expected. Weight 0: it counts through field time (below), reading his route score at the snap share his blocking earns.",
    },
  ],
};

function componentsOf(pos: CompositePos): CountStatDef[] {
  return [...CHARTED_COMPONENTS, ...PFF_COMPONENTS, ...TAG_COMPONENTS].filter((d) => d.pos === pos);
}
const componentLabel = (d: CountStatDef) => (d.source === "pff" ? `PFF ${d.label}` : d.source === "tag" ? `Tag ${d.label}` : `Charted ${d.label}`);

/** The weight every averaged piece adds up to when he has all of them at full trust. */
function averagedTotal(pos: CompositePos): number {
  const heads = HEADLINES[pos].reduce((s, h) => s + h.weight, 0);
  const comps = componentsOf(pos)
    .filter((d) => !d.additive && !FIELD_TIME_MODIFIERS.has(d.key))
    .reduce((s, d) => s + componentWeight(d.key), 0);
  return heads + comps;
}

function skillSection(pos: CompositePos): RuleSection {
  const total = averagedTotal(pos);
  const rules: ScoreRule[] = HEADLINES[pos].map((h) => {
    const viaFieldTime = h.weight === 0 && FIELD_TIME_MODIFIERS.has(h.key);
    return {
      key: `head:${h.key}`,
      label: h.label,
      size: viaFieldTime ? "through field time" : `weight ${num(h.weight)} (${pct(h.weight / total)} when he has every piece)`,
      on: true,
      state: h.full,
      detail: h.detail,
    };
  });
  for (const d of componentsOf(pos)) {
    const w = componentWeight(d.key);
    const viaFieldTime = FIELD_TIME_MODIFIERS.has(d.key);
    const size = viaFieldTime ? "through field time"
      : d.additive && w > 0 ? `adds ${num(w)} × his z on top`
      : `weight ${num(w)}${w > 0 ? ` (up to ${pct(w / total)})` : ""}`;
    const on = viaFieldTime || w > 0;
    rules.push({
      key: `comp:${d.key}`,
      label: componentLabel(d),
      size,
      on,
      state: viaFieldTime ? `counts only through field time (weight 0); needs ${d.floor} ${d.unit}`
        : on ? `needs ${d.floor} ${d.unit}; counts for players who have it, scaled by trust`
        : "weight 0: shown in Grading checks, not scored",
      detail: d.description,
    });
  }
  return {
    key: "skill",
    title: "AE Score: the skill pieces",
    note: `Each piece is his shrunk distance from the average charted ${pos}, in true-talent SDs (the noisier his sample, the more it's pulled to 0), `
      + `averaged at these weights. PFF, charted and tag pieces count only for players who have them, renormalized per player and scaled by trust; `
      + `"adds" pieces go on top instead of into the average. A metric joins once ${MIN_POOL} ${pos}s clear its floor.`,
    rules,
  };
}

// ── AE Score: added on top ──────────────────────────────────────────────────

function fieldTimeText(d: FieldTimeDials): string {
  return `snap share ${pct(d.baseShare)} for an average blocker, ±${pct(d.earnPerSD)} per SD of blocking, `
    + `cut from ${Math.abs(d.cutStartsAtPts)} pts under the average at ${pct(d.cutPerPt)} of snaps per point, `
    + `held to ${pct(d.minShare)}–${pct(d.maxShare)}`;
}

function addedSection(pos: CompositePos): RuleSection {
  const rules: ScoreRule[] = [];
  const base = POSITION_BASELINE[pos];
  if (base != null) {
    rules.push({
      key: "baseline", label: "Position baseline", size: signedText(base), on: base !== 0,
      detail: `Every ${pos}'s AE Score sits ${Math.abs(base).toFixed(2)} ${base < 0 ? "lower" : "higher"}, so the ${pos}s don't crowd the cross-position board (the user's call).`,
    });
  }
  if (pos === "QB") {
    rules.push({
      key: "middle", label: "Middle of the field (10+ yds)", size: `${signedText(-MIDDLE_MAX)} to ${signedText(MIDDLE_MAX)}`, on: MIDDLE_MAX > 0,
      detail: `His share of throws past the line that go to the middle at 10+ yards (PFF full seasons, his charted seasons), pulled toward the college pool's ${MIDDLE_POOL_SHARE}% by ${MIDDLE_SHRINK_ATTEMPTS} attempts. `
        + `Under ${MIDDLE_PENALTY_START}% he starts losing, all of it at ${MIDDLE_PENALTY_FULL}%; over ${MIDDLE_BONUS_START}% he starts gaining, all of it at ${MIDDLE_BONUS_FULL}%.`,
    });
  }
  if (pos === "WR") {
    rules.push({
      key: "alignment", label: "One-side alignment", size: `up to ${signedText(-SIDE_MAX_PENALTY)} (one side) · ${signedText(-SLOT_MAX_PENALTY)} (slot)`, on: SIDE_MAX_PENALTY > 0,
      detail: `A receiver lined up on one side (left or right) on ${ALIGN_START}%+ of his charted snaps starts losing, curving up to the full penalty at ${ALIGN_FULL}%; the slot carries a milder version.`,
    });
  }
  if (pos === "TE") {
    rules.push({
      key: "field_time", label: "Field time (blocking)", size: "his route score read at his snap share", on: TE_FIELD_TIME_PAIR.modifier === "te_saeb",
      detail: `Routes and blocking scored as one: his blocking (TE-SAEB) sets his snaps, his route running what he does with them. ${fieldTimeText(TE_FIELD_TIME)}; `
        + `a TE good at both gets ${pct(TE_FIELD_TIME.bothPerSD)} more per SD.`,
    });
  }
  if (pos === "RB" && RB_FIELD_TIME_PAIR.counts === "added") {
    const skill = Object.entries(RB_FIELD_TIME_PAIR.skill).map(([k, v]) => `${skillLabel(k)} ${num(v, 1)}`);
    rules.push({
      key: "field_time", label: "Field time (pass protection)", size: `weight ${num(RB_PASS_DOWNS.weight)} on top`, on: RB_PASS_DOWNS.weight > 0,
      detail: `Charted PB% decides his ${RB_PASS_DOWNS.snaps}; what he'd lose is his receiving there (${list(skill)}). ${fieldTimeText(RB_PASS_DOWNS.dials)} (win-rate points). A back blocking like the average one counts 0.`,
    });
  }
  if (pos === "WR" && WR_FIELD_TIME_PAIR.counts === "added") {
    const skill = Object.entries(WR_FIELD_TIME_PAIR.skill).map(([k, v]) => `${skillLabel(k)} ${num(v, 1)}`);
    rules.push({
      key: "field_time", label: "Field time (run blocking)", size: `weight ${num(WR_RUN_DOWNS.weight)} on top`, on: WR_RUN_DOWNS.weight > 0,
      detail: `PFF's run-block grade decides his ${WR_RUN_DOWNS.snaps}; what he'd lose is his route running there (${list(skill)}). ${fieldTimeText(WR_RUN_DOWNS.dials)} (grade points).`,
    });
  }
  return {
    key: "added",
    title: "AE Score: added on top",
    note: "Added to the averaged skill score, in the same true-talent SDs; Dynasty and Dynasty+ carry them too.",
    rules,
  };
}

function skillLabel(key: string): string {
  const d = [...CHARTED_COMPONENTS, ...PFF_COMPONENTS, ...TAG_COMPONENTS].find((x) => x.key === key);
  if (d) return componentLabel(d);
  return HEADLINES.WR.find((h) => h.key === key)?.label ?? key;
}

// ── How his plays are read ──────────────────────────────────────────────────

const CORRECTION_KEYS_OF: Record<CompositePos, readonly CorrectionKey[]> = {
  QB: ["qb_aae"], RB: ["rb_srae"], WR: ["wr_sae"], TE: ["te_saer", "te_saeb"],
};

/** The position's metric keys as the context policy names them, with labels. */
function contextMetrics(pos: CompositePos): { key: string; label: string }[] {
  return [
    ...HEADLINES[pos].map((h) => ({ key: h.contextKey as string, label: h.label })),
    ...componentsOf(pos).filter((d) => componentWeight(d.key) > 0 || FIELD_TIME_MODIFIERS.has(d.key)).map((d) => ({ key: d.key, label: componentLabel(d) })),
  ];
}

const OPPONENT_TEXT: Record<CompositePos, string> = {
  QB: "none (accuracy isn't expected to depend on the opponent's level)",
  RB: `its own once measurable, else ${pct(RB_SHARE_OF_WR)} of WR's`,
  WR: "its own measurement",
  TE: "its own once measurable, else WR's",
};

function readingSection(pos: CompositePos): RuleSection {
  const rules: ScoreRule[] = [];
  const metrics = contextMetrics(pos);
  const named = (set: ReadonlySet<string>) => metrics.filter((m) => set.has(m.key)).map((m) => m.label);

  rules.push({
    key: "season_weight", label: "Season weighting", size: `×${SEASON_DECAY} per season`, on: SEASON_DECAY < 1,
    detail: `Each play counts ${SEASON_DECAY}^(seasons before his newest charted season): newer tape leads when it differs from older tape. The league models weigh every play equally.`,
  });
  rules.push({
    key: "opponent_tier", label: "Opponent strength (G5 / FCS)", size: "measured from the charting", on: true,
    state: `${list(HEADLINES[pos].map((h) => h.label))}: ${OPPONENT_TEXT[pos]}; the PFF, charted and tag pieces: each its own, measured on its pool`,
    detail: `The easier reps against G5 and FCS opponents are taken back out, measured within players once ${MIN_PROSPECTS} ${pos}s have ${MIN_P4_REPS} P4 and ${MIN_TIER_REPS} lower-tier reps, `
      + `shrunk toward 0 by ${SHRINK_REPS} reps, never making weaker opponents harder. AE Score, Dynasty and Dynasty+ only, never the AE columns.`,
  });
  const sp = named(OPPONENT_SP);
  rules.push({
    key: "opponent_sp", label: "Opponent defense SP+", size: "measured per metric", on: sp.length > 0,
    state: sp.length ? `for ${list(sp)}, instead of the tiers` : "no metric at this position",
    detail: "Judged against the opponent's defensive SP+ instead of the G5 / FCS tiers, where that test passed.",
  });
  const weather = named(WEATHER_ON);
  rules.push({
    key: "weather", label: "Weather", size: "measured per metric", on: weather.length > 0,
    state: weather.length ? `for ${list(weather)}` : "no metric at this position",
    detail: "A metric's weather effect (wind, cold, rain) is taken out where its held-out test passed.",
  });
  const units = metrics.flatMap((m) => {
    const u = SEASON_UNITS_ON.get(m.key);
    return u?.length ? [`${m.label} (${u.map((x) => SEASON_UNIT_INPUTS[x].label.toLowerCase()).join(", ")})`] : [];
  });
  rules.push({
    key: "season_units", label: "Season units", size: "measured per metric", on: units.length > 0,
    state: units.length ? `for ${list(units)}` : "no metric at this position",
    detail: "Credit for the opposing unit faced that season (line matchup, coverage, missed-tackle rate); the metric's spread is measured before it.",
  });
  rules.push({
    key: "cast", label: "Supporting cast", size: "—", on: named(CAST_ON).length > 0,
    state: named(CAST_ON).length ? `for ${list(named(CAST_ON))}` : "never counts in a score (the user's call); kept for the checks",
    detail: "His line's grades or his QB's grade, as context.",
  });

  for (const ck of CORRECTION_KEYS_OF[pos]) {
    const enabled = ENABLED_TAG_CORRECTIONS[ck];
    const model = CORRECTION_LABEL[ck];
    for (const t of DIFFICULTY_TAGS[ck]) {
      const on = enabled.includes(t.column);
      rules.push({
        key: `tag:${ck}:${t.column}`, label: `${model} tag: ${t.label}`, size: `ridge λ ${TAG_CORRECTION_LAMBDA}`, on,
        state: on ? "on: the difficulty model judges a tagged play by it" : "off: waiting on (or failed) its held-out test",
        detail: "A per-play difficulty tag the model can read on top of today's model; a thin tag stays near 0 until it has the reps.",
      });
    }
    const subs = ENABLED_SUB_ROUTES[ck];
    if (subs.length) {
      const zero = subs.filter((s) => NEVER_WON_SUB_ROUTES.includes(s)).map(subRouteLabel);
      rules.push({
        key: `subroutes:${ck}`, label: `${model} sub-routes`, size: `${subs.length} on`, on: true,
        state: list(subs.map(subRouteLabel)),
        detail: `Each switched-on sub-route is judged against its own expected rate instead of its route family's; the family's other split routes stay pooled.${zero.length ? ` ${list(zero)}: judged at 0% (never tried to win).` : ""}`,
      });
    }
    const own = OWN_LEVEL_FAMILIES[ck];
    if (own.length) {
      rules.push({
        key: `ownlevel:${ck}`, label: `${model}: own level`, size: "—", on: true, state: `${list(own.map((f) => `${f}s`))}`,
        detail: "Those split routes are judged at what the charted pool actually won, not today's model (older routes as before).",
      });
    }
    const gt = GARBAGE_TIME_WEIGHT[ck];
    rules.push({
      key: `garbage:${ck}`, label: `${model}: garbage-time discount`, size: `weight ${num(gt)}`, on: gt < 1,
      state: gt < 1 ? "a tagged garbage-time play counts less" : "off: garbage-time plays count in full until a held-out test picks a lower weight",
      detail: "How much a tagged garbage-time play counts in his own sample.",
    });
    rules.push({
      key: `recenter:${ck}`, label: `${model}: re-center the tagged era`, size: "—", on: RECENTER_TAGGED[ck],
      state: RECENTER_TAGGED[ck] ? "on" : "off until the era check shows a drift",
      detail: "Sets the tagged plays' mean residual to the older plays'.",
    });
  }

  if (pos === "RB") {
    const mix = Object.entries(NFL_RUN_MIX).map(([k, v]) => `${k.replace(/_/g, " ")} ${pct(v, 1)}`);
    rules.push({
      key: "run_mix", label: "NFL run mix", size: "re-weights his runs", on: true,
      detail: `His runs count in the NFL's mix (${list(mix)}), his own mix pulled toward it by ${RUN_MIX_PRIOR} runs, so a back isn't graded on his college's run game.`,
    });
  }
  if (pos === "WR" || pos === "TE") {
    const day = new Date(PRESS_REDEFINED_AT).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    rules.push({
      key: "press_era", label: "Press eras", size: "—", on: true,
      detail: `Press was redefined on ${day}: routes before and after are each judged within their own era.`,
    });
  }
  rules.push({
    key: "game_flags", label: "Flagged-game discount (left early, played hurt)", size: `weight ${num(LEFT_EARLY_WEIGHT)} / ${num(PLAYED_HURT_WEIGHT)}`,
    on: LEFT_EARLY_WEIGHT < 1 || PLAYED_HURT_WEIGHT < 1,
    state: LEFT_EARLY_WEIGHT < 1 || PLAYED_HURT_WEIGHT < 1 ? "a flagged game counts less" : "off: flagged games count in full until a held-out test picks a lower weight",
    detail: "What a game the user flagged counts in his own sample.",
  });
  rules.push({
    key: "spread_floor", label: "Thin components' spread floor", size: `${num(COMPONENT_SPREAD_FLOOR, 1)} of the observed spread`, on: COMPONENT_SPREAD_FLOOR > 0,
    detail: `A PFF, charted or tag piece whose true spread can't yet be told from noise counts at that floor, at low trust that grows with charting. Tag pieces need ${TAG_STAT_FLOOR} tagged plays.`,
  });
  rules.push({
    key: "full_sample", label: "Full sample (the Smp dot)", size: `${SAMPLE_FULL_PLAYS[pos]} plays`, on: true,
    detail: "Shown, not scored: the dot beside his name, and Chart Next's goal. Trust in each metric follows its own full-trust point above.",
  });
  return {
    key: "reading",
    title: "AE Score: how his plays are read",
    note: "Adjustments to the plays and metrics before they're shrunk and averaged.",
    rules,
  };
}

// ── Dynasty Score ───────────────────────────────────────────────────────────

function dynastySection(pos: CompositePos, w: DynastyWeights): RuleSection {
  const prime = PRIME_END_AGE[pos];
  const rules: ScoreRule[] = [{
    key: "age", label: "Career window", ...slider(w, "age"),
    size: `21 as a rookie ${signedText(careerWindowAdjustment(pos, 21))} · 24 ${signedText(careerWindowAdjustment(pos, 24))}`,
    detail: `Prime seasons left at his rookie-season age against a typical ${REFERENCE_ROOKIE_AGE}-year-old's: a ${pos}'s prime ends at ${prime}. Estimated ages (from the HS class) count too.`,
  }];
  const frame = FRAME_NORMS[pos];
  if (frame) {
    rules.push({
      key: "frame", label: "Size: frame", ...slider(w, "size"),
      size: `±${num(SIZE_PER_SD, 1)} per SD, capped at ±${num(SIZE_CAP, 1)}`,
      detail: `Pounds per inch of height against a typical ${pos}'s ${num(frame.lbPerIn)} (SD ${num(frame.sd, 3)}): more weight on the frame counts for more. A measured size replaces the listed one.`,
    });
  }
  if (pos === "WR") {
    rules.push({
      key: "light_wr", label: `Size: under ${WR_LIGHT_WEIGHT} lb`, ...slider(w, "size"), size: signedText(WR_LIGHT_PENALTY),
      detail: `A receiver under ${WR_LIGHT_WEIGHT} lb is fragile on any frame.`,
    });
  }
  if (pos === "RB") {
    rules.push({
      key: "speed", label: "Speed floor", ...slider(w, "speed", "off once his class is drafted"),
      size: `up to ${signedText(RB_SPEED_FLOOR.value)}`,
      detail: `Speed Score (weight × 200 / 40⁴) under ${RB_SPEED_FLOOR.none} starts costing, all of it at ${RB_SPEED_FLOOR.full}. A pro-day 40 gets +${num(PRO_DAY_ADJUST)} s; his weigh-in is used where he ran, and no 40 means no penalty.`,
    });
    rules.push({
      key: "light_inside", label: "Light inside runner", ...slider(w, "lightInside", `${signedText(LIGHT_INSIDE.draftedValue)} once his class is drafted`),
      size: `up to ${signedText(LIGHT_INSIDE.value)}`,
      detail: `An RB with the Inside tag on a light frame: none at ${LIGHT_INSIDE.none} lb per inch, all of it at ${LIGHT_INSIDE.full} and under (weigh-in over bio weight). Shown as a red flag.`,
    });
  }
  if (pos === "QB") {
    rules.push({
      key: "rushing", label: "QB rushing bonus", ...slider(w, "rushing"),
      size: `up to ${signedText(RUSH_BONUS_MAX)}`,
      detail: `Rushing yards per game over PFF's full college seasons: 0 at the median (${RUSH_YPG_START}), all of it at ${RUSH_YPG_FULL} (the top 10%), times a passing gate (none in the bottom third of scored QBs by passing, all of it in the top third).`,
    });
    rules.push({
      key: "qb_discount", label: "QB pre-draft discount", on: QB_PREDRAFT_SCALE < 1,
      state: "no slider; off once his class is drafted, and Dynasty+ backs it out",
      size: `×${QB_PREDRAFT_SCALE} of his AE Score`,
      detail: `Before the draft ${pct(QB_PREDRAFT_SCALE)} of a QB's AE Score counts: his value swings most on his pick, which Dynasty+ prices in.`,
    });
  }
  return {
    key: "dynasty",
    title: "Dynasty Score",
    note: "Dynasty = AE Score + each piece × its Big Board slider.",
    rules,
  };
}

// ── Dynasty+ ────────────────────────────────────────────────────────────────

const ROUND_ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

/** The capital table his position reads, round by round (a QB's round 1 by slot). */
export function capitalTableText(pos: CompositePos): string {
  if (pos === "QB") {
    const slots = QB_SLOT_RATES.map((s, i) => `${s.first}–${s.last} ${signedText(i === 0 ? draftCapitalForPick((s.first + s.last) / 2) : qbSlotValue(s.rate))}`);
    const rounds = [2, 3, 4, 5, 6, 7].map((r) => `${ROUND_ORD[r]} ${signedText(QB_DRAFT_CAPITAL[r])}`);
    return `picks ${slots.join(" · ")} · ${rounds.join(" · ")} · undrafted ${signedText(QB_DRAFT_CAPITAL[UNDRAFTED_ROUND])}`;
  }
  const table = pos === "RB" ? RB_DRAFT_CAPITAL : DRAFT_CAPITAL;
  return `${[1, 2, 3, 4, 5, 6, 7].map((r) => `${ROUND_ORD[r]} ${signedText(table[r])}`).join(" · ")} · undrafted ${signedText(table[UNDRAFTED_ROUND])}`;
}

function plusSection(pos: CompositePos, w: DynastyWeights): RuleSection {
  const landing = `${LANDING_FIRST_CLASS} classes on, once his real pick is set`;
  const scale = pos === "QB" ? ` A QB's falls faster after pick ${QB_FULL_CAPITAL_LAST}.` : pos === "RB" ? " An RB's falls off less after round 1." : "";
  const vets = PECKING_VALUE[pos].map((v, i, a) => `${i}${i === a.length - 1 ? "+" : ""}: ${signedText(v)}`).join(" · ");
  const qbShare = QB_SHARE[pos];
  const rules: ScoreRule[] = [
    {
      key: "capital", label: "Draft capital", ...slider(w, "draft", `at it, pick 1 is worth ${signedText(w.draft * draftCapitalForPick(1, pos))} and undrafted ${signedText(w.draft * DRAFT_CAPITAL[UNDRAFTED_ROUND])}`),
      size: capitalTableText(pos),
      detail: `By overall pick: each round's value sits at its middle pick, straight lines between.${scale} Undrafted is ${signedText(DRAFT_CAPITAL[UNDRAFTED_ROUND])} whatever the pick.`,
    },
    {
      key: "projected", label: "Projected pick (consensus board)", ...slider(w, "draft", "until his real round is set"),
      size: `capital averaged over ±${pct(CONSENSUS_WINDOW)} of his rank`,
      detail: `His rank on his class's consensus big board stands in for the pick (#40 → picks 30–50); slots past pick ${LAST_PICK} count as undrafted. Capital only: none of the landing pieces below. Not on the list: no Dynasty+ (NC).`,
    },
    {
      key: "competition", label: "Rookie competition", ...slider(w, "landing", landing),
      size: `${signedText(-COMPETITION_PER_PLAYER)} each, capped at ${signedText(-COMPETITION_CAP)}`,
      detail: `Each teammate at his position drafted ahead of him costs up to ${num(COMPETITION_PER_PLAYER, 1)}, in full at a capital gap of ${num(COMPETITION_FULL_GAP, 1)} (about two rounds).${pos === "WR" ? " Move TEs drafted ahead count too." : pos === "TE" ? " For a Move TE, WRs drafted ahead count too." : ""}`,
    },
    {
      key: "vets", label: "Vets ahead", ...slider(w, "landing", landing), size: vets,
      detail: "The established veterans at his position he has to pass on his NFL team (his entry, else the PFF room).",
    },
    {
      key: "path", label: "Path by year 2", ...slider(w, "landing", landing),
      size: `opens ${signedText(PATH_VALUE.opens)} · same 0 · closes ${signedText(PATH_VALUE.closes)}`,
      detail: "Whether a veteran ahead ages out of his prime (or a bridge QB / weak starter is all that's ahead) by his second year.",
    },
    {
      key: "role", label: "Role standing", ...slider(w, "role", landing),
      size: `±${num(ROLE_STANDING_MAX)}`,
      detail: "Where he ranks at the role he'll play (Will Play (Post), else his best bucket) among his class's players at that role.",
    },
  ];
  if (qbShare > 0) {
    const blocking = pos === "TE" && ROLE_PASS_SHARE.blocking != null ? `; a Blocking TE gets ${pct(ROLE_PASS_SHARE.blocking)}` : "";
    rules.push({
      key: "qb", label: "His QB", ...slider(w, "offense", landing),
      size: `${num(QB_PER_POINT * qbShare, 3)} per grade point around ${QB_GRADE_CENTER}, capped at ±${num(QB_CAP * qbShare)}`,
      detail: `His starter's prior-season passing grade${qbShare < 1 ? ` (half for an RB, whose value leans on the run game)` : ""}${blocking}.`,
    });
  }
  const off = OFFENSE_VALUE[pos];
  rules.push({
    key: "offense", label: "Pass / run offense", ...slider(w, "offense", landing),
    size: `pass ${signedText(off.pass)} · balanced 0 · run ${signedText(off.run)}`,
    detail: `From the team's pass rate over expectation${pos === "TE" && ROLE_PASS_SHARE.blocking != null ? `; ${pct(ROLE_PASS_SHARE.blocking)} for a Blocking TE` : ""}.`,
  });
  return {
    key: "plus",
    title: "Dynasty+",
    note: `Dynasty+ = Dynasty${pos === "QB" ? " less the QB pre-draft discount" : ""} + each piece × its slider. The landing pieces wait for the real pick.`,
    rules,
  };
}

/** Every score piece at the position, in the order the scores build up. */
export function scoreRules(pos: CompositePos, weights: DynastyWeights): RuleSection[] {
  return [skillSection(pos), addedSection(pos), readingSection(pos), dynastySection(pos, weights), plusSection(pos, weights)];
}
