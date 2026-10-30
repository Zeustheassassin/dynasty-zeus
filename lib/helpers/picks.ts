// ============================================================
// Draft pick value helpers — key generation, value lookup,
// draft type detection, slot calculation, and FantasyCalc fetch.
// ============================================================

import { CURRENT_YEAR, YEARS, ROUNDS } from "./season";
import { getFcValuesRaw } from "../fcValuesStore";
import type { SleeperRoster, SleeperDraft, SleeperTradedPick, AugmentedPick } from "../types";

/** Minimal pick shape needed for value key generation (subset of SleeperTradedPick). */
interface PickLike {
  season?: string | number;
  round?: number;
  slot?: string;
}

/** Minimal draft shape needed for snake detection (Sleeper's schema is inconsistent across endpoints). */
interface DraftLike {
  type?: string;
  settings?: { type?: string; draft_type?: string; [key: string]: unknown };
  metadata?: { type?: string; draft_type?: string; [key: string]: unknown };
}

/** FantasyCalc value entry from the /api/fc-values response. */
interface FcEntry {
  player?: { position?: string; name?: string; sleeperId?: string | number; maybeTeam?: string };
  value?: number;
  redraftValue?: number;
  trend30Day?: number;
  maybeTradeFrequency?: number;
}

/** Returns the FantasyCalc pick key for a traded/owned pick.
 *  Current-year picks with known slots use slot format ("2026-1.06");
 *  future picks or unknown slots use round format ("2027-1"). */
export const getPickValueKey = (pick: PickLike): string => {
  if (
    pick?.season === CURRENT_YEAR &&
    pick?.slot &&
    String(pick.slot).includes(".")
  ) {
    return `${pick.season}-${pick.slot}`;
  }
  return `${pick?.season}-${pick?.round}`;
};

/** Looks up a pick's value from the pickValues map, falling back
 *  from the specific slot key to the round key if needed. */
export const getStoredPickValue = (
  pickValues: Record<string, number>,
  pick: PickLike
): number =>
  pickValues[getPickValueKey(pick)] ??
  pickValues[`${pick?.season}-${pick?.round}`] ??
  0;

/** Returns true when the draft type is identified as a snake draft
 *  (checks multiple field locations since Sleeper's schema is inconsistent). */
export const isSnakeDraft = (draft: DraftLike): boolean => {
  const typeCandidates = [
    draft?.type,
    draft?.settings?.type,
    draft?.settings?.draft_type,
    draft?.metadata?.type,
    draft?.metadata?.draft_type,
  ]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);

  return typeCandidates.some((value) => value.includes("snake"));
};

/** Calculates the draft slot position for a team in a given round,
 *  reversing direction in even rounds for snake drafts. */
export const getDraftRoundSlot = (
  draft: DraftLike,
  round: number,
  baseSlot: number,
  totalTeams: number
): number => {
  if (!baseSlot || baseSlot < 1 || totalTeams < 2) return baseSlot;
  if (!isSnakeDraft(draft)) return baseSlot;
  return round % 2 === 0 ? totalTeams - baseSlot + 1 : baseSlot;
};

const MAX_SUPPORTED_ROUNDS = 6;
const ALL_ROUNDS = Array.from({ length: MAX_SUPPORTED_ROUNDS }, (_, i) => i + 1);

/** Rookie-draft rounds for a league's pick board: the loaded draft's own count, else the league's
 *  `draft_rounds` setting, else 4. The draft is only loaded by the Live Draft Board, which stays
 *  blank in Weeks 1–17 — without the league fallback every league read as 4 rounds then. A count
 *  outside 1–MAX_SUPPORTED_ROUNDS (a startup-sized draft) is skipped. */
export function rookieDraftRoundCount(
  draft: { settings?: { rounds?: number } | null; rounds?: number } | null | undefined,
  leagueSettings: { draft_rounds?: number } | null | undefined,
): number {
  for (const raw of [draft?.settings?.rounds ?? draft?.rounds, leagueSettings?.draft_rounds]) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_SUPPORTED_ROUNDS) return n;
  }
  return 4;
}

/** "perLeague": builds up to MAX_SUPPORTED_ROUNDS then trims to max(league settings rounds,
 *  traded-pick max round, ROUNDS.length), falls back to a padded-roster-id slot label, and
 *  labels non-current-year picks with a bare round — used by loadRoster and useSpyState, which
 *  show one league's full pick board. "overview": builds exactly ROUNDS.length rounds with no
 *  trim, falls back to a bare-round slot label, and leaves non-current-year picks unlabeled —
 *  used by useLeagueOverview, which renders every league at once. */
