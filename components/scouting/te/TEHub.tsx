"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { Prospect, ProspectWithStats } from "../../../lib/types";

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
}

type HubView = "list" | "roster";

export default function TEHub({
  prospectsWithStats,
  onDataChanged,
}: TEHubProps) {
  const [hubView, setHubView] = useState<HubView>("list");

  const teProspects = prospectsWithStats.filter((p) => p.position === "TE");

  return (
    <div>
      {/* Inner tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-800">
        {(["list", "roster"] as HubView[]).map((v) => (
          <button
            key={v}
            onClick={() => { if (v === "list" && hubView === "roster") onDataChanged(); setHubView(v); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              hubView === v ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {v === "list" ? "Prospects" : "Prospect Data"}
          </button>
        ))}
      </div>

      {hubView === "list" && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <div className="text-5xl font-black text-gray-700">TE</div>
          <div className="text-gray-400 text-base font-medium">Scouting system coming soon</div>
          <div className="text-gray-600 text-sm max-w-sm">
            TE charting, route tree analytics, blocking grades, and Big Board integration will be built here.
          </div>
        </div>
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
