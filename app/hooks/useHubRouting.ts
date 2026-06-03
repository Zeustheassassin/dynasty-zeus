"use client";
import { useState, useEffect } from "react";
import type { LeagueHubTab } from "../../lib/types";
import { HUBS, type MainTab } from "../../lib/hubs";
import { LEAGUE_HUB_GROUPS } from "../../lib/leagueHubGroups";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/hooks/useLocalStorage";

// Allowed values for each tab, so a stored value that no longer exists (hub
// renamed/removed) falls back to the default instead of selecting a dead tab.
const TRADE_HUB_SECTIONS = ["CALCULATOR", "FINDER", "RECOMMENDATIONS", "TRADE_LOG", "ATTEMPTS", "MARKET"] as const;
type TradeHubSection = typeof TRADE_HUB_SECTIONS[number];
const DATA_HUB_TABS = ["RANKINGS", "VALUE_TRENDS", "PROJECTIONS", "LEAGUEMATES", "DEPTH_CHARTS", "BUY_LOW", "MY_SHARES"] as const;
type DataHubTab = typeof DATA_HUB_TABS[number];
const DRAFT_HUB_SECTIONS = ["BOARD", "BIG_BOARD", "HISTORY", "PICK_VALUES", "HISTORICAL_BOARDS", "HISTORICAL_LEAGUE_DRAFTS"] as const;
type DraftHubSection = typeof DRAFT_HUB_SECTIONS[number];

const MAIN_TABS = HUBS.map((h) => h.id) as MainTab[];
const LEAGUE_HUB_TABS = LEAGUE_HUB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id)) as LeagueHubTab[];

// Read a persisted tab, keeping it only if it is still a valid option.
function restore<T>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = getLocalStorageItem<T | null>(key, null);
  return stored !== null && allowed.includes(stored) ? stored : fallback;
}

export function useHubRouting() {
  // Lazy-init from localStorage (validated against the allowed values, so a stored
  // tab that no longer exists falls back to the default). getLocalStorageItem
  // returns the default during SSR (window undefined) — same pattern as the
  // existing useLocalStorage hook. Persist on change via the effects below.
  const [mainTab, setMainTab] = useState<MainTab>(() => restore("mainTab", MAIN_TABS, "DASHBOARD"));
  const [tradeHubSection, setTradeHubSection] = useState<TradeHubSection>(() => restore("tradeHubSection", TRADE_HUB_SECTIONS, "CALCULATOR"));
  const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>(() => restore("leagueHubTab", LEAGUE_HUB_TABS, "OVERVIEW"));
  const [dataHubTab, setDataHubTab] = useState<DataHubTab>(() => restore("dataHubTab", DATA_HUB_TABS, "RANKINGS"));
  const [draftHubSection, setDraftHubSection] = useState<DraftHubSection>(() => restore("draftHubSection", DRAFT_HUB_SECTIONS, "BOARD"));

  // Persist each selection (writing to localStorage is an external-system sync,
  // the intended use of effects — not a React state update).
  useEffect(() => { setLocalStorageItem("mainTab", mainTab); }, [mainTab]);
  useEffect(() => { setLocalStorageItem("tradeHubSection", tradeHubSection); }, [tradeHubSection]);
  useEffect(() => { setLocalStorageItem("leagueHubTab", leagueHubTab); }, [leagueHubTab]);
  useEffect(() => { setLocalStorageItem("dataHubTab", dataHubTab); }, [dataHubTab]);
  useEffect(() => { setLocalStorageItem("draftHubSection", draftHubSection); }, [draftHubSection]);

  return {
    mainTab, setMainTab,
    tradeHubSection, setTradeHubSection,
    leagueHubTab, setLeagueHubTab,
    dataHubTab, setDataHubTab,
    draftHubSection, setDraftHubSection,
  };
}
