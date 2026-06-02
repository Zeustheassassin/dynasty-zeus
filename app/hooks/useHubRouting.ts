"use client";
import { useState } from "react";
import type { LeagueHubTab } from "../../lib/types";
import type { MainTab } from "../../lib/hubs";

export function useHubRouting() {
  const [mainTab, setMainTab] = useState<MainTab>("DASHBOARD");
  const [tradeHubSection, setTradeHubSection] = useState<
    "CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS" | "MARKET"
  >("CALCULATOR");
  const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>("OVERVIEW");
  const [dataHubTab, setDataHubTab] = useState<
    "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW" | "MY_SHARES"
  >("RANKINGS");
  const [draftHubSection, setDraftHubSection] = useState<
    "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL_BOARDS" | "HISTORICAL_LEAGUE_DRAFTS"
  >("BOARD");

  return {
    mainTab, setMainTab,
    tradeHubSection, setTradeHubSection,
    leagueHubTab, setLeagueHubTab,
    dataHubTab, setDataHubTab,
    draftHubSection, setDraftHubSection,
  };
}
