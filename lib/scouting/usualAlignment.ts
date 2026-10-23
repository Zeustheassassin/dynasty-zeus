// ============================================================
// A player's usual alignment (the user, 2026-10-23): the WR and TE boards
// start each play where he lines up most, counted over every play charted
// for him (all games). The spot comes first (WR alignment, TE positioning),
// then his most common line / side at that spot: the spot is the stronger
// read (charted 10/23: a WR's top alignment is 62% of his snaps on average,
// a TE's top positioning 47%, but his Left vs Right only 53%). A tie goes to
// the one charted most recently. No plays yet → null, and the board keeps
// its own default (WR Right on the line, TE Left Inline). Pure: the boards
// count it once, when his plays first load as the board opens, and start
// every play on it while the board stays open (the user's call, 10/23: the
// same starting spot the whole time); the plays charted meanwhile count from
// the next time he's opened.
// ============================================================

import type { Alignment, RoutePlay, TELocation, TEPlay, TEPositioning } from "../types";

/** The latest play of the most common `key`, or null for no plays. `plays` in charting order. */
function mostCommon<T>(plays: readonly T[], key: (play: T) => string): T | null {
  const seen = new Map<string, { count: number; latest: number }>();
  plays.forEach((play, i) => {
    const k = key(play);
    seen.set(k, { count: (seen.get(k)?.count ?? 0) + 1, latest: i });
  });
  let best: { count: number; latest: number } | null = null;
  for (const s of seen.values()) {
    if (!best || s.count > best.count || (s.count === best.count && s.latest > best.latest)) best = s;
  }
  return best ? plays[best.latest] : null;
}

/** The most common `spot`, then the most common `detail` among the plays there. */
function usualSpot<T>(plays: readonly T[], spot: (play: T) => string, detail: (play: T) => string): T | null {
  const top = mostCommon(plays, spot);
  return top ? mostCommon(plays.filter((p) => spot(p) === spot(top)), detail) : null;
}

/** A WR's usual alignment, then his usual line there (a slot man off the line stays off it). */
export function usualWRAlignment(
  plays: readonly Pick<RoutePlay, "alignment" | "on_line">[],
): { alignment: Alignment; onLine: boolean } | null {
  const p = usualSpot(plays, (pl) => pl.alignment, (pl) => String(pl.on_line));
  return p ? { alignment: p.alignment, onLine: p.on_line } : null;
}

/** A TE's usual positioning, then his usual location there. */
export function usualTEAlignment(
  plays: readonly Pick<TEPlay, "location" | "positioning">[],
): { location: TELocation; positioning: TEPositioning } | null {
  const p = usualSpot(plays, (pl) => pl.positioning, (pl) => pl.location);
  return p ? { location: p.location, positioning: p.positioning } : null;
}
