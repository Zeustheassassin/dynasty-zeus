"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SleeperPlayer, LeagueHubTab } from "../lib/types";
import { HUBS, type MainTab } from "../lib/hubs";
import { LEAGUE_HUB_GROUPS } from "../lib/leagueHubGroups";
import { useModalBehavior } from "../lib/hooks/useModalBehavior";

// Local copies of the sub-tab unions — every other hub/tab consumer (HubRouter,
// DataHub, DraftHub, useHubRouting) keeps its own copy rather than a shared type.
type TradeHubSection = "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS";
type DataHubTab = "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW" | "MY_SHARES";
type DraftHubSection = "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL";

export interface CommandPaletteProps {
  players: Record<string, SleeperPlayer>;
  setMainTab: (tab: MainTab) => void;
  setTradeHubSection: (s: TradeHubSection) => void;
  setLeagueHubTab: (t: LeagueHubTab) => void;
  setDataHubTab: (t: DataHubTab) => void;
  setDraftHubSection: (s: DraftHubSection) => void;
  setPlayerProfileId: (id: string | null) => void;
  onClose: () => void;
}

const TRADE_HUB_LABELS: Record<TradeHubSection, string> = {
  CALCULATOR: "Trade Calculator",
  FINDER: "Trade Finder",
  ATTEMPTS: "Attempted Trades",
  TRADE_LOG: "Completed Trades",
};
const DATA_HUB_LABELS: Record<DataHubTab, string> = {
  RANKINGS: "Rankings",
  VALUE_TRENDS: "Value Trends",
  PROJECTIONS: "Projections",
  LEAGUEMATES: "League Mates",
  DEPTH_CHARTS: "Depth Charts",
  BUY_LOW: "Buy Low",
  MY_SHARES: "My Shares",
};
const DRAFT_HUB_LABELS: Record<DraftHubSection, string> = {
  BOARD: "Live Draft Board",
  BIG_BOARD: "Rookie Big Board",
  PICK_VALUES: "Pick Values",
  HISTORY: "Draft History",
  HISTORICAL: "Historical Boards & Drafts",
};

interface NavItem {
  key: string;
  label: string;
  isHub: boolean;
  run: (p: CommandPaletteProps) => void;
}

// Static — hubs + every synced sub-tab, each with a closure that drives the
// hub/tab setters. Built once at module scope; the palette only filters it.
const NAV_ITEMS: NavItem[] = [
  ...HUBS.map((h) => ({
    key: `hub:${h.id}`,
    label: h.label,
    isHub: true,
    run: (p: CommandPaletteProps) => p.setMainTab(h.id),
  })),
  ...(Object.keys(TRADE_HUB_LABELS) as TradeHubSection[]).map((s) => ({
    key: `trade:${s}`,
    label: `Trade Hub: ${TRADE_HUB_LABELS[s]}`,
    isHub: false,
    run: (p: CommandPaletteProps) => { p.setMainTab("TRADE_HUB"); p.setTradeHubSection(s); },
  })),
  ...LEAGUE_HUB_GROUPS.flatMap((g) => g.tabs).map((t) => ({
    key: `league:${t.id}`,
    label: `League Hub: ${t.label}`,
    isHub: false,
    run: (p: CommandPaletteProps) => { p.setMainTab("LEAGUES"); p.setLeagueHubTab(t.id); },
  })),
  ...(Object.keys(DATA_HUB_LABELS) as DataHubTab[]).map((t) => ({
    key: `data:${t}`,
    label: `Data Hub: ${DATA_HUB_LABELS[t]}`,
    isHub: false,
    run: (p: CommandPaletteProps) => { p.setMainTab("DATA_HUB"); p.setDataHubTab(t); },
  })),
  ...(Object.keys(DRAFT_HUB_LABELS) as DraftHubSection[]).map((s) => ({
    key: `draft:${s}`,
    label: `Draft Hub: ${DRAFT_HUB_LABELS[s]}`,
    isHub: false,
    run: (p: CommandPaletteProps) => { p.setMainTab("DRAFT"); p.setDraftHubSection(s); },
  })),
];

const MAX_NAV_RESULTS = 10;
const MAX_PLAYER_RESULTS = 8;
const MIN_PLAYER_QUERY_LENGTH = 2;

interface ResultItem {
  key: string;
  label: string;
  run: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const { players, setPlayerProfileId, onClose } = props;
  useModalBehavior(onClose);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Empty query: browse the top-level hubs only — sub-tabs are a search
    // refinement, not something to dump in a blank-state list.
    const pool = q ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.isHub);
    const matches = q ? NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q)) : pool;
    return matches.slice(0, MAX_NAV_RESULTS);
  }, [query]);

  const playerMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < MIN_PLAYER_QUERY_LENGTH) return [];
    const matches: SleeperPlayer[] = [];
    for (const p of Object.values(players)) {
      if (p.full_name && p.full_name.toLowerCase().includes(q)) matches.push(p);
    }
    matches.sort((a, b) => {
      const aStarts = a.full_name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.full_name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts !== bStarts ? aStarts - bStarts : a.full_name.localeCompare(b.full_name);
    });
    return matches.slice(0, MAX_PLAYER_RESULTS);
  }, [players, query]);

  const results: ResultItem[] = useMemo(() => [
    ...navMatches.map((item) => ({ key: item.key, label: item.label, run: () => item.run(props) })),
    ...playerMatches.map((p) => ({
      key: `player:${p.player_id}`,
      label: `${p.full_name}${p.team ? ` — ${p.team}` : ""}${p.position ? ` (${p.position})` : ""}`,
      run: () => setPlayerProfileId(p.player_id),
    })),
  ], [navMatches, playerMatches, props, setPlayerProfileId]);

  useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const activate = (index: number) => {
    const item = results[index];
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center pt-24 z-[100]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg mx-4 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); activate(selectedIndex); }
          }}
          placeholder="Jump to a hub, tab, or player..."
          className="w-full px-4 py-3 bg-transparent border-b border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none"
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">No matches</div>
          )}
          {results.map((item, i) => (
            <button
              key={item.key}
              onClick={() => activate(i)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left px-4 py-2 text-sm truncate ${
                i === selectedIndex ? "bg-blue-600/30 text-white" : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
