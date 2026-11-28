"use client";
import { useMemo } from "react";
import type { SleeperLeague } from "../lib/types";
import { leagueFormat, type LeagueFormat } from "../lib/helpers/leagueFormat";
import { homeFormat, leagueValues, type FormatValue, type LeagueValue, type ValueFormat } from "../lib/helpers/positionalValue";
import { useNflSeasonLines } from "./useNflSeasonLines";

export interface UseLeaguePositionalValuesReturn {
  /** Every league's format, in the order the app lists them. */
  formats: LeagueFormat[];
  /** The dynasty leagues the usual format is read from (every league when there are none). */
  dynasty: LeagueFormat[];
  /** The usual format: the user's pinned scoring plus the most common of everything else across `dynasty`. */
  home: ValueFormat | null;
  /** The usual format's own values and every league's multipliers against it; null until the seasons load. */
  values: { home: FormatValue; byLeague: Map<string, LeagueValue> } | null;
  seasons: number[];
  error: string | null;
  retry: () => void;
}

/**
 * Positional value per league (stage 1 of the 2026-11-27 plan), the one way
 * the app reads it: League Formats shows it, the Rookie Big Board's league
 * picker sorts by it. The seasons load once `enabled` is true.
 */
export function useLeaguePositionalValues(leagues: readonly SleeperLeague[], enabled = true): UseLeaguePositionalValuesReturn {
  const formats = useMemo(() => leagues.map(leagueFormat), [leagues]);
  const dynasty = useMemo(() => {
    const d = formats.filter((f) => f.kind === "Dynasty");
    return d.length ? d : formats;
  }, [formats]);
  const home = useMemo(() => homeFormat(dynasty), [dynasty]);
  const { lines, seasons, error, retry } = useNflSeasonLines(enabled);
  const values = useMemo(() => (lines && home ? leagueValues(lines, formats, home) : null), [lines, home, formats]);
  return { formats, dynasty, home, values, seasons, error, retry };
}
