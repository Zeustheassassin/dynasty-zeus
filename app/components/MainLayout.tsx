"use client";
import { useEffect, useState } from "react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import type { SleeperUser, SleeperLeague, SleeperPlayer, LeagueHubTab, SleeperNFLState } from "../../lib/types";
import { HUBS, type MainTab } from "../../lib/hubs";
import { setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import { CommandPalette } from "../../components/CommandPalette";
import { useModalBehavior } from "../../lib/hooks/useModalBehavior";

interface MainLayoutProps {
  supabaseUser: SupabaseUser | null;
  user: SleeperUser | null;
  disconnectSleeper: () => void;
  signOut: () => void;
  leagues: SleeperLeague[];
  selectedLeague: SleeperLeague | null;
  loadRoster: (league: SleeperLeague) => void;
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
  nflState: SleeperNFLState | null;
  // Command palette (Cmd+K)
  players: Record<string, SleeperPlayer>;
  setTradeHubSection: (s: "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS") => void;
  setLeagueHubTab: (t: LeagueHubTab) => void;
  setDataHubTab: (t: "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "LEAGUEMATES" | "DEPTH_CHARTS" | "MY_SHARES" | "COMPARE") => void;
  setDraftHubSection: (s: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL") => void;
  setPlayerProfileId: (id: string | null) => void;
  children: React.ReactNode;
}

// Seasonal primary hub set for the mobile bottom nav (R3) — mirrors the
// isRegularSeason check used everywhere else in the app (see
// lib/helpers/rookieProjection.ts's `isOffseason`).
const IN_SEASON_MOBILE_HUBS: MainTab[] = ["TRADE_HUB", "LEAGUES", "GAMEDAY_HUB", "ALERTS"];
const OFFSEASON_MOBILE_HUBS: MainTab[] = ["TRADE_HUB", "LEAGUES", "DATA_HUB", "ALERTS"];

function MobileOverflowSheet({
  hubs, mainTab, setMainTab, disabled, onClose,
}: {
  hubs: typeof HUBS[number][];
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
  disabled: boolean;
  onClose: () => void;
}) {
  useModalBehavior(onClose);
  return (
    <div className="fixed inset-0 bg-black/60 z-[90] sm:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More hubs"
        className="absolute bottom-16 inset-x-0 bg-gray-900 border-t border-gray-700 rounded-t-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {hubs.map((h) => (
          <button
            key={h.id}
            disabled={disabled && h.id !== "DASHBOARD"}
            onClick={() => { setMainTab(h.id); onClose(); }}
            className={`w-full text-left px-4 py-3 text-sm border-b border-gray-800 last:border-0 ${
              mainTab === h.id ? "text-blue-400 font-semibold" : "text-gray-300"
            } ${disabled && h.id !== "DASHBOARD" ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MainLayout({
  supabaseUser,
  user,
  disconnectSleeper,
  signOut,
  leagues,
  selectedLeague,
  loadRoster,
  mainTab,
  setMainTab,
  nflState,
  players,
  setTradeHubSection,
  setLeagueHubTab,
  setDataHubTab,
  setDraftHubSection,
  setPlayerProfileId,
  children,
}: MainLayoutProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const isInSeason = nflState?.season_type === "regular" && (nflState?.week ?? 0) > 0;
  const primaryMobileHubIds = isInSeason ? IN_SEASON_MOBILE_HUBS : OFFSEASON_MOBILE_HUBS;
  const primaryMobileHubs = primaryMobileHubIds
    .map((id) => HUBS.find((h) => h.id === id))
    .filter((h): h is typeof HUBS[number] => h !== undefined);
  const overflowMobileHubs = HUBS.filter((h) => !primaryMobileHubIds.includes(h.id));
  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[99999] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded focus:text-sm">Skip to main content</a>
      <main id="main-content" className="min-h-screen bg-gray-950 text-white">
        {/* App content — always rendered but non-interactive when not signed in */}
        <div className={!supabaseUser ? "pointer-events-none select-none opacity-40" : ""}>
          <>
            {/* HEADER */}
            {/* z-30 keeps the nav above sticky table cells (Big Board uses z-10/z-20 on
                sticky left columns + headers); without this, those cells paint over the
                nav as the page scrolls vertically. */}
            <div className="sticky top-0 z-30 bg-gray-900 border-b border-gray-700">
              {/* Top bar */}
              <div className="flex overflow-x-auto scrollbar-none md:justify-center">
                <div className="flex items-center px-3 py-2 gap-4 shrink-0">
                  <h1 className="text-base font-bold shrink-0">DynastyZeus</h1>
                  <button
                    onClick={() => setPaletteOpen(true)}
                    title="Search (Ctrl+K)"
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 bg-gray-800/60 border border-gray-700 rounded hover:text-white hover:border-gray-600 transition shrink-0"
                  >
                    <span aria-hidden="true">🔍</span>
                    <span className="hidden sm:inline">Search</span>
                    <kbd className="hidden sm:inline text-[10px] text-gray-500 border border-gray-700 rounded px-1">Ctrl K</kbd>
                  </button>
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Unified auth status — shows both Supabase account and Sleeper connection */}
                    <div className="hidden sm:flex items-center gap-1.5 text-xs">
                      {/* DynastyZeus account */}
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${supabaseUser ? "bg-green-400" : "bg-red-500"}`}
                        title={supabaseUser ? `Signed in as ${supabaseUser.email}` : "Not signed in"}
                      />
                      {/* Sleeper connection */}
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${user ? "bg-blue-400" : "bg-gray-600"}`}
                        title={user ? `Sleeper: ${user.display_name}` : "Sleeper not connected"}
                      />
                      {user && (
                        <span className="text-gray-400 truncate max-w-[80px]">{user.display_name}</span>
                      )}
                    </div>
                    {user && (
                      <button
                        onClick={() => {
                          if (window.confirm("Disconnect Sleeper? This clears your synced leagues from this browser. You can reconnect anytime by entering your username.")) {
                            disconnectSleeper();
                          }
                        }}
                        className="px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 shrink-0"
                      >
                        Disconnect
                      </button>
                    )}
                    {leagues.length > 0 && (
                      <select
                        value={selectedLeague?.league_id || ""}
                        onChange={(e) => {
                          const league = leagues.find((l) => l.league_id === e.target.value);
                          if (league) {
                            loadRoster(league);
                            if (mainTab === "DASHBOARD") setMainTab("LEAGUES");
                            setLocalStorageItem("selectedLeague", league);
                          }
                        }}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs max-w-[120px] truncate"
                      >
                        <option value="">Select League</option>
                        {leagues.map((l) => (
                          <option key={l.league_id} value={l.league_id}>{l.name}</option>
                        ))}
                      </select>
                    )}
                    {supabaseUser && (
                      <button onClick={signOut} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded transition shrink-0">
                        Log Out
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {/* NAV — desktop only; mobile gets the fixed bottom nav below (R3) */}
              <div className="hidden sm:block border-t border-gray-800">
                <div className="mx-auto max-w-7xl overflow-x-auto scrollbar-none">
                  <div className="flex min-w-max justify-start px-2 md:justify-center">
                    {HUBS.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setMainTab(tab.id)}
                        disabled={!user && tab.id !== "DASHBOARD"}
                        className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition md:px-5 ${
                          mainTab === tab.id
                            ? "border-blue-500 text-blue-400"
                            : "border-transparent text-gray-400 hover:text-white"
                        } ${!user && tab.id !== "DASHBOARD" ? "opacity-40 cursor-not-allowed" : ""}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom padding so the fixed mobile nav doesn't cover page content */}
            <div className="pb-16 sm:pb-0">{children}</div>

            {/* MOBILE BOTTOM NAV (R3) — seasonal primary hub set + overflow sheet for
                the rest. Nested inside the dimmed wrapper so it goes inert along with
                the rest of the app when signed out, same as the desktop nav above. */}
            <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-gray-900 border-t border-gray-700 flex">
              {primaryMobileHubs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMainTab(tab.id)}
                  disabled={!user && tab.id !== "DASHBOARD"}
                  className={`flex-1 py-2.5 text-[11px] font-medium leading-tight transition ${
                    mainTab === tab.id ? "text-blue-400" : "text-gray-400"
                  } ${!user && tab.id !== "DASHBOARD" ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
              <button
                onClick={() => setOverflowOpen(true)}
                className={`flex-1 py-2.5 text-[11px] font-medium leading-tight transition ${
                  overflowMobileHubs.some((h) => h.id === mainTab) ? "text-blue-400" : "text-gray-400"
                }`}
              >
                More
              </button>
            </div>
          </>
        </div>
      </main>
      {overflowOpen && (
        <MobileOverflowSheet
          hubs={overflowMobileHubs}
          mainTab={mainTab}
          setMainTab={setMainTab}
          disabled={!user}
          onClose={() => setOverflowOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          players={players}
          setMainTab={setMainTab}
          setTradeHubSection={setTradeHubSection}
          setLeagueHubTab={setLeagueHubTab}
          setDataHubTab={setDataHubTab}
          setDraftHubSection={setDraftHubSection}
          setPlayerProfileId={setPlayerProfileId}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </>
  );
}
