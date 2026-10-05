"use client";
// The Game context section of a charting board's Games tab (tape-grading
// expansion, Stage 5), shared by the WR, RB, QB and TE boards:
//   - each charted game's automatic context: the opponent's defensive SP+,
//     the weather, his line's block grades and his QB's passing grade (PFF),
//     his snap share;
//   - the user's calls: confirm or dismiss a left-early suggestion, mark a
//     game played hurt (old games too);
//   - trait grades, 1–10, on new games only.

import type { ScoutingGame } from "../../../lib/types";
import type { GameContext } from "../../../lib/scouting/gameContext";
import { weatherCodeLabel } from "../../../lib/weather/openMeteo";
import { gameTraits, isTraitGame, traitsFor, TRAIT_MAX, TRAIT_MIN } from "../../../lib/scouting/traits";
import type { LeftEarlySuggestion } from "../../../lib/scouting/gameFlags";
import { opponentSchool } from "../../../lib/scouting/opponentTier";
import type { GameContextLog } from "./useGameContextLog";

const GRADES = Array.from({ length: TRAIT_MAX - TRAIT_MIN + 1 }, (_, i) => TRAIT_MIN + i);
const btn = "rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40";

function defenseCell(c: GameContext | undefined) {
  if (!c) return <span className="text-slate-600">—</span>;
  if (!c.matched) return <span className="text-slate-600" title={c.note ?? "No CollegeFootballData game"}>no match</span>;
  if (c.opponentFcs) return <span className="text-slate-400" title="FCS opponent (no SP+)">FCS</span>;
  if (c.oppDefSp == null) return <span className="text-slate-600" title="No SP+ for this opponent">—</span>;
  const tough = c.oppDefRank != null && c.oppDefRank <= 25, soft = c.oppDefRank != null && c.oppDefRank > 100;
  return (
    <span
      className={tough ? "text-red-300" : soft ? "text-emerald-300" : "text-slate-300"}
      title={`${c.opponentSchool}'s defensive SP+ that season: ${c.oppDefSp.toFixed(1)} points allowed per game vs an average offense (lower is tougher), #${c.oppDefRank ?? "?"} nationally. Overall SP+ ${c.oppSp?.toFixed(1) ?? "—"} (#${c.oppSpRank ?? "?"}).`}
    >
      {c.oppDefSp.toFixed(1)}{c.oppDefRank != null && <span className="text-slate-500"> #{c.oppDefRank}</span>}
    </span>
  );
}

function weatherCell(c: GameContext | undefined) {
  const w = c?.weather;
  if (!w) return <span className="text-slate-600">—</span>;
  if (w.status === "dome") return <span className="text-slate-400" title="Indoor stadium">Dome</span>;
  if (w.status === "pending") return <span className="text-slate-500" title="The weather archive runs about five days behind; it fills in on the next refresh">Pending</span>;
  if (w.status === "no_location") return <span className="text-slate-600" title="The venue has no coordinates">—</span>;
  const wet = (w.precipIn ?? 0) >= 0.05, snow = (w.snowIn ?? 0) > 0;
  const label = weatherCodeLabel(w.code);
  return (
    <span
      className={wet || (w.windMph ?? 0) >= 15 || (w.temperatureF ?? 99) < 40 ? "text-amber-300" : "text-slate-300"}
      title={`Kickoff + 3 hours: ${w.temperatureF?.toFixed(0)}°F, wind ${w.windMph?.toFixed(0)} mph (gusts ${w.gustMph?.toFixed(0) ?? "—"}), ` +
        `${(w.precipIn ?? 0).toFixed(2)}" rain${snow ? `, ${(w.snowIn ?? 0).toFixed(1)}" snow` : ""}${label ? ` · ${label}` : ""}${c?.venue ? ` · ${c.venue}` : ""}`}
    >
      {w.temperatureF?.toFixed(0)}° · {w.windMph?.toFixed(0)} mph{snow ? " · snow" : wet ? " · rain" : ""}
    </span>
  );
}

function leftEarlyCell(g: ScoutingGame, s: LeftEarlySuggestion | undefined, log: GameContextLog) {
  if (g.left_early === true) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-amber-300">Left early</span>
        <button className={btn} onClick={() => void log.patchGame(g.id, { left_early: null })} title="Undo: back to not reviewed">Undo</button>
      </span>
    );
  }
  if (g.left_early === false) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-slate-500">No</span>
        <button className={btn} onClick={() => void log.patchGame(g.id, { left_early: null })} title="Undo: back to not reviewed">Undo</button>
      </span>
    );
  }
  if (s) {
    return (
      <span className="flex items-center gap-1.5">
        <span
          className="text-amber-300"
          title={`He played ${Math.round(s.share * 100)}% of the team's snaps (${s.hisSnaps} of ${s.teamSnaps}); his usual is ${Math.round(s.usual * 100)}%.` +
            (s.blowout ? " It was a blowout, so he may just have sat late." : "")}
        >
          Left early?{s.blowout && <span className="text-slate-500"> (blowout)</span>}
        </span>
        <button className={btn} onClick={() => void log.patchGame(g.id, { left_early: true })} aria-label="Confirm he left early">Yes</button>
        <button className={btn} onClick={() => void log.patchGame(g.id, { left_early: false })} aria-label="Dismiss: he didn't leave early">No</button>
      </span>
    );
  }
  return (
    <button className={btn} onClick={() => void log.patchGame(g.id, { left_early: true })} title="Mark that he left this game early">Mark</button>
  );
}

