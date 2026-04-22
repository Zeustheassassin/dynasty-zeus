"use client";
import { useState, useMemo, useEffect, startTransition } from "react";
import dynamic from "next/dynamic";
import type { Prospect, ProspectWithStats } from "../../../lib/types";

const TEProspectList    = dynamic(() => import("./TEProspectList"), { ssr: false });
const TEChartingBoard   = dynamic(() => import("./TEChartingBoard"), { ssr: false });
const ProspectRosterSheet = dynamic(() => import("../ProspectRosterSheet"), { ssr: false });

const TE_NFL_ROLES = [
  "Inline TE", "Move TE", "Receiving TE", "Blocking TE", "F-Back/Flex", "",
];

export interface TEHubProps {
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

export default function TEHub({
  prospectsWithStats,
  loading,
  onAddProspect,
  onDataChanged,
  draftYearFilter,
  setDraftYearFilter,
  navigateToProspect,
  onNavigated,
}: TEHubProps) {
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);

  useEffect(() => {
    if (navigateToProspect) {
      startTransition(() => { setSelectedProspect(navigateToProspect); });
      onNavigated?.();
    }
  }, [navigateToProspect, onNavigated]);
  const [hubView, setHubView] = useState<HubView>("list");

  const teProspects = prospectsWithStats.filter((p) => p.position === "TE");

  const gameCountByProspect = useMemo<Record<string, number>>(
    () => Object.fromEntries(teProspects.map((p) => [p.id, p.total_games ?? 0])),
    [teProspects]
  );

  if (selectedProspect) {
    return (
      <TEChartingBoard
        prospect={selectedProspect}
        onBack={() => { setSelectedProspect(null); onDataChanged(); }}
        onDataChanged={onDataChanged}
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
        <TEProspectList
          prospects={teProspects}
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
          prospects={teProspects}
          nflRoles={TE_NFL_ROLES}
        />
      )}
    </div>
  );
}
