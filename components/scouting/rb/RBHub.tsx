"use client";
import { useState, useMemo, useEffect, startTransition } from "react";
import dynamic from "next/dynamic";
import type { Prospect, ProspectWithStats, ScoutingGame, RBPlay } from "../../../lib/types";

const RBProspectList      = dynamic(() => import("./RBProspectList"), { ssr: false });
const RBChartingBoard     = dynamic(() => import("./RBChartingBoard"), { ssr: false });
const ProspectRosterSheet = dynamic(() => import("../ProspectRosterSheet"), { ssr: false });

const RB_NFL_ROLES = [
  "Bellcow", "1A/1B", "Lead Back", "Receiving Back", "Change-of-Pace", "Committee", "",
];

export interface RBHubProps {
  prospectsWithStats: ProspectWithStats[];
  loading: boolean;
  onAddProspect: (data: Omit<Prospect, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  onDataChanged: () => void;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  navigateToProspect?: Prospect | null;
  onNavigated?: () => void;
  games: ScoutingGame[];
  rbPlays: RBPlay[];
}

type HubView = "list" | "roster";

export default function RBHub({
  prospectsWithStats,
  loading,
  onAddProspect,
  onDataChanged,
  draftYearFilter,
  setDraftYearFilter,
  navigateToProspect,
  onNavigated,
  games,
  rbPlays,
}: RBHubProps) {
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);

  useEffect(() => {
    if (navigateToProspect) {
      startTransition(() => { setSelectedProspect(navigateToProspect); });
      onNavigated?.();
    }
  }, [navigateToProspect, onNavigated]);
  const [hubView, setHubView] = useState<HubView>("list");

  const rbProspects = prospectsWithStats.filter((p) => p.position === "RB");

  const gameCountByProspect = useMemo<Record<string, number>>(
    () => Object.fromEntries(rbProspects.map((p) => [p.id, p.total_games ?? 0])),
    [rbProspects]
  );

  if (selectedProspect) {
    return (
      <RBChartingBoard
        prospect={selectedProspect}
        onBack={() => { setSelectedProspect(null); onDataChanged(); }}
        onDataChanged={onDataChanged}
        allProspects={rbProspects}
        allGames={games}
        leaguePlays={rbPlays}
      />
    );
  }

  return (
    <div>
      {/* Inner tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-800">
        {(["list", "roster"] as HubView[]).map((v) => (
          <button
            key={v}
            onClick={() => { if (v === "list" && hubView === "roster") onDataChanged(); setHubView(v); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              hubView === v ? "border-green-500 text-green-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {v === "list" ? "Prospects" : "Prospect Data"}
          </button>
        ))}
      </div>

      {hubView === "list" && (
        <RBProspectList
          prospects={rbProspects}
          gameCountByProspect={gameCountByProspect}
          loading={loading}
          onSelectProspect={setSelectedProspect}
          onAddProspect={onAddProspect}
          onDataChanged={onDataChanged}
          draftYearFilter={draftYearFilter}
          setDraftYearFilter={setDraftYearFilter}
        />
      )}

      {hubView === "roster" && (
        <ProspectRosterSheet
          prospects={rbProspects}
          nflRoles={RB_NFL_ROLES}
          onDataChanged={onDataChanged}
        />
      )}
    </div>
  );
}
