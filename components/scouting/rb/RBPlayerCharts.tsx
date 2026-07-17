"use client";
import { useMemo } from "react";
import type { Prospect, ProspectWithStats, ScoutingGame, RBPlay, RBRunType } from "../../../lib/types";
import RadarChartSVG, {
  computeRadarTier,
  RadarCardHeader,
  RadarTierLegend,
  type RadarSpoke,
  type RadarTier,
} from "../shared/RadarChartSVG";

// H1 — extends the WR route-tree radar pattern to RB using the same run-type
// success% breakdown already shown in the Overview tab's "Run Type Breakdown"
// table and RBStatsTable's Analysis columns (OZ%/IZ%/OMG%/IMG%/PB%/RB%).
type RunSpokeKey = "oz" | "iz" | "omg" | "img" | "pass_block" | "run_block";

const RUN_SPOKES: { key: RunSpokeKey; label: string; angleDeg: number; runType: RBRunType }[] = [
  { key: "oz",         label: "OUTSIDE ZONE",    angleDeg: 90,   runType: "outside_zone" },
  { key: "iz",         label: "INSIDE ZONE",     angleDeg: 30,   runType: "inside_zone" },
  { key: "omg",        label: "OUTSIDE MAN GAP", angleDeg: -30,  runType: "outside_man_gap" },
  { key: "img",        label: "INSIDE MAN GAP",  angleDeg: -90,  runType: "inside_man_gap" },
  { key: "pass_block", label: "PASS BLOCK",      angleDeg: -150, runType: "pass_block" },
  { key: "run_block",  label: "RUN BLOCK",       angleDeg: 150,  runType: "run_block" },
];

const MIN_ATTEMPTS_FOR_TIER = 5;

function successPct(plays: RBPlay[]): number | null {
  const known = plays.filter((p) => p.success !== null);
  if (known.length === 0) return null;
  return (known.filter((p) => p.success === true).length / known.length) * 100;
}

interface Props {
  prospect: Prospect;
  allProspects: ProspectWithStats[];
  allGames: ScoutingGame[];
  leaguePlays: RBPlay[];
}

export default function RBPlayerCharts({ prospect, allProspects, allGames, leaguePlays }: Props) {
  const { spokes, hasAnyData, chartedCount } = useMemo(() => {
    const gameToProspect = new Map(allGames.map((g) => [g.id, g.prospect_id]));
    const playsByProspect = new Map<string, RBPlay[]>();
    for (const pl of leaguePlays) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      if (!playsByProspect.has(pid)) playsByProspect.set(pid, []);
      playsByProspect.get(pid)!.push(pl);
    }

    const rbProspectIds = allProspects.filter((p) => p.position === "RB").map((p) => p.id);

    const dist: Record<RunSpokeKey, number[]> = { oz: [], iz: [], omg: [], img: [], pass_block: [], run_block: [] };
    let chartedCount = 0;
    for (const pid of rbProspectIds) {
      const pPlays = playsByProspect.get(pid) ?? [];
      if (pPlays.length === 0) continue;
      chartedCount++;
      for (const spoke of RUN_SPOKES) {
        const subset = pPlays.filter((p) => p.run_type === spoke.runType);
        if (subset.length < MIN_ATTEMPTS_FOR_TIER) continue;
        const v = successPct(subset);
        if (v !== null) dist[spoke.key].push(v);
      }
    }

    const myPlays = playsByProspect.get(prospect.id) ?? [];
    const spokes: RadarSpoke[] = RUN_SPOKES.map(({ key, label, angleDeg, runType }) => {
      const subset = myPlays.filter((p) => p.run_type === runType);
      const v = successPct(subset);
      const hasData = v !== null;
      const tier: RadarTier = hasData && subset.length >= MIN_ATTEMPTS_FOR_TIER
        ? computeRadarTier(v!, dist[key])
        : "none";
      return { key, label, angleDeg, valuePct: hasData ? v! : 0, tier, hasData };
    });

    return { spokes, hasAnyData: myPlays.length > 0, chartedCount };
  }, [prospect, allProspects, allGames, leaguePlays]);

  if (!hasAnyData) {
    return (
      <div className="text-slate-500 text-sm text-center py-12">
        No plays charted yet — charts will appear once plays are logged.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-center">
        <div className="bg-slate-950 border border-slate-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <RadarCardHeader
            title="Success Rate by Run Type & Block"
            name={prospect.name}
            school={prospect.school}
            draftYear={prospect.draft_class_year}
          />
          <RadarChartSVG spokes={spokes} maxPct={100} />
        </div>
      </div>

      <RadarTierLegend noDataLabel={`< ${MIN_ATTEMPTS_FOR_TIER} attempts`} />
      <p className="text-center text-[11px] text-slate-600">
        Percentiles vs {chartedCount} charted RB prospects · all years
      </p>
    </div>
  );
}