export type PickPoolMode = "perLeague" | "overview";

/** Builds a league's full pick pool (every roster's picks across the pick-year window), shared by
 *  the three client copies of this logic: useAppState.loadRoster, useSpyState.loadSpyLeagueCore,
 *  and useLeagueOverview. The season-window and traded-pick-application rules below are identical
 *  across all three callers; `mode` captures where they intentionally diverge (round depth and
 *  slot-label fallback) — see __tests__/hooks/pickWindowCopies.test.ts, which pins each
 *  difference per caller so a future edit here can't silently change one of them. */
export function buildLeaguePickPool(
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  drafts: SleeperDraft[],
  mode: PickPoolMode
): AugmentedPick[] {
  // Skip seasons whose rookie draft is complete (those picks are spent); extend the window
  // forward to keep it the same length. A startup-sized draft (>6 rounds) also retires that
  // season if no separate rookie-sized draft exists for it — that pattern means rookies were
  // consumed inside the startup itself and no follow-on rookie draft will fire.
  const seasonsWithRookieDraft = new Set(
    drafts
      .filter((d) => {
        if (!d?.season) return false;
        const rounds = d.settings?.rounds ?? d.rounds ?? 99;
        return rounds <= 6;
      })
      .map((d) => String(d.season))
  );
  const completedDraftSeasons = new Set<string>();
  drafts.forEach((d) => {
    if (d?.status !== "complete" || !d?.season) return;
    const rounds = d.settings?.rounds ?? d.rounds ?? 99;
    const season = String(d.season);
    if (rounds <= 6) completedDraftSeasons.add(season);
    else if (!seasonsWithRookieDraft.has(season)) completedDraftSeasons.add(season);
  });
  const baseYearNum = Number(YEARS[0]);
  const pickYearWindow: string[] = [];
  for (let offset = 0; pickYearWindow.length < YEARS.length; offset++) {
    const y = String(baseYearNum + offset);
    if (!completedDraftSeasons.has(y)) pickYearWindow.push(y);
  }

  const buildRounds = mode === "perLeague" ? ALL_ROUNDS : ROUNDS;
  let tempPicks: AugmentedPick[] = [];
  pickYearWindow.forEach((year) => {
    rosters.forEach((r) => {
      buildRounds.forEach((round) => {
        tempPicks.push({
          season: year, round, roster_id: r.roster_id,
          owner_id: r.roster_id, previous_owner_id: r.roster_id,
        });
      });
    });
  });

  tradedPicks.forEach((tp) => {
    const match = tempPicks.find(
      (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
    );
    if (match) match.owner_id = tp.owner_id;
  });

  const currentDraft = drafts.find((d) => d.season === CURRENT_YEAR);

  if (mode === "perLeague") {
    const settingsRounds = Number(currentDraft?.settings?.rounds ?? currentDraft?.rounds) || 0;
    const tradedMaxRound = tradedPicks.reduce((max, tp) => Math.max(max, Number(tp.round) || 0), 0);
    const leagueRounds = Math.max(settingsRounds, tradedMaxRound, ROUNDS.length);
    tempPicks = tempPicks.filter((p) => Number(p.round) <= leagueRounds);
  }

  const rosterToUser: Record<number, string> = {};
  rosters.forEach((r) => { rosterToUser[r.roster_id] = r.owner_id; });
  const order = currentDraft?.draft_order || {};
  const totalDraftTeams = rosters.length || Number(currentDraft?.settings?.teams) || 0;

  tempPicks.forEach((pick) => {
    if (pick.season === CURRENT_YEAR) {
      const userId = rosterToUser[Number(pick.roster_id)];
      const baseSlot = Number(order[String(userId)] || 0);
      const slot = getDraftRoundSlot(currentDraft ?? {}, Number(pick.round), baseSlot, totalDraftTeams);
      if (slot) {
        pick.slot = `${pick.round}.${String(slot).padStart(2, "0")}`;
      } else if (mode === "perLeague") {
        pick.slot = `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`;
      } else {
        pick.slot = `${pick.round}`;
      }
    } else if (mode === "perLeague") {
      pick.slot = `${pick.round}`;
    }
  });

  return tempPicks;
}

/** Filters a league pick pool down to one owner's picks, sorted by season, round, then slot —
 *  the "my picks" view shared by loadRoster and useSpyState (useLeagueOverview doesn't call this;
 *  it keeps the full pool and lets its own caller filter/display differently). */
export function sortOwnerPicks(allPicks: AugmentedPick[], ownerRosterId: number): AugmentedPick[] {
  return allPicks
    .filter((p) => p.owner_id === ownerRosterId)
    .sort((a, b) => {
      if (a.season !== b.season) return Number(a.season) - Number(b.season);
      if (a.round !== b.round) return a.round - b.round;
      const aSlot = parseInt(a.slot?.split(".")[1] ?? "0", 10);
      const bSlot = parseInt(b.slot?.split(".")[1] ?? "0", 10);
      return aSlot - bSlot;
    });
}

/** Returns `players` with `.value` set from `values` (Sleeper ID -> FC value) for every player that
 *  has one. Non-mutating — the input map may already be held in React state — and only players whose
 *  value actually changes are cloned. Returns the SAME map when nothing changes, so re-applying
 *  identical values is a no-op for React. Merge-only: a player absent from `values` keeps whatever
 *  `.value` it already had. */
export const withFcValues = <P extends { value?: number }>(
  players: Record<string, P>,
  values: Record<string, number>
): Record<string, P> => {
  let merged: Record<string, P> | null = null;
  for (const id of Object.keys(values)) {
    const player = players[id];
    if (!player || player.value === values[id]) continue;
    merged ??= { ...players };
    merged[id] = { ...player, value: values[id] };
  }
  return merged ?? players;
};

/** Fetches dynasty values from the /api/fc-values proxy and normalises
 *  them into separate player and pick value maps keyed by Sleeper ID.
 *  Also returns raw trendData (trend30Day, tradeFrequency, redraftValue)
 *  for the market trends view — these are raw FC values, never league-adjusted.
 *  Throws when the proxy has no usable data (non-OK status, or an empty / non-array
 *  body) so callers never mistake an outage for "no player has a value" and cache that. */
export const fetchFantasyCalcValues = async (
  numQbs = 1,
  opts?: { force?: boolean }
): Promise<{ playerValues: Record<string, number>; pickValues: Record<string, number>; trendData: import("../types").FcTrendEntry[] }> => {
  const data = await getFcValuesRaw((numQbs === 2 ? 2 : 1), true, opts);

  const playerValues: Record<string, number> = {};
  const slotPickValues: Record<string, number[]> = {};
  const pickBuckets: Record<string, number[]>     = {};
  const pickRoundValues: Record<string, number>   = {};
  const pickBandValues: Record<string, number>    = {};
  const trendData: import("../types").FcTrendEntry[] = [];

  const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

  (data as FcEntry[]).forEach((entry) => {
    if (typeof entry.value !== "number" || entry.value <= 0) return;
    const value = entry.value;
    if (entry.player?.position === "PICK") {
      // Specific slot — e.g. "2026 Pick 1.04"
      const slotMatch = entry.player.name?.match(/^(\d{4}) Pick (\d+)\.(\d{1,2})$/);
      if (slotMatch) {
        const roundKey = `${slotMatch[1]}-${slotMatch[2]}`;
        const slotKey  = `${slotMatch[1]}-${slotMatch[2]}.${slotMatch[3].padStart(2, "0")}`;
        if (!slotPickValues[slotKey]) slotPickValues[slotKey] = [];
        slotPickValues[slotKey].push(value);
        if (!pickBuckets[roundKey]) pickBuckets[roundKey] = [];
        pickBuckets[roundKey].push(value);
        return;
      }
      // Named Early/Mid/Late band — e.g. "2027 1st (Early)". FantasyCalc only
      // publishes these for the nearest future draft class; must be checked
      // before the plain round regex below (which would otherwise ignore the
      // "(Early)" suffix and never match, but check order matters if that
      // pattern is ever loosened).
      const bandMatch = entry.player.name?.match(/^(\d{4})\s+(\d+)(?:st|nd|rd|th)\s+\((Early|Mid|Late)\)$/);
      if (bandMatch) {
        pickBandValues[`${bandMatch[1]}-${bandMatch[2]}-${bandMatch[3].toLowerCase()}`] = value;
        return;
      }
      // Future round — e.g. "2027 1st"
      const roundMatch = entry.player.name?.match(/^(\d{4})\s+(\d+)(?:st|nd|rd|th)$/);
      if (roundMatch) {
        pickRoundValues[`${roundMatch[1]}-${roundMatch[2]}`] = value;
      }
    } else {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) {
        playerValues[String(sleeperId)] = value;
        // Collect market trend data for skill positions only
        const pos = entry.player?.position ?? "";
        if (SKILL_POSITIONS.has(pos)) {
          trendData.push({
            sleeperId: String(sleeperId),
            name: entry.player?.name ?? "",
            position: pos,
            team: entry.player?.maybeTeam ?? "",
            value,
            redraftValue: entry.redraftValue ?? 0,
            trend30Day: entry.trend30Day ?? 0,
            tradeFrequency: entry.maybeTradeFrequency ?? 0,
          });
        }
      }
    }
  });

  const pickValues: Record<string, number> = {};

  // Average multiple slot entries for the same slot key
  Object.entries(slotPickValues).forEach(([key, vals]) => {
    pickValues[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });

  // Average current-year round buckets
  Object.entries(pickBuckets).forEach(([key, vals]) => {
    pickValues[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });

  // Fill future-year first-round values from named picks
  Object.entries(pickRoundValues).forEach(([key, val]) => {
    if (!pickValues[key]) pickValues[key] = val;
  });

  // Named Early/Mid/Late band values (e.g. "2027-1-early") — applied directly,
  // no derivation needed since FantasyCalc publishes these outright for the
  // nearest future draft class.
  Object.entries(pickBandValues).forEach(([key, val]) => {
    pickValues[key] = val;
  });

  // Derive future-year 2nd/3rd/4th using current-year ratios
  const base1st = pickValues[`${CURRENT_YEAR}-1`];
  if (base1st) {
    Object.entries(pickRoundValues).forEach(([key]) => {
      const [year, roundStr] = key.split("-");
      if (roundStr !== "1") return;
      const yr1stVal = pickValues[key];
      [2, 3, 4].forEach((r) => {
        const rKey = `${year}-${r}`;
        if (!pickValues[rKey]) {
          const baseCurrentYear = pickValues[`${CURRENT_YEAR}-${r}`];
          if (baseCurrentYear) {
            pickValues[rKey] = Math.round(yr1stVal * (baseCurrentYear / base1st));
          }
        }
      });
    });
  }

  // Mirror the latest published year forward by one. FantasyCalc publishes
  // CURRENT_YEAR + 2 as its furthest future year; when a league's current
  // rookie draft has completed, the pick-year window extends to CURRENT_YEAR + 3
  // and those picks would otherwise have no value. Guard ensures FC values win
  // if/when they start publishing the further-out year.
  const latestFcYearPrefix = `${Number(CURRENT_YEAR) + 2}-`;
  const mirrorYearPrefix   = `${Number(CURRENT_YEAR) + 3}-`;
  Object.entries(pickValues).forEach(([key, val]) => {
    if (!key.startsWith(latestFcYearPrefix)) return;
    const mirroredKey = mirrorYearPrefix + key.slice(latestFcYearPrefix.length);
    if (!(mirroredKey in pickValues)) pickValues[mirroredKey] = val;
  });

  return { playerValues, pickValues, trendData };
};

// ── User pick-value overrides ────────────────────────────────────────────────
// The user can replace FantasyCalc's pick values with their own (Draft Hub → Pick Values),
// one set for every league. Overrides use the same keys as the pick value map: an exact slot
// ("2027-1.01") for the next rookie class, a whole round ("2028-1") for later classes.
// FantasyCalc stays the default for every key the user hasn't set.

export const PICK_OVERRIDE_KEY_RE = /^(\d{4})-(\d+)(?:\.(\d{2}))?$/;

/** Slots per round the editor and the expansion below work in — FantasyCalc's slot prices are
 *  12-team, and the app reads slot N the same way in every league size. */
export const PICK_VALUE_SLOTS = 12;

const padSlot = (slot: number) => String(slot).padStart(2, "0");

/** Which Early/Mid/Late band a slot falls in — the same thirds the pick cards use. */
export const pickBandForSlot = (slot: number, slots = PICK_VALUE_SLOTS): "early" | "mid" | "late" => {
  if (slot <= Math.ceil(slots / 3)) return "early";
  if (slot <= Math.ceil((slots * 2) / 3)) return "mid";
  return "late";
};

/** A value map's price for one exact slot: the published slot price, else the slot's
 *  Early/Mid/Late band, else the round. 0 when the map has none of the three. */
export const slotValueFrom = (
  values: Record<string, number>,
  season: string | number,
  round: number,
  slot: number,
  slots = PICK_VALUE_SLOTS,
): number =>
  values[`${season}-${round}.${padSlot(slot)}`] ??
  values[`${season}-${round}-${pickBandForSlot(slot, slots)}`] ??
  values[`${season}-${round}`] ??
  0;

/** Drops anything that isn't a well-formed key with a positive, finite value. */
export const cleanPickValueOverrides = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (PICK_OVERRIDE_KEY_RE.test(key) && Number.isFinite(n) && n > 0) out[key] = Math.round(n);
  }
  return out;
};

