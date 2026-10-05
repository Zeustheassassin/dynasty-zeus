// The game-context and trait groups on the Analysis tables (and so Compare)
// (tape-grading expansion, Stage 5). Per prospect, over his charted games:
// the defenses he faced (SP+), bad-weather games, his supporting cast's PFF
// grades, his snap share and the user's game flags; and his trait grades
// (1–10, new games only). Shown only: of these, only opponent defense SP+
// and weather reach a score, and only where their tests passed
// (contextGrading.ts); traits sit beside the AE Score.
import type { ColDef } from "./StatsTableShell";
import type { ScoutingGame } from "../../../lib/types";
import { COLD_F, RAIN_IN, resolveGameContexts, type GameContextData } from "../../../lib/scouting/gameContext";
import { traitAverages, traitsFor } from "../../../lib/scouting/traits";

const CONTEXT = "Game Context";
const TRAITS = "Traits (your grades)";

/** Wind at or over this many mph makes a game a bad-weather game. */
const WINDY_MPH = 15;

export function contextCols(pos: string): ColDef[] {
  return [
    { key: "ctx_def", label: "Opp D", group: CONTEXT, fmt: "dec1", colorDir: -1, width: 54,
      tooltip: "Average defensive SP+ of his charted FBS opponents: points allowed per game vs an average offense (lower is a tougher schedule). Counts in the AE Score only where its test passed." },
    { key: "ctx_fcs", label: "FCS", group: CONTEXT, fmt: "count", width: 40, tooltip: "Charted games against FCS opponents (no SP+)" },
    { key: "ctx_wx", label: "Bad Wx", group: CONTEXT, fmt: "count", width: 54,
      tooltip: `Charted games in rain (${RAIN_IN}"+), wind ${WINDY_MPH}+ mph or under ${COLD_F}°F (outdoors, game window)` },
    { key: "ctx_ol_pb", label: "OL PB", group: CONTEXT, fmt: "dec1", colorDir: 1, width: 50,
      tooltip: "His offensive line's average PFF pass-block grade in his charted games. Shown only: supporting cast is never in a score." },
    { key: "ctx_ol_rb", label: "OL RB", group: CONTEXT, fmt: "dec1", colorDir: 1, width: 50,
      tooltip: "His offensive line's average PFF run-block grade in his charted games. Shown only." },
    ...(pos === "QB" ? [] : [{ key: "ctx_qb", label: "QB Gr", group: CONTEXT, fmt: "dec1", colorDir: 1, width: 50,
      tooltip: "His quarterback's average PFF passing grade in his charted games. Shown only." } as ColDef]),
    { key: "ctx_snap", label: "Snap%", group: CONTEXT, fmt: "pct", colorDir: 1, width: 52,
      tooltip: "His average share of the team's offensive snaps in his charted games (PFF)" },
    { key: "ctx_left", label: "Left", group: CONTEXT, fmt: "count", width: 40, tooltip: "Charted games you confirmed he left early" },
    { key: "ctx_hurt", label: "Hurt", group: CONTEXT, fmt: "count", width: 40, tooltip: "Charted games you marked played hurt" },
  ];
}

export function traitCols(pos: string): ColDef[] {
  return [
    ...traitsFor(pos).map((t): ColDef => ({
      key: `trait_${t.key}`, label: t.short, group: TRAITS, fmt: "dec1", colorDir: 1, width: 44,
      tooltip: `${t.label}: your 1–10 grade, averaged over graded new games.${t.coveredBy ? ` Beside the AE Score (${t.coveredBy} measures it).` : " Counts with the Big Board's \"With traits\" toggle."}`,
    })),
    { key: "trait_games", label: "n", group: TRAITS, fmt: "count", width: 36, tooltip: "Games with any trait graded" },
  ];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (x: number | null) => (x == null ? null : parseFloat(x.toFixed(1)));

/** prospect → the context and trait fields the columns above read. */
export function contextExtras(
  prospects: readonly { id: string; position: string }[],
  games: readonly ScoutingGame[],
  data: GameContextData | undefined,
): Map<string, Record<string, number | null>> {
  const contexts = resolveGameContexts(games, data ?? { rows: [], cfdGames: [], teamSeasons: [] });
  const traits = traitAverages(prospects, games);
  const byProspect = new Map<string, ScoutingGame[]>();
  for (const g of games) (byProspect.get(g.prospect_id) ?? byProspect.set(g.prospect_id, []).get(g.prospect_id)!).push(g);
  const out = new Map<string, Record<string, number | null>>();
  for (const p of prospects) {
    const gs = byProspect.get(p.id) ?? [];
    const cs = gs.map((g) => contexts.get(g.id)).filter((c) => c != null);
    const row: Record<string, number | null> = {
      ctx_def: r1(mean(cs.filter((c) => c.oppDefSp != null && !c.opponentFcs).map((c) => c.oppDefSp!))),
      ctx_fcs: cs.filter((c) => c.opponentFcs).length,
      ctx_wx: cs.filter((c) => c.weather?.status === "ok" && ((c.weather.precipIn ?? 0) >= RAIN_IN || (c.weather.windMph ?? 0) >= WINDY_MPH || (c.weather.temperatureF ?? 99) < COLD_F)).length,
      ctx_ol_pb: r1(mean(cs.map((c) => c.cast?.olPassBlock).filter((v): v is number => v != null))),
      ctx_ol_rb: r1(mean(cs.map((c) => c.cast?.olRunBlock).filter((v): v is number => v != null))),
      ctx_qb: r1(mean(cs.map((c) => c.cast?.qbPassGrade).filter((v): v is number => v != null))),
      ctx_snap: r1(mean(cs.map((c) => c.snapShare).filter((v): v is number => v != null).map((v) => v * 100))),
      ctx_left: gs.filter((g) => g.left_early === true).length,
      ctx_hurt: gs.filter((g) => g.played_hurt === true).length,
    };
    const t = traits.get(p.id);
    for (const def of traitsFor(p.position)) row[`trait_${def.key}`] = r1(t?.[def.key]?.avg ?? null);
    row.trait_games = t ? Math.max(0, ...Object.values(t).map((x) => x.games)) : 0;
    out.set(p.id, row);
  }
  return out;
}
