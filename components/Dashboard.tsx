import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";

type LeagueCard = {
  league_id: string;
  name: string;
};

type DashboardProps = {
  username: string;
  leagues: LeagueCard[];
  onSelectLeague: (league: LeagueCard) => void;
  onNavigate: (tab: string) => void;
};

export default function Dashboard({
  username,
  leagues,
  onSelectLeague,
  onNavigate,
}: DashboardProps) {
  const isConnected = !!username;
  const [search, setSearch] = useState("");
  const [recentLeagues, setRecentLeagues] = useState<LeagueCard[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("recentLeagues");
    if (stored) {
      setRecentLeagues(JSON.parse(stored));
    }
  }, []);

  const filteredLeagues = useMemo(() => {
    return leagues
      .filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [search, leagues]);

  const navCards = [
    { title: "League Hub", icon: "LH", tab: "LEAGUES" },
    { title: "Data Hub", icon: "DH", tab: "DATA_HUB" },
    { title: "Draft Hub", icon: "DR", tab: "DRAFT" },
    { title: "Trade Hub", icon: "TR", tab: "TRADE_HUB" },
    { title: "Alerts", icon: "AL", tab: "ALERTS" },
    { title: "Management Hub", icon: "MG", tab: "MANAGEMENT_HUB" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="mb-10">
        <h1 className="text-4xl font-bold">Welcome back, {username || "builder"}</h1>
        <p className="text-slate-400 mt-2">
          Manage your leagues, surface what changed, and keep the next move obvious.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 mb-12">
        {navCards.map((item, i) => (
          <motion.div
            key={i}
            onClick={() => {
              if (!isConnected) return;
              onNavigate(item.tab);
            }}
            whileHover={isConnected ? { scale: 1.03 } : {}}
            className={`
              rounded-3xl border border-slate-800 bg-slate-900 p-6 transition
              ${isConnected ? "cursor-pointer hover:bg-slate-800" : "opacity-50 cursor-not-allowed"}
            `}
          >
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-200">
              {item.icon}
            </div>
            <h2 className="text-lg font-semibold">{item.title}</h2>
            {!isConnected && (
              <div className="mt-2 text-xs text-slate-400">Connect to unlock</div>
            )}
          </motion.div>
        ))}
      </div>

      {isConnected && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">Recently Viewed Leagues</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentLeagues.map((league) => (
              <motion.div
                key={league.league_id}
                whileHover={{ scale: 1.02 }}
                onClick={() => {
                  onSelectLeague(league);
                  onNavigate("LEAGUES");
                }}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-4 hover:bg-slate-800 cursor-pointer"
              >
                <p className="font-medium">{league.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {!isConnected && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
          Sign in and connect Sleeper to activate your league workspace and alerts page.
        </div>
      )}

      {isConnected && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">League Search</div>
              <div className="mt-1 text-sm text-slate-400">Jump straight into a league from the dashboard.</div>
            </div>
            <div className="text-xs text-slate-500">{filteredLeagues.length} matches</div>
          </div>
          <input
            className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="Search leagues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {filteredLeagues.slice(0, 6).map((league) => (
                <button
                  key={league.league_id}
                  type="button"
                  onClick={() => {
                    onSelectLeague(league);
                    onNavigate("LEAGUES");
                  }}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-left text-sm text-white transition hover:border-blue-500"
                >
                  {league.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
