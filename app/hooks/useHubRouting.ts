"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { LeagueHubTab } from "../../lib/types";
import { HUBS, type MainTab } from "../../lib/hubs";
import { LEAGUE_HUB_GROUPS } from "../../lib/leagueHubGroups";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/hooks/useLocalStorage";

// Allowed values for each tab, so a stored value that no longer exists (hub
// renamed/removed) falls back to the default instead of selecting a dead tab.
// MARKET was dropped in Phase B4/R2 — Trade Hub's Market Trends moved into Data
// Hub's Value Trends tab; a stale "MARKET" in localStorage now falls back to
// CALCULATOR via `restore()` below.
const TRADE_HUB_SECTIONS = ["CALCULATOR", "FINDER", "TRADE_LOG", "ATTEMPTS"] as const;
type TradeHubSection = typeof TRADE_HUB_SECTIONS[number];
const DATA_HUB_TABS = ["RANKINGS", "VALUE_TRENDS", "PROJECTIONS", "LEAGUEMATES", "DEPTH_CHARTS", "MY_SHARES", "COMPARE"] as const;
type DataHubTab = typeof DATA_HUB_TABS[number];
// HISTORICAL_BOARDS + HISTORICAL_LEAGUE_DRAFTS merged into HISTORICAL in Phase B4/R4.
const DRAFT_HUB_SECTIONS = ["BOARD", "BIG_BOARD", "HISTORY", "PICK_VALUES", "HISTORICAL"] as const;
type DraftHubSection = typeof DRAFT_HUB_SECTIONS[number];

const MAIN_TABS = HUBS.map((h) => h.id) as MainTab[];
const LEAGUE_HUB_TABS = LEAGUE_HUB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id)) as LeagueHubTab[];

// Read a persisted tab, keeping it only if it is still a valid option.
function restore<T>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = getLocalStorageItem<T | null>(key, null);
  return stored !== null && allowed.includes(stored) ? stored : fallback;
}

// ── URL query-string sync (Phase B1 — deep-linkable URLs) ───────────────────
// The app is a single route ("/"), so the whole hub/tab shell is driven by
// in-memory state, not the file router. We reflect that state into the query
// string (`?hub=<MainTab>&tab=<sub-tab>`) using the raw History API rather
// than next/navigation's useSearchParams/useRouter — those hooks require a
// Suspense boundary around anything that reads them (see the Next docs' "Missing
// Suspense boundary" note), which this all-client page.tsx doesn't have and
// doesn't need for what is otherwise a same-route, same-render URL cosmetic.
// A hub switch pushes a history entry (so back/forward moves between hubs); a
// sub-tab change within the current hub replaces it (too fine-grained for the
// back stack).
function subTabForHub(
  hub: MainTab,
  state: { tradeHubSection: TradeHubSection; leagueHubTab: LeagueHubTab; dataHubTab: DataHubTab; draftHubSection: DraftHubSection }
): string | null {
  switch (hub) {
    case "TRADE_HUB": return state.tradeHubSection;
    case "LEAGUES": return state.leagueHubTab;
    case "DATA_HUB": return state.dataHubTab;
    case "DRAFT": return state.draftHubSection;
    default: return null;
  }
}

function readUrlHub(): MainTab | null {
  if (typeof window === "undefined") return null;
  const hub = new URLSearchParams(window.location.search).get("hub");
  return hub && (MAIN_TABS as string[]).includes(hub) ? (hub as MainTab) : null;
}

function readUrlTab(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("tab");
}

function buildUrl(hub: MainTab, tab: string | null): string {
  const params = new URLSearchParams();
  params.set("hub", hub);
  if (tab) params.set("tab", tab);
  return `${window.location.pathname}?${params.toString()}`;
}

