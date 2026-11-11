// ============================================================
// NFL team draft capital (contracts plan, stage 6)
// ============================================================
// Pure: Wikipedia's "20XX NFL draft" page → who owns every pick of rounds
// 1–7. No API or CSV lists future pick ownership, but the draft pages list
// every traded pick in one fixed shape (checked 2026-11-11), so the user
// never enters picks by hand:
//
//   ==Trades involving draft picks==
//   ===Round 1===
//   *'''Green Bay → Dallas (PD).''' Green Bay traded a first-round selection…
//   *'''Baltimore → San Francisco → Indianapolis.''' Multiple trades:<br>
//   {{in5|7}}'''Baltimore → San Francisco (PD).''' …<br>
//   *'''Pittsburgh → Dallas (PD).''' See Round 3: [[#CowboysSteelersTrade|…]]
//
// The bold header is the pick's path: the team it started with first, its
// owner now last. "See Round N" bullets point at a trade told under another
// round through an {{Anchor|…}}, whose text is used for the pick.
//
// Every team starts with its own pick in each round, and each hop of a path
// is one MOVE from the team that sent a pick to the team that got it. The
// page names the right teams for every trade, but when a team sends on a
// pick it had ACQUIRED, the page still writes the sender as the original:
// "Minnesota → New England" for Philadelphia's 2027 7th that went Philadel-
// phia → Minnesota → New England. So the moves are replayed round by round:
// a move whose named pick its sender holds goes first (repeating, so a path's
// later hops follow its earlier ones); then a move whose named pick is gone
// takes the sender's acquired pick instead (oldest first), RELABELED. Every
// count comes out right that way, and the user's 2027 answers (2026-11-11)
// all come out of the page on their own: Houston's 7th → Cleveland,
// Philadelphia's 7th → New England (via Minnesota), Philadelphia's 6th →
// Jets, Kansas City's 7th → 49ers, Minnesota's 7th → Jets, Dallas's 6th →
// Pittsburgh (which holds its own 6th back from Dallas as well).
//
// Still flagged for the user:
//   * SHORT: a move whose sender holds no pick that round (2028: Jackson-
//     ville's 6th listed to Miami AND, conditionally, to New Orleans). Not
//     applied.
//   * CONDITIONAL: the pick itself carries a condition or a "whichever is
//     earlier" (Dallas's 2027 1st to the Jets). Owner as listed. A condition
//     on a different pick of the same trade doesn't count.
//   * RELABELED moves, listed for checking (counts are right; which original
//     moved was inferred), and a user answer the page no longer supports.
// Compensatory and JC-2A picks join the pages after March; forfeited picks
// would come off a "Forfeited picks" section (none for 2027 / 2028 yet).
// Neither is read yet.
// ============================================================

import { NFL_TEAMS, nflTeamId } from "./nflDraft";

export const DRAFT_ROUNDS = 7;
/** Day 1 = round 1, day 2 = rounds 2–3, day 3 = rounds 4–7. */
export type DraftDay = 1 | 2 | 3;
export const dayOfRound = (round: number): DraftDay => (round <= 1 ? 1 : round <= 3 ? 2 : 3);

/** The section of the draft page that lists traded picks. */
export const TRADES_SECTION = "Trades involving draft picks";

/** One traded pick as the page lists it. */
export interface PickTrade {
  year: number;
  round: number;
  /** ESPN team ids (lib/nflDraft.ts NFL_TEAMS) along the path: original first, owner now last. */
  chain: number[];
  /** The pick itself carries a condition (see the header). */
  conditional: boolean;
  /** The trade's text, markup stripped (a "See Round" bullet's points at the trade it names). */
  text: string;
}

export interface DraftTradesParse {
  year: number;
  trades: PickTrade[];
  /** Bullets that couldn't be read (a team name the map doesn't know, no path), as written. */
  unparsed: string[];
}

