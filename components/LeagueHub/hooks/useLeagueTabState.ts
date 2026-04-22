import { useState } from "react";
import React from "react";

export function useLeagueTabState() {
  const [activeTab, setActiveTab] = useState("QB");
  const [search, setSearch] = useState("");
  const [leagueSearch, setLeagueSearch] = useState("");
  const [oppRosterTab, setOppRosterTab] = useState("QB");
  const [oppRosterOwnerId, setOppRosterOwnerId] = useState<string>("");
  const [oppRosterSearch, setOppRosterSearch] = useState("");
  const [prSortKey, setPrSortKey] = useState<"dynTotal" | "redTotal" | "qbTotal" | "rbTotal" | "wrTotal" | "teTotal">("dynTotal");
  const [prSortAsc, setPrSortAsc] = useState(false);
  const [prPopup, setPrPopup] = useState<{ rosterId: number; col: "dyn" | "red" | "QB" | "RB" | "WR" | "TE" } | null>(null);
  const [prMode, setPrMode] = useState<"full" | "starters" | "bench">("full");

  return {
    activeTab, setActiveTab,
    search, setSearch,
    leagueSearch, setLeagueSearch,
    oppRosterTab, setOppRosterTab,
    oppRosterOwnerId, setOppRosterOwnerId,
    oppRosterSearch, setOppRosterSearch,
    prSortKey, setPrSortKey,
    prSortAsc, setPrSortAsc: setPrSortAsc as React.Dispatch<React.SetStateAction<boolean>>,
    prPopup, setPrPopup,
    prMode, setPrMode,
  };
}