export function useHubRouting() {
  // mainTab always starts on DASHBOARD, full stop — no restoring from a
  // deep-linking URL or from localStorage. This is deliberate: users kept
  // landing back on whatever hub they'd last been on (Trade Hub, Data Hub,
  // etc.) instead of the Dashboard, both because the URL bar itself still
  // carries the last-visited `?hub=` (this hook rewrites it on every hub
  // change) and because of the localStorage fallback below. The URL-sync
  // effect further down still rewrites the address bar to `?hub=DASHBOARD`
  // on first mount, so even an old bookmarked/restored URL gets corrected.
  // Sub-tab state (tradeHubSection, dataHubTab, etc.) is unaffected — those
  // still restore normally once the user actually navigates into a hub.
  const [mainTab, setMainTabState] = useState<MainTab>("DASHBOARD");
  const [tradeHubSection, setTradeHubSection] = useState<TradeHubSection>(() => {
    const hub = readUrlHub();
    const tab = readUrlTab();
    return hub === "TRADE_HUB" && tab && (TRADE_HUB_SECTIONS as readonly string[]).includes(tab)
      ? (tab as TradeHubSection)
      : restore("tradeHubSection", TRADE_HUB_SECTIONS, "CALCULATOR");
  });
  const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>(() => {
    const hub = readUrlHub();
    const tab = readUrlTab();
    return hub === "LEAGUES" && tab && (LEAGUE_HUB_TABS as readonly string[]).includes(tab)
      ? (tab as LeagueHubTab)
      : restore("leagueHubTab", LEAGUE_HUB_TABS, "OVERVIEW");
  });
  const [dataHubTab, setDataHubTab] = useState<DataHubTab>(() => {
    const hub = readUrlHub();
    const tab = readUrlTab();
    return hub === "DATA_HUB" && tab && (DATA_HUB_TABS as readonly string[]).includes(tab)
      ? (tab as DataHubTab)
      : restore("dataHubTab", DATA_HUB_TABS, "RANKINGS");
  });
  const [draftHubSection, setDraftHubSection] = useState<DraftHubSection>(() => {
    const hub = readUrlHub();
    const tab = readUrlTab();
    return hub === "DRAFT" && tab && (DRAFT_HUB_SECTIONS as readonly string[]).includes(tab)
      ? (tab as DraftHubSection)
      : restore("draftHubSection", DRAFT_HUB_SECTIONS, "BOARD");
  });

  // Persist each sub-tab selection (writing to localStorage is an
  // external-system sync, the intended use of effects — not a React state
  // update). mainTab itself is deliberately NOT persisted — see above.
  useEffect(() => { setLocalStorageItem("tradeHubSection", tradeHubSection); }, [tradeHubSection]);
  useEffect(() => { setLocalStorageItem("leagueHubTab", leagueHubTab); }, [leagueHubTab]);
  useEffect(() => { setLocalStorageItem("dataHubTab", dataHubTab); }, [dataHubTab]);
  useEffect(() => { setLocalStorageItem("draftHubSection", draftHubSection); }, [draftHubSection]);

  const setMainTab = useCallback((tab: MainTab) => { setMainTabState(tab); }, []);

  const currentSubTab = subTabForHub(mainTab, { tradeHubSection, leagueHubTab, dataHubTab, draftHubSection });

  // Sync state -> URL. `prevRef`/`isFirstRunRef` live only inside this effect's
  // closure trail (read and written here alone), so there's no stale-closure
  // risk from the popstate listener below being registered with `[]` deps.
  const prevRef = useRef<{ mainTab: MainTab; subTab: string | null }>({ mainTab, subTab: currentSubTab });
  const isFirstRunRef = useRef(true);
  const isPoppingRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPoppingRef.current) {
      // State just came from a popstate — the URL already reflects it, so
      // just resync bookkeeping without writing to history again.
      isPoppingRef.current = false;
      prevRef.current = { mainTab, subTab: currentSubTab };
      return;
    }
    const url = buildUrl(mainTab, currentSubTab);
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      window.history.replaceState({ hub: mainTab, tab: currentSubTab }, "", url);
    } else if (prevRef.current.mainTab !== mainTab) {
      window.history.pushState({ hub: mainTab, tab: currentSubTab }, "", url);
    } else if (prevRef.current.subTab !== currentSubTab) {
      window.history.replaceState({ hub: mainTab, tab: currentSubTab }, "", url);
    }
    prevRef.current = { mainTab, subTab: currentSubTab };
  }, [mainTab, currentSubTab]);

  // Sync URL -> state on browser back/forward.
  useEffect(() => {
    function onPopState() {
      const hub = readUrlHub();
      if (!hub) return;
      const tab = readUrlTab();
      isPoppingRef.current = true;
      setMainTabState(hub);
      if (tab) {
        if (hub === "TRADE_HUB" && (TRADE_HUB_SECTIONS as readonly string[]).includes(tab)) setTradeHubSection(tab as TradeHubSection);
        else if (hub === "LEAGUES" && (LEAGUE_HUB_TABS as readonly string[]).includes(tab as LeagueHubTab)) setLeagueHubTab(tab as LeagueHubTab);
        else if (hub === "DATA_HUB" && (DATA_HUB_TABS as readonly string[]).includes(tab)) setDataHubTab(tab as DataHubTab);
        else if (hub === "DRAFT" && (DRAFT_HUB_SECTIONS as readonly string[]).includes(tab)) setDraftHubSection(tab as DraftHubSection);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return {
    mainTab, setMainTab,
    tradeHubSection, setTradeHubSection,
    leagueHubTab, setLeagueHubTab,
    dataHubTab, setDataHubTab,
    draftHubSection, setDraftHubSection,
  };
}
