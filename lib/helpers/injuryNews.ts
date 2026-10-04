// ============================================================
// Reads ESPN's one-line injury notes for a game-status lean. The official tag
// can lag the news by hours: on 2026-10-04 Jalen Coker was still "Questionable"
// everywhere while his note read "Coker (quadriceps) is unlikely to suit up for
// Sunday night's game". His inactive designation would only land ~90 minutes
// before an 8:20 PM kickoff, after every earlier game had locked.
//
// No AI — the notes are RotoWire-style one-liners ("X (ankle) is expected to
// play…", "X has been ruled out…"), so plain phrase rules cover them. Pure so
// the rules are unit-testable against real notes.
// ============================================================
import { matchEspnInjuryEntries, type EspnInjuryEntry } from "./injuryOverrides";
import type { SleeperPlayer } from "../types";

/** What a note says about this week's game. */
export type InjuryNewsLean = "likely-out" | "uncertain" | "likely-in";

export interface InjuryNewsFlag {
  lean: InjuryNewsLean;
  /** The ESPN note itself, shown to the user so they can judge the call. */
  comment: string;
  /** When ESPN posted it (ISO). */
  date: string | null;
}

/** Notes older than this are about an earlier game. A Questionable tag is set
 *  late in the week for the next game, so anything newer belongs to it. */
export const INJURY_NEWS_MAX_AGE_MS = 6 * 24 * 60 * 60_000;

// Verb phrases for "takes part in the game" and "misses the game".
const PLAY = String.raw`(?:play|suit up|dress|go|take the field|start|return|be (?:available|active|in the lineup|a full go|on the field))`;
const MISS = String.raw`(?:miss|sit(?: out)?|be inactive|be held out|be sidelined|be out)`;

// Ignore a phrase in a clause about someone else ("…due to Nico Collins being
// ruled out", "…while teammate Jadarian Price has been ruled out") or in a
// condition ("Y would start if X can't play").
const SUBORDINATE = /\b(?:due to|because of|while|whereas|teammate|with|replacing|in place of|if|unless|in case)\b/;
// A sentence that only describes what happens IF something else does.
const CONDITIONAL = /^\s*(?:if|should|in the event|in case|whether)\b/;
// "not expected", "hasn't been ruled out".
const NEGATED = /(?:\bnot|n't|\bnever|\bno longer)\s+(?:been\s+|be\s+)?$/;
// Periods that don't end a sentence: "St. Brown", "A.J.", "D.C.", "No. 2".
const ABBREVIATION = /\b(?:st|jr|sr|no|vs|mr|dr|[a-z])\./g;
const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv|v)$/;

