"use client";
import type { User as SupabaseUser } from "@supabase/auth-js";
import type { SleeperUser, SleeperLeague } from "../../lib/types";
import { HUBS, type MainTab } from "../../lib/hubs";
import { setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

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
  children: React.ReactNode;
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
  children,
}: MainLayoutProps) {
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
              {/* NAV */}
              <div className="border-t border-gray-800">
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

            {children}
          </>
        </div>
      </main>
    </>
  );
}
