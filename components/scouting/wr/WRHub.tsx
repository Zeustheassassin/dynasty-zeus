"use client";
import { useState, useEffect, startTransition } from "react";
import dynamic from "next/dynamic";
import type { Prospect, ProspectWithStats } from "../../../lib/types";

const ProspectList     = dynamic(() => import("./ProspectList"), { ssr: false });
const PlayerChartingBoard = dynamic(() => import("./PlayerChartingBoard"), { ssr: false });
const ProspectRosterSheet = dynamic(() => import("../ProspectRosterSheet"), { ssr: false });

const WR_NFL_ROLES = [
  "X", "Y", "Slot", "X or Y", "Y or Slot",
  "Slot/Gadget", "Anything", "Sacrificial X", "Target Hog Y or Slot", "",
];

export interface WRHubProps {
  prospectsWithStats: ProspectWithStats[];
  loading: boolean;
  onAddProspect: (data: Omit<Prospect, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  onDataChanged: () => void;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  navigateToProspect?: Prospect | null;
  onNavigated?: () => void;
}

type HubView = "list" | "roster";

export default function WRHub({
  prospectsWithStats,
  loading,
  onAddProspect,
  onDataChanged,
  draftYearFilter,
  setDraftYearFilter,
  navigateToProspect,
  onNavigated,
}: WRHubProps) {
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);

  useEffect(() => {
    if (navigateToProspect) {
      startTransition(() => { setSelectedProspect(navigateToProspect); });
      onNavigated?.();
    }
  }, [navigateToProspect, onNavigated]);
  const [hubView, setHubView] = useState<HubView>("list");

  const wrProspects = prospectsWithStats.filter((p) => p.position === "WR");

  if (selectedProspect) {
    return (
      <PlayerChartingBoard
        prospect={selectedProspect}
        onBack={() => { setSelectedProspect(null); onDataChanged(); }}
        onDataChanged={onDataChanged}
        allProspects={prospectsWithStats}
      />
    );
  }

  return (
    <div>
      {/* Inner tab bar */}
      <div className="flex gap-1 mb-5 border-b border-slate-800">
        {(["list", "roster"] as HubView[]).map((v) => (
          <button
            key={v}
            onClick={() => { if (v === "list" && hubView === "roster") onDataChanged(); setHubView(v); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              hubView === v ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {v === "list" ? "Prospects" : "Prospect Data"}
          </button>
        ))}
      </div>

      {hubView === "list" && (
        <ProspectList
          prospects={wrProspects}
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
          prospects={wrProspects}
          nflRoles={WR_NFL_ROLES}
          onDataChanged={onDataChanged}
        />
      )}
    </div>
  );
}