/** Wikipedia's city-style names → ESPN ids. Nicknames and abbreviations fall back to nflTeamId. */
const WIKI_TEAMS: Record<string, number> = {
  arizona: 22, atlanta: 1, baltimore: 33, buffalo: 2, carolina: 29, chicago: 3, cincinnati: 4, cleveland: 5,
  dallas: 6, denver: 7, detroit: 8, greenbay: 9, houston: 34, indianapolis: 11, jacksonville: 30, kansascity: 12,
  lasvegas: 13, larams: 14, losangelesrams: 14, lachargers: 24, losangeleschargers: 24, miami: 15, minnesota: 16,
  newengland: 17, neworleans: 18, nygiants: 19, newyorkgiants: 19, nyjets: 20, newyorkjets: 20, philadelphia: 21,
  pittsburgh: 23, sanfrancisco: 25, seattle: 26, tampabay: 27, tennessee: 10, washington: 28,
};

/** A team as the draft page writes it ("NY Jets", "LA Rams", "Green Bay") → its ESPN id, or null. */
export function wikiTeamId(name: string): number | null {
  const key = name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
  return WIKI_TEAMS[key] ?? nflTeamId(name);
}

const ROUND_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

/** Strips refs, comments, templates and link markup down to the words a reader sees. */
export function plainText(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The "Trades involving draft picks" section of a whole page (comments removed first: the pages keep
 *  headings like "==Forfeited picks==" commented out), or the text as given when it has no such heading. */
export function tradesSection(wikitext: string): string {
  const text = wikitext.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const start = text.search(/^==\s*Trades involving draft picks\s*==\s*$/m);
  if (start < 0) return text;
  const rest = text.slice(start);
  const end = rest.slice(2).search(/^==[^=].*==\s*$/m);
  return end < 0 ? rest : rest.slice(0, end + 2);
}

/**
 * Whether this round's pick carries a condition: "a conditional sixth-round selection" (with no year, or this
 * year), or a "whichever is earlier" / swap. "A conditional 2026 seventh-round selection" in the same trade is
 * another pick, so it doesn't count.
 */
export function isConditionalPick(text: string, round: number, year: number): boolean {
  const word = ROUND_WORDS[round - 1];
  if (!word) return false;
  const re = /conditional\s+(?:(\d{4})\s+)?([a-z]+)[\s-]+round/gi;
  for (const m of text.matchAll(re)) {
    if ((m[1] == null || Number(m[1]) === year) && m[2].toLowerCase() === word) return true;
  }
  return /\bwhichever\b|\bswap\b|\bmay be upgraded\b|\bthe (?:earlier|later|higher|lower|better|worse) of\b/i.test(text);
}

/** The header's path ("Baltimore → San Francisco → Indianapolis") → ESPN ids, or null if a name is unknown. */
function chainOf(header: string): number[] | null {
  const parts = header
    .replace(/&rarr;/g, "→")
    .replace(/\((?:PD|D)\)/g, "")
    .replace(/[.\s]+$/, "")
    .split("→")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const ids = parts.map(wikiTeamId);
  return ids.every((id): id is number => id != null) ? ids : null;
}

/** Every traded pick on a draft page (the whole page or just its trades section). */
export function parseDraftTrades(wikitext: string, year: number): DraftTradesParse {
  const section = tradesSection(wikitext);

  // Bullets with their continuation lines ("Multiple trades:" steps), under their round.
  const bullets: { round: number; raw: string }[] = [];
  let round = 0;
  for (const line of section.split(/\r?\n/)) {
    const heading = /^===\s*Round\s+(\d+)\s*===\s*$/.exec(line);
    if (heading) { round = Number(heading[1]); continue; }
    if (/^==/.test(line)) { round = 0; continue; }
    if (round < 1 || round > DRAFT_ROUNDS) continue;
    if (line.startsWith("*")) bullets.push({ round, raw: line.slice(1) });
    else if (line.trim() && bullets.length && bullets[bullets.length - 1].round === round) bullets[bullets.length - 1].raw += `\n${line}`;
  }

  const anchors = new Map<string, string>();
  for (const b of bullets) {
    for (const m of b.raw.matchAll(/\{\{\s*[Aa]nchor\s*\|([^}]*)\}\}/g)) {
      for (const name of m[1].split("|")) anchors.set(name.trim(), b.raw);
    }
  }

  const trades: PickTrade[] = [];
  const unparsed: string[] = [];
  for (const b of bullets) {
    const body = b.raw.replace(/^\s*(\{\{\s*[Aa]nchor\s*\|[^}]*\}\}\s*)*/, "");
    const header = /^'''([\s\S]*?)'''/.exec(body);
    const chain = header ? chainOf(plainText(header[1])) : null;
    if (!chain) { unparsed.push(plainText(b.raw)); continue; }
    const seeAnchor = /See Round \d+:\s*\[\[#([^|\]]+)/.exec(body);
    const told = seeAnchor ? anchors.get(seeAnchor[1].trim()) : undefined;
    const text = plainText(told ?? body);
    trades.push({ year, round: b.round, chain, conditional: isConditionalPick(text, b.round, year), text });
  }
  return { year, trades, unparsed };
}

/** One pick a team owns. */
export interface OwnedPick {
  year: number;
  round: number;
  day: DraftDay;
  /** The team the pick started with. */
  original: number;
  owner: number;
  /** The teams it passed through (original first, owner last); just [original] for a team's own pick. */
  via: number[];
  /** A trade that moved it carries a condition on it. */
  conditional: boolean;
  /** It moved on a trade the page labeled with a different original (an acquired pick sent on): the count
   *  is right, which pick moved was inferred (see the header). */
  relabeled: boolean;
  /** The user confirmed its owner (DRAFT_PICK_RESOLUTIONS). */
  resolved: boolean;
  /** The last trade that moved it, null for a team's own pick. */
  trade: string | null;
}

export interface TeamDraftCapital {
  teamId: number;
  year: number;
  /** By round, then original team. */
  picks: OwnedPick[];
  /** Picks per round, index 0 = round 1. */
  byRound: number[];
  /** Picks per draft day: [day 1, day 2, day 3]. */
  byDay: [number, number, number];
}

export type PickIssueKind = "short" | "relabeled" | "conditional" | "resolution" | "unparsed";

/** Something on the page for the user to look at. */
export interface PickIssue {
  kind: PickIssueKind;
  year: number;
  round: number | null;
  /** The original team the page names (or the user's answer is about); null for an unparsed bullet. */
  original: number | null;
  /** The team it went to (the page's, or the user's answer). */
  owners: number[];
  /** RELABELED: the original that actually moved. */
  moved?: number;
  texts: string[];
}

export interface DraftCapital {
  year: number;
  teams: TeamDraftCapital[];
  issues: PickIssue[];
}

/** The key draftCapital's `resolve` takes: year, round and the pick's ORIGINAL team, e.g. "2027-7-34". */
export const pickKey = (year: number, round: number, original: number) => `${year}-${round}-${original}`;

/**
 * Picks whose owner the user confirmed: pickKey → owner (ESPN id). The user's 2027 cross-check
 * (2026-11-11); the replayed moves already give every one of these, so today they only confirm.
 */
export const DRAFT_PICK_RESOLUTIONS: Readonly<Record<string, number>> = {
  [pickKey(2027, 7, 34)]: 5, // Houston's 7th → Cleveland
  [pickKey(2027, 7, 21)]: 17, // Philadelphia's 7th → New England (via Minnesota)
  [pickKey(2027, 6, 21)]: 20, // Philadelphia's 6th → Jets
  [pickKey(2027, 7, 12)]: 25, // Kansas City's 7th → 49ers
  [pickKey(2027, 7, 16)]: 20, // Minnesota's 7th → Jets
  [pickKey(2027, 6, 6)]: 23, // Dallas's 6th → Pittsburgh
};

/** One hop of a trade's path: `from` sends the pick the page names (`named`, its first team) to `to`. */
interface Move { from: number; to: number; named: number; trade: PickTrade }

/**
 * Every team's picks for one draft: its own seven, moved by the page's trades (see the header). `resolve`
 * (pickKey → owner) holds the user's answers: a pick already ending there is marked resolved; one that
 * doesn't swaps owners with a RELABELED pick of that round the answer's team holds (counts unchanged).
 * With none to swap, the answer no longer fits the page: flagged, not forced.
 */
export function draftCapital(parse: DraftTradesParse, resolve: Readonly<Record<string, number>> = {}): DraftCapital {
  const { year } = parse;
  const teamIds = Object.keys(NFL_TEAMS).map(Number);
  const issues: PickIssue[] = [];
  const all: OwnedPick[] = [];

  for (let round = 1; round <= DRAFT_ROUNDS; round++) {
    const held = new Map<number, OwnedPick[]>();
    for (const id of teamIds) {
      const own: OwnedPick = {
        year, round, day: dayOfRound(round), original: id, owner: id, via: [id],
        conditional: false, relabeled: false, resolved: false, trade: null,
      };
      held.set(id, [own]);
      all.push(own);
    }

    // Exact repeats of one bullet (the page lists some twice) are one trade.
    const trades = parse.trades.filter((t, i, list) => t.round === round
      && list.findIndex((u) => u.round === round && u.text === t.text && u.chain.join() === t.chain.join()) === i);
    let pending: Move[] = trades.flatMap((trade) =>
      trade.chain.slice(1).map((to, i) => ({ from: trade.chain[i], to, named: trade.chain[0], trade })));

    const move = (m: Move, pick: OwnedPick, relabeled: boolean) => {
      const from = held.get(m.from)!;
      from.splice(from.indexOf(pick), 1);
      held.get(m.to)!.push(pick);
      pick.owner = m.to;
      pick.via.push(m.to);
      pick.conditional ||= m.trade.conditional;
      pick.relabeled ||= relabeled;
      pick.trade = m.trade.text;
      if (relabeled) issues.push({ kind: "relabeled", year, round, original: m.named, owners: [m.to], moved: pick.original, texts: [m.trade.text] });
    };

    for (;;) {
      // Moves whose named pick the sender holds, repeated so a path's later hops follow its earlier ones.
      let progress = true;
      while (progress) {
        progress = false;
        pending = pending.filter((m) => {
          const pick = held.get(m.from)?.find((p) => p.original === m.named);
          if (!pick) return true;
          move(m, pick, false);
          progress = true;
          return false;
        });
      }
      // Then the first move (page order) whose named pick is gone takes the sender's oldest acquired pick.
      const i = pending.findIndex((m) => (held.get(m.from)?.length ?? 0) > 0);
      if (i < 0) break;
      const m = pending[i];
      const list = held.get(m.from)!;
      pending.splice(i, 1);
      move(m, list.find((p) => p.original !== m.from) ?? list[0], true);
    }
    for (const m of pending) issues.push({ kind: "short", year, round, original: m.named, owners: [m.to], texts: [m.trade.text] });

    // The user's answers.
    for (const id of teamIds) {
      const want = resolve[pickKey(year, round, id)];
      if (want == null) continue;
      const pick = all.find((p) => p.round === round && p.original === id)!;
      if (pick.owner !== want) {
        const swap = held.get(want)?.find((p) => p.relabeled && !p.resolved);
        if (!swap) {
          issues.push({ kind: "resolution", year, round, original: id, owners: [want], texts: [`the page's trades end this pick with team ${pick.owner}`] });
          continue;
        }
        const a = held.get(pick.owner)!;
        const b = held.get(want)!;
        a.splice(a.indexOf(pick), 1, swap);
        b.splice(b.indexOf(swap), 1, pick);
        swap.via[swap.via.length - 1] = swap.owner = pick.owner;
        pick.via[pick.via.length - 1] = pick.owner = want;
      }
      pick.resolved = true;
    }
  }

  for (const p of all) {
    if (p.conditional) issues.push({ kind: "conditional", year, round: p.round, original: p.original, owners: [p.owner], texts: p.trade ? [p.trade] : [] });
  }
  for (const text of parse.unparsed) issues.push({ kind: "unparsed", year, round: null, original: null, owners: [], texts: [text] });

  const teams = teamIds.map((teamId): TeamDraftCapital => {
    const picks = all.filter((p) => p.owner === teamId).sort((a, b) => a.round - b.round || a.original - b.original);
    const byRound = Array.from({ length: DRAFT_ROUNDS }, (_, i) => picks.filter((p) => p.round === i + 1).length);
    const byDay: [number, number, number] = [0, 0, 0];
    for (const p of picks) byDay[p.day - 1]++;
    return { teamId, year, picks, byRound, byDay };
  });
  return { year, teams, issues };
}