export default function GameContextPanel({ position, games, log }: {
  position: string;
  games: readonly ScoutingGame[];
  log: GameContextLog;
}) {
  const isQB = position === "QB";
  const traitGames = games.filter(isTraitGame);
  const traits = traitsFor(position);
  return (
    <section aria-label="Game context" className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span>
          <span className="font-semibold text-teal-400">Game context</span>{" "}
          {log.filled} of {games.length} game{games.length === 1 ? "" : "s"} filled in
        </span>
        <button
          onClick={() => void log.refresh()}
          disabled={log.refreshing}
          title="Fill in or refresh this player's opponent defense, weather and supporting cast"
          className="rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
        >
          {log.refreshing ? "Refreshing…" : "Refresh context"}
        </button>
        {log.progressNote && <span className="text-slate-500">{log.progressNote}</span>}
        {log.error && <span className="text-red-300">{log.error}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-500">
              <th className="pb-2 pr-3">Game</th>
              <th className="pb-2 pr-3 text-right" title="Opponent's defensive SP+ that season (points allowed per game vs an average offense; lower is tougher) and its national rank">Opp D</th>
              <th className="pb-2 pr-3" title="Game-window weather (Open-Meteo archive)">Weather</th>
              <th className="pb-2 pr-3 text-right" title="His offensive line's PFF pass-block / run-block grade that game (snap-weighted). Shown only: not in any score.">OL PB / RB</th>
              {!isQB && <th className="pb-2 pr-3" title="His quarterback's PFF passing grade that game. Shown only: not in any score.">QB</th>}
              <th className="pb-2 pr-3 text-right" title="His PFF snaps / the team's offensive snaps">Snaps</th>
              <th className="pb-2 pr-3" title="Suggested when his snap share is well under his usual; you confirm">Left early</th>
              <th className="pb-2 pr-3" title="Your call: he played this game hurt">Hurt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {games.map((g) => {
              const c = log.contexts.get(g.id);
              const charted = opponentSchool(g.opponent);
              const diff = c?.matched && c.opponentSchool && charted != null && charted !== c.opponentSchool;
              return (
                <tr key={g.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="text-slate-400">{g.season_year}</span> <span className="text-slate-200">{g.opponent}</span>
                    {diff && <span className="text-amber-400" title="The PFF game linked to this charted game is against this team"> → {c!.opponentSchool}</span>}
                    {!c && log.unmatched.has(g.id) && <span className="text-slate-600" title={log.unmatched.get(g.id)}> (no match)</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{defenseCell(c)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{weatherCell(c)}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap text-slate-300">
                    {c?.cast ? `${c.cast.olPassBlock?.toFixed(0) ?? "—"} / ${c.cast.olRunBlock?.toFixed(0) ?? "—"}` : <span className="text-slate-600">—</span>}
                  </td>
                  {!isQB && (
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-300">
                      {c?.cast?.qbPassGrade != null ? <>{c.cast.qbName?.split(" ").slice(-1)[0]} <span className="text-sky-300">{c.cast.qbPassGrade.toFixed(0)}</span></> : <span className="text-slate-600">—</span>}
                    </td>
                  )}
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap text-slate-300">
                    {c?.hisSnaps != null && c.teamSnaps ? `${c.hisSnaps}/${c.teamSnaps} (${Math.round((c.snapShare ?? 0) * 100)}%)` : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{leftEarlyCell(g, log.suggestions.get(g.id), log)}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="checkbox"
                      checked={g.played_hurt === true}
                      onChange={(e) => void log.patchGame(g.id, { played_hurt: e.target.checked })}
                      aria-label={`Played hurt: ${g.season_year} ${g.opponent}`}
                      className="accent-amber-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {traits.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-slate-400">
            <span className="font-semibold text-fuchsia-400">Trait grades</span>{" "}
            <span className="text-slate-500">1–10, games charted since traits began only. Shown beside the AE Score.</span>
          </div>
          {traitGames.length === 0 ? (
            <p className="text-xs text-slate-600">No new games yet: traits can be graded on games added from now on.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-500">
                    <th className="pb-1.5 pr-3">Game</th>
                    {traits.map((t) => (
                      <th key={t.key} className="pb-1.5 pr-2" title={t.coveredBy ? `${t.label} (already measured by ${t.coveredBy})` : `${t.label} (counts with the Big Board's "With traits" toggle)`}>{t.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {traitGames.map((g) => {
                    const grades = gameTraits(position, g.trait_grades);
                    return (
                      <tr key={g.id}>
                        <td className="py-1 pr-3 whitespace-nowrap text-slate-300">{g.season_year} {g.opponent}</td>
                        {traits.map((t) => (
                          <td key={t.key} className="py-1 pr-2">
                            <select
                              value={grades[t.key] ?? ""}
                              onChange={(e) => void log.setTrait(g, t.key, e.target.value === "" ? null : Number(e.target.value))}
                              aria-label={`${t.label}: ${g.season_year} ${g.opponent}`}
                              className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200"
                            >
                              <option value="">—</option>
                              {GRADES.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
