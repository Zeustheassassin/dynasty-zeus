"use client";
import React from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ordinal } from "../../lib/helpers";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { useSimulationHistory } from "../../hooks/useSimulationHistory";
import RosterSelect from "../shared/RosterSelect";
import { ChartCard, ChartTooltip, ChartLegend, chartGridProps, chartAxisProps, chartTickStyle } from "../charts/ChartCard";
import { CHART_CATEGORICAL } from "../../lib/chartTheme";
import type { SleeperUser, SimulationTeamRow } from "../../lib/types";

interface SimulatorTabProps {
  user: SleeperUser | null;
  loadingLeagueWeeklyMatchups: boolean;
  onSaveSim: (leagueId: string, rows: SimulationTeamRow[]) => void;
}

function SimulatorTab({
  user,
  loadingLeagueWeeklyMatchups,
  onSaveSim,
}: SimulatorTabProps) {
  const { selectedLeague, rosters } = useLeague();
  const { selectedLeagueSimulation } = useValues();
  const [simSavedAt, setSimSavedAt] = React.useState<number | null>(null);
  const [pickedHistoryRosterId, setPickedHistoryRosterId] = React.useState<number | null>(null);

  React.useEffect(() => { setSimSavedAt(null); }, [selectedLeague?.league_id]);

  const myRosterId = rosters.find((entry) => entry.owner_id === user?.user_id)?.roster_id ?? null;
  // Default to the user's own roster once it loads, without a setState-in-effect
  // sync loop — same derived-render pattern as RosterToolsTab.tsx.
  const historyRosterId = pickedHistoryRosterId ?? myRosterId;
  const { history, loadingHistory } = useSimulationHistory(selectedLeague?.league_id, historyRosterId);
  const oddsTrendData = React.useMemo(
    () =>
      history.map((h) => ({
        label: h.week === 0 ? "Preseason" : `Wk ${h.week}`,
        playoffOdds: Math.round(h.playoffOdds),
        titleOdds: Math.round(h.titleOdds),
      })),
    [history]
  );
  // Outcome-distribution histogram (Phase F stage F3) — finishProbabilities is
  // already a per-finish-position probability mass built from every Monte
  // Carlo trial (lib/helpers/simulation.ts's simulationStats.finishCounts /
  // simCount), so no engine change was needed: index 0 is always empty
  // (finish positions are 1-based), indices 1..rosters.length map to "finished
  // 1st" through "finished last."
  const finishDistData = React.useMemo(() => {
    const row = selectedLeagueSimulation?.rows.find(
      (r) => Number(r.rosterId) === Number(historyRosterId)
    );
    if (!row) return [];
    return row.finishProbabilities
      .map((p, finish) => ({ finish, label: ordinal(finish), pct: Math.round(p * 1000) / 10 }))
      .filter((d) => d.finish >= 1);
  }, [selectedLeagueSimulation, historyRosterId]);

  if (!selectedLeague || !rosters.length) {
    return <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view the simulator.</p>;
  }
  if (!selectedLeagueSimulation) {
    return (
      <p className="text-sm text-blue-400">
        Building simulator snapshot…{" "}
        <span className="text-gray-600 text-xs">(if this persists, reload the league from Rosters &amp; Rules)</span>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Season Simulator</div>
            <div className="mt-1 text-sm text-gray-200">
              {selectedLeagueSimulation.simulationMode === "offseason"
                ? "Offseason mode uses season-long player projections to build optimal lineups, simulate standings, and estimate projected max PF before real schedules exist."
                : "In-season mode blends real results, current schedule, and Monte Carlo rest-of-season sims for projected standings and playoff odds."}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-[11px] text-gray-500">
              {selectedLeagueSimulation.simulationMode === "offseason"
                ? `${selectedLeagueSimulation.simCount} sims - ${selectedLeagueSimulation.regularSeasonWeeks}-week baseline`
                : loadingLeagueWeeklyMatchups
                ? "Loading weekly matchup history..."
                : `Week ${selectedLeagueSimulation.currentWeek} - ${selectedLeagueSimulation.weeksPlayed} completed weeks - ${selectedLeagueSimulation.simCount} sims`}
            </div>
            <button
              onClick={() => {
                onSaveSim(selectedLeague.league_id, selectedLeagueSimulation.rows);
                setSimSavedAt(Date.now());
              }}
              className="text-[11px] font-semibold px-3 py-1 rounded-full border border-blue-600 text-blue-400 hover:bg-blue-900/40 transition whitespace-nowrap"
            >
              {simSavedAt ? "✓ Saved" : "Save Sim"}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[1250px] space-y-2">
          <div className="grid grid-cols-[minmax(180px,1.45fr)_78px_108px_88px_92px_92px_88px_82px_96px_92px_110px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
            <span>Team</span>
            <span className="text-center">Power</span>
            <span className="text-center">Proj Max PF</span>
            <span className="text-center">Exp Wins</span>
            <span className="text-center">Avg Finish</span>
            <span className="text-center">Finish Band</span>
            <span className="text-center">Playoffs</span>
            <span className="text-center">Bye</span>
            <span className="text-center">Title</span>
            <span className="text-center">1.01</span>
            <span className="text-center">{selectedLeagueSimulation.simulationMode === "offseason" ? "Avg Matchup" : "This Week"}</span>
          </div>
          {selectedLeagueSimulation.rows.map((row) => {
            const isMe = Number(row.rosterId) === Number(myRosterId);
            return (
              <div key={row.rosterId} className={`grid grid-cols-[minmax(180px,1.45fr)_78px_108px_88px_92px_92px_88px_82px_96px_92px_110px] gap-2 items-center rounded-xl border px-3 py-3 ${isMe ? "border-blue-700 bg-blue-950/20" : "border-gray-800 bg-gray-900"}`}>
                <div className="min-w-0">
                  <div className={`truncate text-sm font-semibold ${isMe ? "text-blue-300" : "text-white"}`}>{row.ownerName}</div>
                  <div className="text-[11px] text-gray-500">
                    {row.actualWins}-{row.actualLosses} actual • likely finish {ordinal(row.projectedFinish)}
                  </div>
                  {selectedLeagueSimulation.simulationMode !== "offseason" && (
                    <div className="text-[10px] text-gray-600">
                      All-play {row.allPlayWins}-{row.allPlayLosses} • luck {row.luckScore > 0 ? "+" : ""}{row.luckScore.toFixed(1)}
                    </div>
                  )}
                </div>
                <div className="text-center text-sm font-semibold text-white">{row.powerScore.toFixed(1)}</div>
                <div className="text-center text-sm text-gray-200">{Math.round(row.projectedMaxPf || row.maxPf || 0).toLocaleString()}</div>
                <div className="text-center text-sm text-gray-200">{row.expectedWins.toFixed(1)}</div>
                <div className="text-center text-sm text-gray-200">{row.avgFinish?.toFixed?.(1) ?? row.avgFinish}</div>
                <div className="text-center text-xs text-gray-300">{row.finishRange}</div>
                <div className="text-center text-sm text-green-300">{Math.round(row.playoffOdds)}%</div>
                <div className="text-center text-sm text-cyan-300">{Math.round(row.byeOdds)}%</div>
                <div className="text-center text-sm text-amber-300">{Math.round(row.titleOdds)}%</div>
                <div className="text-center text-sm text-rose-300">{Math.round(row.oneOhOneOdds || 0)}%</div>
                <div className="text-center text-xs text-gray-300">
                  {row.currentOpponent ? `${Math.round((row.currentWeekWinProb ?? 0) * 100)}% vs ${row.currentOpponent}` : `${Math.round((row.avgWinProb ?? 0) * 100)}% avg`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedLeagueSimulation.weeklyMatchups?.length > 0 && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Schedule Preview</div>
              <div className="mt-1 text-sm text-gray-200">
                {selectedLeagueSimulation.simulationMode === "offseason"
                  ? "Generated weekly matchups used for offseason sims."
                  : "Upcoming matchup forecast from the active league schedule."}
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {selectedLeagueSimulation.weeklyMatchups.slice(0, 4).map((week) => (
              <div key={week.week} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-white">Week {week.week}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{week.source}</div>
                </div>
                <div className="mt-2 space-y-1.5">
                  {week.matchups?.slice(0, 6).map((matchup, idx) => (
                    <div key={`${week.week}-${idx}`} className="flex items-center justify-between rounded-lg bg-gray-800/80 px-3 py-2 text-xs">
                      <div className="min-w-0 text-gray-200">
                        <span className="font-medium text-white">{matchup.aName}</span>
                        <span className="text-gray-500"> vs </span>
                        <span className="font-medium text-white">{matchup.bName}</span>
                      </div>
                      <div className="shrink-0 text-right text-gray-400">
                        {Math.round((matchup.aWinProb || 0) * 100)}% • {Math.round(matchup.aProjected || 0)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Team Trends</div>
            <div className="mt-1 text-sm text-gray-200">Weekly odds history and this season&apos;s simulated outcome range.</div>
          </div>
          <RosterSelect value={historyRosterId} onChange={setPickedHistoryRosterId} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {loadingHistory ? (
            <p className="text-sm text-gray-500">Loading history…</p>
          ) : oddsTrendData.length === 0 ? (
            <p className="text-sm text-gray-500">
              No odds history yet — the weekly snapshot cron builds this up over time. Check back after the next Tuesday run.
            </p>
          ) : (
            <ChartCard
              title="Playoff / Title Odds"
              subtitle="Weekly snapshots"
              legend={
                <ChartLegend
                  items={[
                    { label: "Playoff Odds", color: CHART_CATEGORICAL[0] },
                    { label: "Title Odds", color: CHART_CATEGORICAL[3] },
                  ]}
                />
              }
            >
              <LineChart data={oddsTrendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} tick={chartTickStyle} />
                <YAxis {...chartAxisProps} tick={chartTickStyle} domain={[0, 100]} unit="%" />
                <Tooltip content={ChartTooltip} />
                <Line type="monotone" dataKey="playoffOdds" name="Playoff Odds" stroke={CHART_CATEGORICAL[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="titleOdds" name="Title Odds" stroke={CHART_CATEGORICAL[3]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
              </LineChart>
            </ChartCard>
          )}

          {finishDistData.length === 0 ? (
            <p className="text-sm text-gray-500">Select a team to see its simulated outcome distribution.</p>
          ) : (
            <ChartCard title="Outcome Distribution" subtitle={`Final-standing likelihood across ${selectedLeagueSimulation.simCount} simulated seasons`}>
              <BarChart data={finishDistData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} tick={chartTickStyle} />
                <YAxis {...chartAxisProps} tick={chartTickStyle} domain={[0, "dataMax"]} unit="%" />
                <Tooltip content={ChartTooltip} labelFormatter={(_, p) => (p?.[0]?.payload?.label ? `Finished ${p[0].payload.label}` : "")} />
                <Bar dataKey="pct" name="Probability" fill={CHART_CATEGORICAL[0]} radius={2} />
              </BarChart>
            </ChartCard>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(SimulatorTab);
