import type { SleeperPlayer, AugmentedPick } from "../../lib/types";
import { CURRENT_YEAR } from "../../lib/helpers";
import type { PlayerWithValue, PickWithValue } from "./shared";

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

// Waiver adj — kept ONLY for isBalanced gate (generation filter)
export const tradeWaiverAdj = (giveVals: number[], receiveVals: number[]) => {
  const diff = giveVals.length - receiveVals.length;
  if (diff === 0) return 0;
  const capAdj = (extras: number[]) =>
    extras.reduce((s, v, i) => s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750), 0);
  if (diff > 0) {
    const sg = [...giveVals].sort((a, b) => b - a);
    return capAdj(sg.slice(receiveVals.length));
  } else {
    const sr = [...receiveVals].sort((a, b) => b - a);
    return capAdj(sr.slice(giveVals.length));
  }
};

// Check if a trade is value-balanced after waiver adjustment.
// Two-part gate:
//   1. Absolute cap: gap must be ≤600 — protects large-value trades from wild swings.
//   2. Ratio cap: the lower side must be ≥70% of the higher side — prevents small-value
//      trades from being wildly one-sided (e.g. 470 vs 976 is 48%, far too lopsided).
//      On a 10k package a 600-pt gap is ~6%; on a 500 vs 976 deal it's basically free money.
export const isBalanced = (giveVals: number[], receiveVals: number[]) => {
  const gTotal = giveVals.reduce((s, v) => s + v, 0);
  const rTotal = receiveVals.reduce((s, v) => s + v, 0);
  const diff = giveVals.length - receiveVals.length;
  const adjG = gTotal + (diff < 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
  const adjR = rTotal + (diff > 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
  if (Math.abs(adjR - adjG) > 600) return false;
  const higher = Math.max(adjG, adjR);
  const lower  = Math.min(adjG, adjR);
  if (higher > 0 && lower / higher < 0.85) return false;
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