const OUT_RULES: RegExp[] = [
  new RegExp(String.raw`\b(?:unlikely|not expected|isn't expected|not likely|isn't likely|not slated|not set|not on track|doubtful|no chance) to ${PLAY}\b`),
  new RegExp(String.raw`\b(?:won't|will not|can't|cannot|is not going to|isn't going to) ${PLAY}\b`),
  /\b(?:is|was|been|be) ruled out\b/,
  /\bruled out (?:for|of)\b/,
  /\b(?:has|have|had) ruled out\b|\bruled (?!out\b)[\w.'-]+ out\b/,
  /\bdowngraded to out\b/,
  /\b(?:is|was|been|be|listed as) inactive\b/,
  /\bamong (?:the )?[\w.' ]{0,30}inactives\b/,
  /\b(?:did not|didn't|won't|will not) travel\b/,
  /\btrending toward (?:missing|sitting)\b/,
];
// "expected to miss" / "will miss" — but "isn't expected to miss" means he plays.
const MISS_RULE = new RegExp(String.raw`\b(?:(?:expected|set|slated|likely|poised|going|scheduled|planning|on track) to|will) ${MISS}\b`);
const NOT_MISS_RULE = new RegExp(String.raw`\b(?:unlikely|not expected|isn't expected|not likely|isn't likely|won't|will not) (?:to )?${MISS}\b`);

const UNCERTAIN_RULES: RegExp[] = [
  /\bgame-time decision\b/,
  /\buncertain\b/,
  /\bin doubt\b/,
  /\b50-50\b/,
  /\bhas not been ruled out\b|\bhasn't been ruled out\b|\bnot been ruled out\b/,
  /\btrue(?:ly)? questionable\b/,
];

const IN_RULES: RegExp[] = [
  new RegExp(String.raw`\b(?:expected|set|on track|plans|planning|slated|poised|likely|cleared|good|going|able|scheduled|in line|ready|ticketed) to ${PLAY}\b`),
  new RegExp(String.raw`\bwill ${PLAY}\b`),
  /\btrending toward (?:playing|suiting up|being available)\b/,
  /\b(?:is|was|listed as) active\b/,
  /\bgood to go\b/,
  /\b(?:no|doesn't have an|does not have an|doesn't carry an|does not carry an) injury designation\b/,
  /\bdesignation\b.{0,60}\bcleared\b|\bcleared\b.{0,30}\bdesignation\b/,
  /\bremoved from the injury report\b/,
];

const normalize = (text: string) =>
  text.toLowerCase().replace(/[‘’]/g, "'").replace(ABBREVIATION, (m) => m.slice(0, -1));

/** The surname a note refers to its player by — "St. Brown", not "Jr.". */
const surnameOf = (name: string | null | undefined): string | null => {
  const tokens = normalize(name ?? "").split(/\s+/).filter((t) => t && !NAME_SUFFIX.test(t.replace(/\W/g, "")));
  return tokens.length > 1 ? tokens[tokens.length - 1] : null;
};

/** Whether `re` matches `sentence` somewhere that isn't negated, isn't in a
 *  clause about someone else, and (when we know the surname) comes after the
 *  player is named — so "…reports that Terry McLaurin is expected to miss" in
 *  a teammate's note isn't read as the teammate missing. */
const findClean = (sentence: string, re: RegExp, surname: string | null): boolean => {
  const global = new RegExp(re.source, "g");
  for (let m = global.exec(sentence); m; m = global.exec(sentence)) {
    const before = sentence.slice(0, m.index);
    if (NEGATED.test(before)) continue;
    // Only the clause the phrase sits in — "X, who is dealing with a sore
    // hamstring, is expected to play" is still about X.
    if (SUBORDINATE.test(before.slice(before.lastIndexOf(",") + 1))) continue;
    // Named before the phrase, or inside it ("the Panthers ruled Coker out").
    if (surname && !sentence.slice(0, m.index + m[0].length).includes(surname)) continue;
    return true;
  }
  return false;
};

/**
 * The game-status lean of one ESPN note, or null when it says nothing about
 * playing (a stat line, a practice report, a bare "questionable"). Out
 * phrases win over in phrases so "not expected to play" never reads as
 * "expected to play". Pass the player's name when known: a phrase then counts
 * only once the note has named him in that sentence.
 */
export function classifyInjuryNews(
  comment: string | null | undefined,
  playerName?: string | null
): InjuryNewsLean | null {
  if (!comment) return null;
  const text = normalize(comment);
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s && !CONDITIONAL.test(s));
  if (sentences.length === 0) return null;
  // A note that never uses his surname (a nickname, say) gets no subject check.
  const named = surnameOf(playerName);
  const surname = named && text.includes(named) ? named : null;
  const any = (rules: RegExp[]) => sentences.some((s) => rules.some((re) => findClean(s, re, surname)));

  if (any([NOT_MISS_RULE])) return "likely-in";
  if (any([...OUT_RULES, MISS_RULE])) return "likely-out";
  if (sentences.some((s) => UNCERTAIN_RULES.some((re) => re.test(s)))) return "uncertain";
  if (any(IN_RULES)) return "likely-in";
  return null;
}

/**
 * News leans for the players ESPN currently lists as Questionable, keyed by
 * Sleeper player id. Only Questionable players count: Out/Doubtful are already
 * kept out of lineups by their tag, and ESPN's "Active" rows carry last week's
 * notes ("X is inactive for Sunday's game" from the week before).
 */
export function buildInjuryNewsFlags(
  players: Record<string, SleeperPlayer>,
  injuries: EspnInjuryEntry[],
  now: number = Date.now()
): Record<string, InjuryNewsFlag> {
  const flags: Record<string, InjuryNewsFlag> = {};
  for (const { player, entry } of matchEspnInjuryEntries(players, injuries)) {
    if (entry.status.trim().toLowerCase() !== "questionable" || !entry.comment) continue;
    const postedAt = entry.date ? Date.parse(entry.date) : NaN;
    if (!Number.isFinite(postedAt) || now - postedAt > INJURY_NEWS_MAX_AGE_MS) continue;
    const lean = classifyInjuryNews(entry.comment, entry.name);
    if (lean) flags[player.player_id] = { lean, comment: entry.comment, date: entry.date };
  }
  return flags;
}