/**
 * The pick value map with the user's overrides applied. With no overrides it returns
 * `market` itself, so every consumer sees FantasyCalc unchanged.
 *
 * A class with any slot override gets every slot of every round written out (the user's value
 * where set, otherwise the market price for that slot), and its Early/Mid/Late band and round
 * values are rebuilt from those slots. That keeps the three ways the app reads a pick — exact
 * slot (pick cards), band, round average (League Overview, direction, unknown-slot picks) —
 * agreeing with each other. A round override ("2028-1") replaces that round's value directly.
 */
export const applyPickValueOverrides = (
  market: Record<string, number>,
  overrides: Record<string, number>,
  slots = PICK_VALUE_SLOTS,
): Record<string, number> => {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return market;
  const out = { ...market };

  const slotEdits = new Map<string, Set<number>>(); // season -> rounds with a slot override
  for (const key of keys) {
    const m = key.match(PICK_OVERRIDE_KEY_RE);
    if (!m || !m[3]) continue;
    if (!slotEdits.has(m[1])) slotEdits.set(m[1], new Set());
    slotEdits.get(m[1])!.add(Number(m[2]));
  }

  for (const [season, editedRounds] of slotEdits) {
    const marketRounds = Object.keys(market)
      .map((key) => key.match(PICK_OVERRIDE_KEY_RE))
      .filter((m): m is RegExpMatchArray => !!m && m[1] === season)
      .map((m) => Number(m[2]));
    const lastRound = Math.max(ROUNDS.length, ...marketRounds, ...editedRounds);
    for (let round = 1; round <= lastRound; round++) {
      const values = Array.from({ length: slots }, (_, i) =>
        overrides[`${season}-${round}.${padSlot(i + 1)}`] ?? slotValueFrom(market, season, round, i + 1, slots));
      if (values.every((v) => v <= 0)) continue;
      values.forEach((v, i) => { out[`${season}-${round}.${padSlot(i + 1)}`] = v; });
      const mean = (vals: number[]) => Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      for (const band of ["early", "mid", "late"] as const) {
        const inBand = values.filter((_, i) => pickBandForSlot(i + 1, slots) === band);
        if (inBand.length > 0) out[`${season}-${round}-${band}`] = mean(inBand);
      }
      out[`${season}-${round}`] = mean(values);
    }
  }

  for (const key of keys) {
    const m = key.match(PICK_OVERRIDE_KEY_RE);
    if (m && !m[3]) out[key] = overrides[key];
  }
  return out;
};

/** Season-round keys ("2027-1") where the user set at least one exact slot — the pick cards
 *  read these rounds as the user's own slot-by-slot curve. */
export const userSlotCurveRounds = (overrides: Record<string, number>): Set<string> => {
  const rounds = new Set<string>();
  for (const key of Object.keys(overrides)) {
    const m = key.match(PICK_OVERRIDE_KEY_RE);
    if (m?.[3]) rounds.add(`${m[1]}-${m[2]}`);
  }
  return rounds;
};

/** The rookie class the Pick Values editor sets slot by slot: the earliest year FantasyCalc
 *  publishes slot or Early/Mid/Late prices for (its nearest class), else next year. */
export const nextPickValueClass = (market: Record<string, number>): string => {
  const years = Object.keys(market)
    .map((key) => key.match(/^(\d{4})-1(?:\.\d{2}|-early)$/)?.[1])
    .filter((y): y is string => !!y)
    .sort();
  return years[0] ?? String(Number(CURRENT_YEAR) + 1);
};
