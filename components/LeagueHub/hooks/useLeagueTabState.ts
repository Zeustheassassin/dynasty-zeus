import { useState } from "react";
import React from "react";

export function useLeagueTabState() {
  const [leagueSearch, setLeagueSearch] = useState("");
  const [oppRosterOwnerId, setOppRosterOwnerId] = useState<string>("");
  const [prSortKey, setPrSortKey] = useState<"dynTotal" | "redTotal" | "qbTotal" | "rbTotal" | "wrTotal" | "teTotal">("dynTotal");
  const [prSortAsc, setPrSortAsc] = useState(false);
  const [prPopup, setPrPopup] = useState<{ rosterId: number; col: "dyn" | "red" | "QB" | "RB" | "WR" | "TE" } | null>(null);
  const [prMode, setPrMode] = useState<"full" | "starters" | "bench">("full");

  return {
    leagueSearch, setLeagueSearch,
    oppRosterOwnerId, setOppRosterOwnerId,
    prSortKey, setPrSortKey,
    prSortAsc, setPrSortAsc: setPrSortAsc as React.Dispatch<React.SetStateAction<boolean>>,
    prPopup, setPrPopup,
    prMode, setPrMode,
  };
}
