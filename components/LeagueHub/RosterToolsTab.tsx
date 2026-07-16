"use client";
import { memo, useCallback, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import RosterSelect from "../shared/RosterSelect";
import { ChartCard, ChartTooltip, ChartLegend, chartTickStyle } from "../charts/ChartCard";
import { CHART_CATEGORICAL, CHART_CHROME, CHART_FONT_STYLE } from "../../lib/chartTheme";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useMyRoster } from "../../lib/RosterContext";
import { useValues } from "../../lib/ValuesContext";
import {
  getRosterAgeCurve,
  getLeaguePositionalBaseline,
  getRosterPositionalStrength,
  getRosterDirectionProfile,
} from "../../lib/helpers";
import type { SleeperTradedPick } from "../../lib/types";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = typeof POSITIONS[number];
const POSITION_COLOR: Record<Position, string> = {
  QB: CHART_CATEGORICAL[0],
  RB: CHART_CATEGORICAL[1],
  WR: CHART_CATEGORICAL[2],
  TE: CHART_CATEGORICAL[3],
};
const LEAGUE_AVG_COLOR = CHART_CATEGORICAL[4];

interface RosterToolsTabProps {
  allPicks: SleeperTradedPick[];
}

/** The generic ChartTooltip only renders the axis-bound dataKeys (age, value)
 *  — the player's name isn't wired to an axis, so without a custom tooltip
 *  every point just reads as two bare numbers. Recharts always carries the
 *  full source datum in `payload[0].payload`, so pull the name from there. */
function AgeCurveTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as ReturnType<typeof getRosterAgeCurve>[number];
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-2xl"
      style={{ background: CHART_CHROME.tooltipBg, border: `1px solid ${CHART_CHROME.tooltipBorder}`, ...CHART_FONT_STYLE }}
    >
      <div className="mb-1 font-semibold" style={{ color: CHART_CHROME.textPrimary }}>
        {point.full_name} <span style={{ color: CHART_CHROME.textSecondary }}>({point.pos})</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <span style={{ color: CHART_CHROME.textSecondary }}>Age</span>
          <span className="tabular-nums" style={{ color: CHART_CHROME.textPrimary }}>{point.age.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span style={{ color: CHART_CHROME.textSecondary }}>Value</span>
          <span className="tabular-nums" style={{ color: CHART_CHROME.textPrimary }}>{point.value.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function RosterAgeCurveChart({ points }: { points: ReturnType<typeof getRosterAgeCurve> }) {
  const byPos = useMemo(
    () => POSITIONS.map((pos) => ({ pos, data: points.filter((p) => p.pos === pos) })).filter((g) => g.data.length > 0),
    [points]
  );

  if (points.length === 0) {
    return <p className="text-sm text-gray-500">No skill-position players with a known age on this roster.</p>;
  }

  return (
    <ChartCard title="Roster Age Curve" subtitle="Dynasty value by player age">
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <XAxis
          type="number"
          dataKey="age"
          name="Age"
          stroke={CHART_CHROME.axis}
          tickLine={false}
          axisLine={{ stroke: CHART_CHROME.axis }}
          tick={chartTickStyle}
          domain={["dataMin - 1", "dataMax + 1"]}
        />
        <YAxis
          type="number"
          dataKey="value"
          name="Value"
          stroke={CHART_CHROME.axis}
          tickLine={false}
          axisLine={{ stroke: CHART_CHROME.axis }}
          tick={chartTickStyle}
        />
        <ZAxis dataKey="full_name" name="Player" />
        <Tooltip cursor={{ stroke: CHART_CHROME.gridline }} content={AgeCurveTooltip} />
        {byPos.map(({ pos, data }) => (
          <Scatter key={pos} name={pos} data={data} fill={POSITION_COLOR[pos]} />
        ))}
      </ScatterChart>
    </ChartCard>
  );
}

function PositionalStrengthRadar({ radarData }: { radarData: Array<{ pos: string; pct: number; avg: number }> }) {
  return (
    <ChartCard
      title="Positional Strength"
      subtitle="Value vs. league average (100 = average)"
      legend={
        <ChartLegend
          items={[
            { label: "This Roster", color: CHART_CATEGORICAL[0] },
            { label: "League Avg", color: LEAGUE_AVG_COLOR },
          ]}
        />
      }
    >
      <RadarChart data={radarData} outerRadius="70%">
        <PolarGrid stroke={CHART_CHROME.gridline} />
        <PolarAngleAxis dataKey="pos" tick={chartTickStyle} stroke={CHART_CHROME.axis} />
        <PolarRadiusAxis angle={30} tick={{ ...chartTickStyle, fontSize: 10 }} stroke={CHART_CHROME.axis} />
        <Radar name="League Avg" dataKey="avg" stroke={LEAGUE_AVG_COLOR} fill={LEAGUE_AVG_COLOR} fillOpacity={0.08} strokeDasharray="4 3" />
        <Radar name="This Roster" dataKey="pct" stroke={CHART_CATEGORICAL[0]} fill={CHART_CATEGORICAL[0]} fillOpacity={0.35} />
        <Tooltip content={ChartTooltip} />
      </RadarChart>
    </ChartCard>
  );
}

function TeamNeedsCard({ profile }: { profile: ReturnType<typeof getRosterDirectionProfile> }) {
  if (!profile) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${profile.bucketColor}`}>
          {profile.bucket}
        </span>
        <span className="text-xs text-gray-500">
          Dyn {profile.dynRank}/{profile.n} &middot; Rdft {profile.redRank}/{profile.n}
        </span>
      </div>
      <p className="text-sm text-gray-300 mb-3">{profile.summary}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Strengths</div>
          {profile.strengths.length === 0 ? (
            <div className="text-[11px] text-gray-600 italic">None stand out</div>
          ) : (
            <ul className="space-y-0.5">
              {profile.strengths.map((s) => (
                <li key={s} className="text-xs text-emerald-400">{s}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Concerns</div>
          {profile.concerns.length === 0 ? (
            <div className="text-[11px] text-gray-600 italic">None stand out</div>
          ) : (
            <ul className="space-y-0.5">
              {profile.concerns.map((c) => (
                <li key={c} className="text-xs text-red-400">{c}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RosterToolsTab({ allPicks }: RosterToolsTabProps) {
  const players = usePlayers();
  const { selectedLeague, rosters } = useLeague();
  const { myRoster } = useMyRoster();
  const { leagueAdjustedFcValues, leagueAdjustedRedraftValues, pickFcValues } = useValues();
  const [pickedRosterId, setPickedRosterId] = useState<number | null>(null);
  // Default to the user's own roster once it loads, without a setState-in-effect
  // sync loop — falls back to whatever RosterSelect's onChange has since picked.
  const rosterId = pickedRosterId ?? myRoster?.roster_id ?? null;

  const dynastyValueForPlayer = useCallback(
    (id: string) => leagueAdjustedFcValues[id] ?? players[id]?.value ?? 0,
    [leagueAdjustedFcValues, players]
  );

  const selectedRoster = useMemo(
    () => rosters.find((r) => Number(r.roster_id) === Number(rosterId)),
    [rosters, rosterId]
  );

  const agePoints = useMemo(
    () => getRosterAgeCurve({ roster: selectedRoster, players, dynastyValueForPlayer }),
    [selectedRoster, players, dynastyValueForPlayer]
  );

  const positionalBaseline = useMemo(
    () => getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer }),
    [rosters, players, dynastyValueForPlayer]
  );

  const radarData = useMemo(() => {
    if (rosterId == null) return [];
    return getRosterPositionalStrength(rosterId, positionalBaseline).map((e) => ({
      pos: e.pos,
      pct: e.pctOfAvg,
      avg: 100,
    }));
  }, [rosterId, positionalBaseline]);

  const profile = useMemo(() => {
    if (rosterId == null) return null;
    return getRosterDirectionProfile({
      rosterId,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues: leagueAdjustedRedraftValues,
      dynastyValueForPlayer,
    });
  }, [rosterId, rosters, allPicks, players, pickFcValues, leagueAdjustedRedraftValues, dynastyValueForPlayer]);

  if (!selectedLeague || !rosters.length) {
    return <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view team tools.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-400">{selectedLeague.name}</span>
        <RosterSelect value={rosterId} onChange={setPickedRosterId} />
      </div>

      {!selectedRoster ? (
        <p className="text-sm text-gray-500">Select a team to view its tools.</p>
      ) : (
        <>
          <RosterAgeCurveChart points={agePoints} />
          <PositionalStrengthRadar radarData={radarData} />
          <TeamNeedsCard profile={profile} />
        </>
      )}
    </div>
  );
}

export default memo(RosterToolsTab);
