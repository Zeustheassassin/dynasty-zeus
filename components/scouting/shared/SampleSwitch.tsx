"use client";
// The imported-game "Count in sample" switch on a charting board (stage 3 of
// the 2026-11-26 scouting plan; lib/scouting/sampleGames.ts has the rule). The
// board works out the switch from his games and plays (sampleSwitchFor); the
// shell draws the summary above the games list, a toggle on each imported
// game, and a line on the report tabs while any game is set aside.
import type { ScoutingGame } from "../../../lib/types";
import {
  SAMPLE_UNIT, countInSampleReady, countsInSample, isImportedGame, showsSampleSwitch, type SampleSwitch,
} from "../../../lib/scouting/sampleGames";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "48 routes", "1 run": a count in the position's sample unit. */
function plays(n: number, sw: SampleSwitch): string {
  const unit = SAMPLE_UNIT[sw.pos];
  return `${n.toLocaleString()} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}

interface PanelProps {
  sw: SampleSwitch;
  games: readonly ScoutingGame[];
  onSet?: (ids: string[], value: boolean) => void | Promise<void>;
  error?: string | null;
}

/** Above the games list: his imported games, his in-app sample against the floor, and switch-all buttons. */
export function SampleSwitchPanel({ sw, games, onSet, error }: PanelProps) {
  if (sw.importedGames === 0) return null;
  const ready = countInSampleReady(games) !== false;
  const imported = games.filter(isImportedGame);
  const offIds = imported.filter((g) => !countsInSample(g)).map((g) => g.id);
  const onIds = imported.filter(countsInSample).map((g) => g.id);
  const canSet = ready && onSet != null;
  return (
    <div className="mb-2 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs space-y-1.5">
      <div className="text-slate-300">
        <span className="font-medium">Imported games</span>{" "}
        <span className="text-slate-400">{plural(sw.importedGames, "game")} · {plays(sw.importedPlays, sw)}</span>
        {sw.setAsideGames > 0 && <span className="text-amber-300"> · {sw.setAsideGames} set aside</span>}
      </div>
      <div className="text-slate-500">
        In the app: <span className={sw.open ? "text-emerald-400" : "text-slate-300"}>{plays(sw.inAppPlays, sw)}</span>
        {sw.open ? ` (half a sample is ${sw.half}).` : `. Count in sample opens at ${sw.half} (half a sample).`}
      </div>
      {!ready ? (
        <div className="text-amber-300">Count in sample needs migration 107.</div>
      ) : (sw.open || offIds.length > 0) && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {sw.open && onIds.length > 0 && (
              <button type="button" disabled={!canSet} onClick={() => onSet?.(onIds, false)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-200 rounded transition">
                Set all aside
              </button>
            )}
            {offIds.length > 0 && (
              <button type="button" disabled={!canSet} onClick={() => onSet?.(offIds, true)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-emerald-300 rounded transition">
                Count all
              </button>
            )}
          </div>
          <div className="text-slate-500">
            Set aside: out of his sample, stats and grades. The league models keep the plays.
          </div>
        </>
      )}
      {error && <p role="alert" className="text-red-400">{error}</p>}
    </div>
  );
}

interface ToggleProps {
  game: ScoutingGame;
  sw: SampleSwitch;
  ready: boolean;
  onSet?: (ids: string[], value: boolean) => void | Promise<void>;
}

/** On an imported game's row: its switch once it shows (showsSampleSwitch), else an "Imported" chip. */
export function GameSampleToggle({ game, sw, ready, onSet }: ToggleProps) {
  if (!isImportedGame(game)) return null;
  const n = sw.playsByGame.get(game.id) ?? 0;
  const label = `${game.season_year} ${game.opponent}`.trim();
  if (!showsSampleSwitch(game, sw)) {
    return (
      <span title={`Imported before May 1, 2026 (old press definition), ${plays(n, sw)}. Count in sample opens at ${sw.half} ${SAMPLE_UNIT[sw.pos]} in the app (he has ${sw.inAppPlays}).`}
        className="px-1.5 py-0.5 rounded border border-slate-700 text-[10px] text-slate-500 flex-shrink-0">
        Imported
      </span>
    );
  }
  const on = countsInSample(game);
  return (
    <button type="button" disabled={!ready || !onSet} aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); void onSet?.([game.id], !on); }}
      title={on
        ? `Imported game, ${plays(n, sw)}, counting in his sample. Click to set it aside (the league models keep it).`
        : `Imported game, ${plays(n, sw)}, set aside: not in his sample. Click to count it again.`}
      aria-label={`${on ? "Set aside" : "Count"} imported game ${label}`}
      className={`px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0 transition disabled:opacity-50 ${
        on ? "border-emerald-700 text-emerald-300 hover:bg-emerald-950" : "border-amber-700 text-amber-300 hover:bg-amber-950"
      }`}>
      {on ? "In sample" : "Set aside"}
    </button>
  );
}

/** On Overview, Breakdown and Games while a game is set aside. */
export function SetAsideNote({ sw }: { sw: SampleSwitch | null | undefined }) {
  if (!sw || sw.setAsideGames === 0) return null;
  return (
    <div className="px-3 py-2 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-200">
      {plural(sw.setAsideGames, "imported game")} ({plays(sw.setAsidePlays, sw)}) set aside: his numbers here leave
      {sw.setAsideGames === 1 ? " it" : " them"} out, the league models keep {sw.setAsideGames === 1 ? "it" : "them"}.
      Switch {sw.setAsideGames === 1 ? "it" : "them"} back on in Chart Game.
    </div>
  );
}

/** Beside a set-aside game's opponent in a board's Games table. */
export function SetAsideMark({ game }: { game: ScoutingGame }) {
  if (countsInSample(game)) return null;
  return (
    <span title="Imported game set aside: not in his sample (Chart Game switches it back on)."
      className="ml-1.5 px-1 py-0.5 rounded border border-amber-800 text-[10px] font-normal text-amber-300">
      set aside
    </span>
  );
}

/** A Games table's totals label: the charted totals are his sample's, PFF's cover every game. */
export function SampleTotalLabel({ games }: { games: readonly ScoutingGame[] }) {
  const aside = games.filter((g) => !countsInSample(g)).length;
  if (aside === 0) return <>Total ({games.length} games)</>;
  return (
    <span title="Your charting: his sample, the set-aside games left out. PFF's columns: every game.">
      Sample total ({games.length - aside} of {games.length} games)
    </span>
  );
}
