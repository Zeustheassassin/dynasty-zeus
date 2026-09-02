import type { SleeperPlayer, AugmentedPick } from "../../lib/types";
import { CURRENT_YEAR } from "../../lib/helpers";
import type { PlayerWithValue, PickWithValue } from "./shared";
import { computeStarDiscounts } from "./calculatorUtils";

// ── Player / pick classification ─────────────────────────────────────────────

export const ageCutoffByPos: Record<string, number> = { QB: 30, RB: 26, WR: 29, TE: 29 };

export const isAgingAsset = (player: SleeperPlayer) =>
  Number(player?.age || 0) >= (ageCutoffByPos[player?.position] || 29);

export const isOldProducerBuy = (player: SleeperPlayer) => {
  const age = Number(player?.age || 0);
  if (player?.position === "RB") return age >= 25;
  if (player?.position === "QB") return age >= 31;
  if (player?.position === "WR" || player?.position === "TE") return age >= 29;
  return age >= 29;
};

export const isYoungBuildingBlock = (player: SleeperPlayer) =>
  ["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 24;

export const isFutureInsulationAsset = (player: SleeperPlayer) =>
  (["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 25) ||
  (player?.position === "TE" && Number(player?.age || 99) <= 25) ||
  (player?.position === "RB" && Number(player?.age || 99) <= 23);

// Continuous 0.0–1.0 sell-urgency curve. 0 = hold forever, 1 = sell immediately.
// Position-specific cliffs: RB peaks at 26-27, WR/TE at 29-30, QB at 32-33.
export const getAgeUrgency = (player: SleeperPlayer): number => {
  const age = Number(player?.age || 0);
  if (age === 0) return 0;
  const pos = player?.position;
  if (pos === "RB") {
    if (age <= 22) return 0;
    if (age <= 24) return 0.15;
    if (age <= 25) return 0.40;
    if (age <= 26) return 0.70;
    if (age <= 27) return 0.90;
    return 1.0;
  }
  if (pos === "QB") {
    if (age <= 26) return 0;
    if (age <= 29) return 0.15;
    if (age <= 31) return 0.40;
    if (age <= 33) return 0.75;
    return 1.0;
  }
  // WR / TE
  if (age <= 24) return 0;
  if (age <= 26) return 0.15;
  if (age <= 28) return 0.35;
  if (age <= 30) return 0.65;
  if (age <= 31) return 0.85;
  return 1.0;
};

// Complement: 0 = window closing now, 1 = prime years ahead.
export const getFutureValue = (player: SleeperPlayer): number => 1 - getAgeUrgency(player);

// "Years-to-positional-cliff" — used for team window scoring.
export const yearsToCliff = (player: SleeperPlayer): number => {
  const age = Number(player?.age || 0);
  if (age === 0) return 5;
  const pos = player?.position;
  const cliff = pos === "RB" ? 28 : pos === "QB" ? 35 : 32;
  return Math.max(0, cliff - age);
};

export const isPremiumCurrentPick = (pick: AugmentedPick) =>
  String(pick?.season) === CURRENT_YEAR && String(pick?.slot || "").match(/^1\.(0[1-6]|[1-6])$/);

// ── Package / balance helpers ─────────────────────────────────────────────────

// Shared value-band thresholds (user policy):
//   • A player below LOW_VALUE_FLOOR is noise — it may not be used to close a value
//     gap (no waiver credit; see tradeWaiverAdj) and cannot be the load-bearing piece
//     in a package (see the generation gate). It can only ride as a flagged sweetener.
//   • A player in [LOW_VALUE_FLOOR, MID_VALUE_CEILING) is opinion-dependent — it is
//     soft de-ranked at scoring time, never rejected.
export const LOW_VALUE_FLOOR = 700;
export const MID_VALUE_CEILING = 1000;

// isBalanced gate literals — single source of truth (referenced by the comment below).
export const BALANCE_ABS_CAP = 600;       // max adjusted value gap between the two sides
export const BALANCE_RATIO_FLOOR = 0.85;  // lighter side must be ≥ 85% of the heavier side

export const packageOk = (pkg: PlayerWithValue[]) => {
  const qbs = pkg.filter((p) => p.position === "QB").length;
  const tes = pkg.filter((p) => p.position === "TE").length;
  return qbs <= 1 && tes <= 1;
};

// Position totals for a player list
export const posTotals = (plist: Array<{ position: string; value: number }>) => {
  const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  plist.forEach((p) => { t[p.position] = (t[p.position] || 0) + p.value; });
  return t;
};

// Waiver adj — kept ONLY for isBalanced gate (generation filter).
// Surplus bodies below LOW_VALUE_FLOOR grant NO balance credit: a sub-700 throw-in is
// noise and must not be the reason a package's value reconciles.
// The combined credit across every surplus body is capped at BALANCE_ABS_CAP — the same
// tolerance band this credit exists to nudge a package into. Per-extra credit (550/750) was
// tuned for a SINGLE surplus body; stacking it across 2+ extras could otherwise manufacture
// more credit than the entire abs cap by itself (e.g. two ~1100-value extras ≈ 850 credit on
// a 600 cap), letting a raw gap well outside the cap pass purely on credit with no real-dollar
// check ever applied to it.
export const tradeWaiverAdj = (giveVals: number[], receiveVals: number[]) => {
  const diff = giveVals.length - receiveVals.length;
  if (diff === 0) return 0;
  const capAdj = (extras: number[]) =>
    Math.min(
      extras.reduce((s, v, i) => {
        if (v < LOW_VALUE_FLOOR) return s; // sub-700 surplus body → zero phantom balance credit
        return s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750);
      }, 0),
      BALANCE_ABS_CAP,
    );
  if (diff > 0) {
    const sg = [...giveVals].sort((a, b) => b - a);
    return capAdj(sg.slice(receiveVals.length));
  } else {
    const sr = [...receiveVals].sort((a, b) => b - a);
    return capAdj(sr.slice(giveVals.length));
  }
};

// Check if a trade is value-balanced after waiver adjustment.
// Two-part gate (literals live in BALANCE_ABS_CAP / BALANCE_RATIO_FLOOR above):
//   1. Absolute cap: gap must be ≤ BALANCE_ABS_CAP (600) — protects large-value trades
//      from wild swings. On a 10k package a 600-pt gap is ~6%.
//   2. Ratio cap: the lower side must be ≥ BALANCE_RATIO_FLOOR (85%) of the higher side —
//      prevents small-value trades from being wildly one-sided.
// Note: surplus bodies below LOW_VALUE_FLOOR contribute zero waiver credit (see
// tradeWaiverAdj), so a sub-700 throw-in can no longer manufacture phantom balance.
export const isBalanced = (giveVals: number[], receiveVals: number[]) => {
  const gTotal = giveVals.reduce((s, v) => s + v, 0);
  const rTotal = receiveVals.reduce((s, v) => s + v, 0);
  const diff = giveVals.length - receiveVals.length;
  const adjG = gTotal + (diff < 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
  const adjR = rTotal + (diff > 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
  if (Math.abs(adjR - adjG) > BALANCE_ABS_CAP) return false;
  const higher = Math.max(adjG, adjR);
  const lower  = Math.min(adjG, adjR);
  if (higher > 0 && lower / higher < BALANCE_RATIO_FLOOR) return false;
  return true;
};

// isBalanced() above only sees raw values PLUS tradeWaiverAdj's cardinality credit, so a
// package that "balances" purely on that credit (e.g. two ~$1,999 pieces matched dollar-for-
// dollar, plus a third receive-side piece the credit absorbs) can still be visibly lopsided at
// display time — computeFinderAdjustedNet never applies this credit, only the star discount.
// This re-checks the SAME abs/ratio caps against raw totals plus whatever star discount applies
// (zero included) and WITHOUT the credit, so the gate can never be more permissive than what the
// card actually shows. Every candidate-generation call site in TradeFinder.tsx uses this instead
// of the raw isBalanced() directly.
//
// Note this makes tradeWaiverAdj's credit unable to single-handedly admit a trade: this second,
// credit-free check is always at least as strict as the first (credit can only shrink a gap, and
// the discount can only widen one), so a trade needs to be raw-close enough to pass the credit-
// free check on its own. Deliberate — the credit exists to make a genuinely close 1-for-2/1-for-3
// package's cardinality mismatch not count against it, not to admit a package that's actually far
// apart in the raw dollars a real opponent would see.
export const isBalancedWithStarDiscount = (giveVals: number[], receiveVals: number[]) => {
  if (!isBalanced(giveVals, receiveVals)) return false;
  const { onGive, onReceive } = computeStarDiscounts(giveVals, receiveVals);
  const gTotal = giveVals.reduce((s, v) => s + v, 0) + onGive;
  const rTotal = receiveVals.reduce((s, v) => s + v, 0) + onReceive;
  if (Math.abs(rTotal - gTotal) > BALANCE_ABS_CAP) return false;
  const higher = Math.max(gTotal, rTotal);
  const lower  = Math.min(gTotal, rTotal);
  if (higher > 0 && lower / higher < BALANCE_RATIO_FLOOR) return false;
  return true;
};

// ── Contender tier-up overpay allowance ────────────────────────────────────────
// User policy: on a contending team that's deep at a position (solid backups behind
// the starter), a 2-for-1 that consolidates that depth into one difference-maker is
// worth deliberately overpaying for — the standard 600/85% gate is calibrated for
// even-value swaps, not "give up surplus to tier up." This ONLY widens the band in
// the direction where the USER gives more value than they receive (acquiring the
// star); if the trade already favors the user, it falls back to the standard gate
// unchanged. Callers must additionally gate this on contender status + give-side
// roster depth — this function has no opinion on either.
export const TIER_UP_BALANCE_ABS_CAP = 900;
export const TIER_UP_BALANCE_RATIO_FLOOR = 0.72;

export const isBalancedTierUp = (giveVals: number[], receiveVals: number[]) => {
  const gTotal = giveVals.reduce((s, v) => s + v, 0);
  const rTotal = receiveVals.reduce((s, v) => s + v, 0);
  if (rTotal >= gTotal) return isBalanced(giveVals, receiveVals);
  if (gTotal - rTotal > TIER_UP_BALANCE_ABS_CAP) return false;
  if (rTotal / gTotal < TIER_UP_BALANCE_RATIO_FLOOR) return false;
  return true;
};

export const isBalancedTierUpWithStarDiscount = (giveVals: number[], receiveVals: number[]) => {
  if (!isBalancedTierUp(giveVals, receiveVals)) return false;
  const { onGive, onReceive } = computeStarDiscounts(giveVals, receiveVals);
  const gTotal = giveVals.reduce((s, v) => s + v, 0) + onGive;
  const rTotal = receiveVals.reduce((s, v) => s + v, 0) + onReceive;
  if (rTotal >= gTotal) {
    if (Math.abs(rTotal - gTotal) > BALANCE_ABS_CAP) return false;
    const higher = Math.max(gTotal, rTotal);
    const lower  = Math.min(gTotal, rTotal);
    if (higher > 0 && lower / higher < BALANCE_RATIO_FLOOR) return false;
    return true;
  }
  if (gTotal - rTotal > TIER_UP_BALANCE_ABS_CAP) return false;
  if (gTotal > 0 && rTotal / gTotal < TIER_UP_BALANCE_RATIO_FLOOR) return false;
  return true;
};

// ── Team window ───────────────────────────────────────────────────────────────

// Returns avg years until positional cliffs across the starting lineup.
// 0 = window closing; 8+ = decade of contention ahead.
export const computeTeamWindow = (rosterPlayersList: PlayerWithValue[]): number => {
  const starters = [
    ...rosterPlayersList.filter((p) => p.position === "QB").sort((a, b) => b.value - a.value).slice(0, 1),
    ...rosterPlayersList.filter((p) => p.position === "RB").sort((a, b) => b.value - a.value).slice(0, 2),
    ...rosterPlayersList.filter((p) => p.position === "WR").sort((a, b) => b.value - a.value).slice(0, 3),
    ...rosterPlayersList.filter((p) => p.position === "TE").sort((a, b) => b.value - a.value).slice(0, 1),
  ];
  if (starters.length === 0) return 3;
  return starters.reduce((s: number, p) => s + yearsToCliff(p), 0) / starters.length;
};

// ── Pick slot scoring ─────────────────────────────────────────────────────────

export const getPickSlotBonus = (pick: PickWithValue): number => {
  const slot = String(pick?.slot ?? "");
  if (!slot.includes(".")) return 0; // unresolved — no slot bonus
  const slotNum = parseInt(slot.split(".")[1], 10);
  if (isNaN(slotNum) || slotNum < 1) return 0;
  const rd = Number(pick?.round ?? 1);
  if (rd === 1) {
    if (slotNum <= 2)  return 10;  // 1.01-1.02: generational pick premium
    if (slotNum <= 4)  return 7;   // top-4
    if (slotNum <= 6)  return 4;   // top-6
    if (slotNum <= 9)  return 1;   // mid-first
    if (slotNum <= 10) return 0;   // 1.10: roughly average
    return -3;                     // 1.11-1.12: "lottery pick" inverse
  }
  if (rd === 2) {
    if (slotNum <= 3)  return 4;
    if (slotNum <= 6)  return 2;
    return 0;
  }
  return 0; // 3rd+ rounds: slot rarely matters much
};
