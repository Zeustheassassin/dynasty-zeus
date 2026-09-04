"use client";
import { memo, useEffect, useState } from "react";
import {
  getProjectionKickoffAt,
  getLineupSlotEligiblePositions,
  rebalanceLineupForKickoffWindows,
  getProjectionVolatility,
  getOpponentProjectedScore,
  getLineupRange,
  getMatchupLean,
} from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { useMyRoster } from "../../lib/RosterContext";
import { sleeperApi } from "../../lib/sleeperApi";
import type { ProjectionRow, SleeperNFLState, SleeperPlayer, SleeperMatchup, LineupCoachRow } from "../../lib/types";

interface StartersTabProps {
  projectionData: ProjectionRow[];
  nflState: SleeperNFLState | null;
}

function StartersTab({ projectionData, nflState }: StartersTabProps) {
  const players = usePlayers();
  const { selectedLeague, users } = useLeague();
  const { myRoster: roster } = useMyRoster();
  const { leagueAdjustedRedraftValues: redraftValues } = useValues();

  // "Lean Volatile" toggle: swaps the Suggested Lineup's slot-fill criterion
  // from median consensus to ceiling, so the user can preview a higher-
  // variance lineup when the matchup read below says they're an underdog.
  const [leanVolatile, setLeanVolatile] = useState(false);
  // Tagged with the request it answers so a switch to a different league/week
  // while a fetch is in flight can't have the OLD league's opponent flash up
  // once that stale call resolves — derived `oppMatchup` below only trusts a
  // result whose tag still matches the current inputs.
  const [oppMatchupResult, setOppMatchupResult] = useState<{ key: string; matchup: SleeperMatchup | null } | null>(null);

  const week = nflState?.week;
  const isInSeason = nflState?.season_type === "regular";
  const leagueId = selectedLeague?.league_id;
  const rosterId = roster?.roster_id;
  const matchupRequestKey = isInSeason && leagueId && week && rosterId != null
    ? `${leagueId}:${week}:${rosterId}`
    : null;

  // This week's opponent, for the "favored by X / underdog by X" matchup
  // read below. Self-contained (not the Gameday Hub's gamedayMatchups state,
  // which is scoped to whatever week that tab is viewing) so this tab's data
  // can't be clobbered by — or silently stale relative to — a different week
  // picked elsewhere.
  useEffect(() => {
    if (!matchupRequestKey || !leagueId || !week || rosterId == null) return;
    let cancelled = false;
    sleeperApi.getLeagueMatchups(leagueId, week)
      .then((matchups) => {
        if (cancelled) return;
        const mine = (matchups || []).find((m) => Number(m.roster_id) === Number(rosterId));
        const opp = mine?.matchup_id
          ? (matchups || []).find(
              (m) => m.matchup_id === mine.matchup_id && Number(m.roster_id) !== Number(rosterId)
            ) ?? null
          : null;
        setOppMatchupResult({ key: matchupRequestKey, matchup: opp });
      })
      .catch(() => { if (!cancelled) setOppMatchupResult({ key: matchupRequestKey, matchup: null }); });
    return () => { cancelled = true; };
  }, [matchupRequestKey, leagueId, week, rosterId]);

  const oppMatchup = oppMatchupResult?.key === matchupRequestKey ? oppMatchupResult.matchup : null;

  if (!selectedLeague || !roster) return (
    <p className="text-sm text-slate-500">Select a league from Rosters &amp; Rules first.</p>
  );

  const projectionBySleeperId = new Map(
    projectionData.map((row) => [String(row.sleeperId), row])
  );
  const hasKickoffData = projectionData.some((row) => getProjectionKickoffAt(row));

  const playerScore = (id: string) => {
    if (isInSeason) {
      const proj = projectionBySleeperId.get(String(id));
      return proj?.fpts ?? 0;
    }
    return redraftValues[id] ?? 0;
  };

  const playerKickoffAt = (id: string) => {
    if (!isInSeason) return null;
    const proj = projectionBySleeperId.get(String(id));
    return proj ? getProjectionKickoffAt(proj) : null;
  };

  // Only meaningful in-season, where projectionData carries each active
  // source's own fpts — offseason redraft values have no per-source spread.
  const playerVolatility = (id: string) => {
    if (!isInSeason) return null;
    return getProjectionVolatility(projectionBySleeperId.get(String(id)));
  };

  // Falls back to the consensus score for a player without enough source
  // spread to have a real ceiling — same fallback getLineupRange uses.
  const playerCeiling = (id: string) => playerVolatility(id)?.ceiling ?? playerScore(id);

  // What the slot-fill loop below sorts candidates by: consensus score
  // normally, ceiling when the user has toggled "Lean Volatile" — the
  // DISPLAYED score for whoever gets picked always stays consensus (below),
  // so the two modes stay directly comparable point-for-point.
  const playerRankScore = (id: string) => (isInSeason && leanVolatile ? playerCeiling(id) : playerScore(id));

  const positions: string[] = selectedLeague.roster_positions?.filter((p: string) => !["BN","IR","TAXI"].includes(p)) ?? [];
  const myPlayerIds: string[] = roster.players ?? [];
  const taxiIds = new Set<string>((roster.taxi ?? []).map((id) => String(id)));
  const used = new Set<string>();
  const initialLineup: LineupCoachRow[] = [];
  const currentStarterRows = positions.map((slot: string, index: number) => {
    const starterId = String(roster?.starters?.[index] || "");
    const starterPlayer = starterId ? players[starterId] : null;
    return {
      slot,
      player: starterPlayer,
      score: starterPlayer ? playerScore(starterPlayer.player_id) : 0,
      kickoffAt: starterPlayer ? playerKickoffAt(starterPlayer.player_id) : null,
    };
  });

  for (const slot of positions) {
    const eligible = getLineupSlotEligiblePositions(slot);
    const best = myPlayerIds
      .filter(id => !used.has(id))
      .map(id => ({ id, p: players[id] }))
      .filter(({ p }) => p && eligible.includes(p.position))
      .sort((a, b) => playerRankScore(b.id) - playerRankScore(a.id))[0];
    if (best) {
      used.add(best.id);
      initialLineup.push({ slot, player: best.p, score: playerScore(best.id), kickoffAt: playerKickoffAt(best.id) });
    } else {
      initialLineup.push({ slot, player: null, score: 0, kickoffAt: null });
    }
  }

  const lineup = rebalanceLineupForKickoffWindows(initialLineup, isInSeason && hasKickoffData);

  const benchPlayers = myPlayerIds
    .filter((id) => !used.has(id) && !taxiIds.has(String(id)))
    .map((id) => players[id])
    .filter((p): p is SleeperPlayer => !!p)
    .sort((a, b) => playerScore(b.player_id) - playerScore(a.player_id));

  const taxiPlayers = myPlayerIds
    .filter((id) => taxiIds.has(String(id)))
    .map((id) => players[id])
    .filter((p): p is SleeperPlayer => !!p)
    .sort((a, b) => playerScore(b.player_id) - playerScore(a.player_id));

  const currentStarterIds = new Set(
    currentStarterRows
      .map((r) => r.player?.player_id)
      .filter((id): id is string => !!id)
  );
  const newStarterIds = new Set(
    lineup
      .map((r) => r.player?.player_id)
      .filter((id): id is string => !!id)
  );

  // Players currently starting who are NOT in the optimized lineup — these go to the bench.
  // Sort lowest-score first so they pair with the cheapest replacements first.
  const benchedPool: SleeperPlayer[] = currentStarterRows
    .map((r) => r.player)
    .filter((p): p is SleeperPlayer => !!p && !newStarterIds.has(p.player_id))
    .sort((a, b) => playerScore(a.player_id) - playerScore(b.player_id));

  const lineupCoachNotes = lineup
    .map(({ slot, player, score }) => {
      if (!player?.player_id) return null;
      // Skip players who were already starting — their slot may have shifted (e.g.,
      // FLEX 1 → FLEX 2) but that's an internal shuffle, not a real lineup change.
      if (currentStarterIds.has(player.player_id)) return null;

      const eligible = getLineupSlotEligiblePositions(slot);
      let matchIdx = benchedPool.findIndex((p) => eligible.includes(p.position));
      if (matchIdx === -1 && benchedPool.length > 0) matchIdx = 0;
      const replaced = matchIdx >= 0 ? benchedPool.splice(matchIdx, 1)[0] : null;
      const replacedScore = replaced ? playerScore(replaced.player_id) : 0;
      const delta = score - replacedScore;
      const volatility = playerVolatility(player.player_id);

      const reasonParts = [
        delta > 0
          ? `${isInSeason ? "Projection" : "Redraft score"} improves by ${delta.toFixed(1)}`
          : `${isInSeason ? "Projection" : "Redraft score"} is safer for this slot`,
        replaced?.status && /out|doubtful|inactive|suspended/i.test(String(replaced.status))
          ? `${replaced.full_name} is ${String(replaced.status).toLowerCase()}`
          : null,
        volatility?.level === "volatile"
          ? `wide range across sources (${volatility.floor.toFixed(1)}–${volatility.ceiling.toFixed(1)})`
          : null,
        slot === "FLEX" || slot === "SUPER_FLEX"
          ? `${player.full_name} is the strongest remaining ${slot === "SUPER_FLEX" ? "flex-eligible" : "flex"} fit`
          : `${player.full_name} grades best at ${slot.replace("_", " ")}`,
      ].filter(Boolean);

      return {
        slot,
        suggested: player,
        current: replaced,
        delta,
        reason: reasonParts.join(" • "),
      };
    })
    .filter(Boolean) as Array<{
      slot: string;
      suggested: SleeperPlayer;
      current: SleeperPlayer | null;
      delta: number;
      reason: string;
    }>;

  const currentLineupScore = currentStarterRows.reduce((sum: number, row) => sum + (row.score || 0), 0);
  const suggestedLineupScore = lineup.reduce((sum: number, row) => sum + (row.score || 0), 0);
  const lineupDelta = suggestedLineupScore - currentLineupScore;

  // Floor/ceiling range for the suggested lineup as shown — reflects
  // whichever slot-fill mode (balanced/volatile) is currently active.
  const suggestedRange = isInSeason
    ? getLineupRange(
        lineup.map((row) => (row.player ? projectionBySleeperId.get(row.player.player_id) ?? null : null))
      )
    : null;

  const oppName = oppMatchup ? (users[String(oppMatchup.roster_id)] || `Team ${oppMatchup.roster_id}`) : null;
  const oppProjectedScore = isInSeason && oppMatchup
    ? getOpponentProjectedScore(oppMatchup, projectionBySleeperId)
    : null;
  const matchupLean = oppProjectedScore != null
    ? getMatchupLean(suggestedLineupScore, oppProjectedScore)
    : null;

  // User's framing: favored -> protect the lead (stick with balanced);
  // underdog -> a lineup that's still projected to lose doesn't help, so
  // leaning into variance is the justified play. Phrased against whichever
  // mode is currently active so it reads as live feedback, not a fixed tip.
  const matchupAdvice = (() => {
    if (!matchupLean) return null;
    if (matchupLean.lean === "neutral") return "Close matchup — either lineup is defensible.";
    if (matchupLean.lean === "favored") {
      return leanVolatile
        ? "You're favored — the balanced lineup may protect the lead better."
        : "Favored — the balanced lineup fits.";
    }
    return leanVolatile
      ? "Underdog — leaning volatile fits."
      : "Underdog — a volatile lineup could close the gap.";
  })();

  const renderStatusBadge = (status: string | null | undefined) => {
    const s = status ? String(status).toLowerCase() : "";
    if (/out|inactive|suspended|covid|nfi|pup/.test(s)) return <span className="text-[10px] font-semibold text-red-400 shrink-0">OUT</span>;
    if (s === "doubtful") return <span className="text-[10px] font-semibold text-orange-400 shrink-0">D</span>;
    if (s === "questionable") return <span className="text-[10px] font-semibold text-amber-400 shrink-0">Q</span>;
    return null;
  };

  // Only flags the extremes (wide or tight spread across sources) — a
  // player in between gets no badge, so most rows stay unmarked.
  const renderVolatilityBadge = (id: string) => {
    const v = playerVolatility(id);
    if (!v || v.level === "neutral") return null;
    const isVolatile = v.level === "volatile";
    return (
      <span
        title={`${v.sourceCount}-source range: ${v.floor.toFixed(1)}–${v.ceiling.toFixed(1)}`}
        className={`text-[9px] font-semibold px-1 rounded shrink-0 ${
          isVolatile ? "text-amber-400 bg-amber-500/10" : "text-sky-400 bg-sky-500/10"
        }`}
      >
        {isVolatile ? "VOLATILE" : "SAFE"}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 mb-1">
        {isInSeason
          ? <>Week {week} starters based on <span className="text-slate-300 font-medium">consensus projections</span></>
          : <>Offseason starters based on <span className="text-slate-300 font-medium">redraft rankings</span></>
        }
        {" — "}<span className="text-slate-300">{selectedLeague.name}</span>
      </p>
      {isInSeason && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Matchup</div>
              <div className="mt-0.5 text-xs text-slate-200">
                {oppProjectedScore != null && oppName ? (
                  <>
                    vs <span className="text-slate-300 font-medium">{oppName}</span>, projected {oppProjectedScore.toFixed(1)}
                    {matchupLean && matchupLean.lean !== "neutral" && (
                      <span className={`ml-1 font-semibold ${matchupLean.lean === "favored" ? "text-emerald-400" : "text-amber-400"}`}>
                        — {matchupLean.lean === "favored" ? "favored" : "underdog"} by {Math.abs(matchupLean.margin).toFixed(1)}
                      </span>
                    )}
                    {matchupLean && matchupLean.lean === "neutral" && (
                      <span className="ml-1 text-slate-400">— close matchup</span>
                    )}
                  </>
                ) : (
                  <span className="text-slate-500">Opponent projection unavailable this week.</span>
                )}
              </div>
              {suggestedRange && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Suggested lineup range: <span className="text-slate-300">{suggestedRange.floor.toFixed(1)}–{suggestedRange.ceiling.toFixed(1)}</span>
                </div>
              )}
              {matchupAdvice && (
                <div className="mt-1 text-[11px] text-slate-500">{matchupAdvice}</div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setLeanVolatile(false)}
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition ${
                  !leanVolatile ? "bg-sky-900 border-sky-700 text-sky-300" : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                }`}
              >
                Balanced
              </button>
              <button
                type="button"
                onClick={() => setLeanVolatile(true)}
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition ${
                  leanVolatile ? "bg-amber-900 border-amber-700 text-amber-300" : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                }`}
              >
                Lean Volatile
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="border-b border-slate-800 pb-2 mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Lineup Coach</div>
            <div className="mt-0.5 text-xs text-slate-200">
              {lineupCoachNotes.length === 0
                ? "Your current lineup already matches the coach recommendation."
                : `The coach would make ${lineupCoachNotes.length} swap${lineupCoachNotes.length === 1 ? "" : "s"}${lineupDelta > 0 ? ` for roughly +${lineupDelta.toFixed(1)}` : ""}.`}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 text-right whitespace-nowrap">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Current</div>
              <div className="text-slate-200 font-medium text-xs">{currentLineupScore.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Suggested</div>
              <div className={`font-medium text-xs ${lineupDelta > 0 ? "text-emerald-400" : "text-slate-200"}`}>
                {suggestedLineupScore.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
        {lineupCoachNotes.length > 0 && (
          <div className="space-y-2">
            {lineupCoachNotes.map((note) => (
              <div key={`${note.slot}-${note.suggested.player_id}-${note.current?.player_id || "empty"}`} className="text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 w-16 shrink-0">{note.slot.replace("_", " ")}</span>
                  <span className="text-slate-200">{note.current?.full_name || "Empty slot"}</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-slate-200 font-medium">{note.suggested.full_name}</span>
                  <span className={`font-medium ${note.delta > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                    {note.delta > 0 ? "+" : ""}{note.delta.toFixed(1)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 pl-[4.5rem]">{note.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="border-b border-slate-800 pb-2 mb-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Suggested Lineup</div>
        </div>
        <div className="space-y-0.5">
          {lineup.map(({ slot, player, score }, index) => (
            <div key={`${slot}-${index}`} className="flex items-center gap-2 text-xs py-0.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 w-16 shrink-0">{slot.replace("_", " ")}</span>
              {player ? (
                <>
                  <span className="text-slate-200 flex-1 truncate">{player.full_name}</span>
                  {renderStatusBadge(player.status)}
                  {renderVolatilityBadge(player.player_id)}
                  <span className="text-[10px] text-slate-500 shrink-0">{player.team}</span>
                  <span className="text-emerald-400 font-medium shrink-0 w-12 text-right">{score > 0 ? score.toFixed(1) : "—"}</span>
                </>
              ) : (
                <span className="text-slate-600 italic flex-1">Empty</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="border-b border-slate-800 pb-2 mb-2">
            <div className="text-xs text-slate-400">Bench: <span className="font-semibold text-emerald-400">{benchPlayers.length}</span></div>
          </div>
          <div className="space-y-0.5">
            {benchPlayers.length === 0 ? (
              <div className="text-[11px] text-slate-600 italic">No bench players</div>
            ) : (
              benchPlayers.map((player) => {
                const score = playerScore(player.player_id);
                return (
                  <div key={player.player_id} className="flex items-center gap-2 text-xs py-0.5">
                    <span className="text-[10px] uppercase text-slate-500 w-7 shrink-0">{player.position}</span>
                    <span className="text-slate-200 flex-1 truncate">{player.full_name}</span>
                    {renderVolatilityBadge(player.player_id)}
                    <span className="text-[10px] text-slate-500 shrink-0">{player.team}</span>
                    <span className="text-emerald-400 font-medium shrink-0 w-12 text-right">{score > 0 ? score.toFixed(1) : "—"}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="border-b border-slate-800 pb-2 mb-2">
            <div className="text-xs text-slate-400">Taxi: <span className="font-semibold text-emerald-400">{taxiPlayers.length}</span></div>
          </div>
          <div className="space-y-0.5">
            {taxiPlayers.length === 0 ? (
              <div className="text-[11px] text-slate-600 italic">No taxi players</div>
            ) : (
              taxiPlayers.map((player) => {
                const score = playerScore(player.player_id);
                return (
                  <div key={player.player_id} className="flex items-center gap-2 text-xs py-0.5">
                    <span className="text-[10px] uppercase text-slate-500 w-7 shrink-0">{player.position}</span>
                    <span className="text-slate-200 flex-1 truncate">{player.full_name}</span>
                    {renderVolatilityBadge(player.player_id)}
                    <span className="text-[10px] text-slate-500 shrink-0">{player.team}</span>
                    <span className="text-emerald-400 font-medium shrink-0 w-12 text-right">{score > 0 ? score.toFixed(1) : "—"}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(StartersTab);
