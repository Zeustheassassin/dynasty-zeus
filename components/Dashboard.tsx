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

const navCardRows = [
  [
    {
      title: "League Hub",
      tab: "LEAGUES",
      image: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=800&q=80&auto=format&fit=crop",
      overlay: "from-blue-950/70 via-slate-900/60 to-slate-950/80",
    },
    {
      title: "Gameday Hub",
      tab: "GAMEDAY_HUB",
      image: "https://images.unsplash.com/photo-1508098682722-e99c643e7485?w=800&q=80&auto=format&fit=crop",
      overlay: "from-emerald-950/75 via-slate-900/60 to-slate-950/85",
    },
    {
      title: "Trade Hub",
      tab: "TRADE_HUB",
      image: "https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800&q=80&auto=format&fit=crop",
      overlay: "from-orange-950/70 via-slate-900/60 to-slate-950/80",
    },
  ],
  [
    {
      title: "Draft Hub",
      tab: "DRAFT",
      image: "https://images.pexels.com/photos/264411/pexels-photo-264411.jpeg?auto=compress&cs=tinysrgb&w=800",
      overlay: "from-emerald-950/70 via-slate-900/60 to-slate-950/80",
    },
    {
      title: "Data Hub",
      tab: "DATA_HUB",
      image: "https://images.pexels.com/photos/274517/pexels-photo-274517.jpeg?auto=compress&cs=tinysrgb&w=800",
      overlay: "from-cyan-950/70 via-slate-900/60 to-slate-950/80",
    },
    {
      title: "Management Hub",
      tab: "MANAGEMENT_HUB",
      image: "https://images.pexels.com/photos/718951/pexels-photo-718951.jpeg?auto=compress&cs=tinysrgb&w=800",
      overlay: "from-violet-950/70 via-slate-900/60 to-slate-950/80",
    },
  ],
  [
    {
      title: "Alerts",
      tab: "ALERTS",
      image: "https://images.pexels.com/photos/128457/pexels-photo-128457.jpeg?auto=compress&cs=tinysrgb&w=800",
      overlay: "from-red-950/70 via-slate-900/60 to-slate-950/80",
    },
  ],
] as const;

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

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mb-10">
        <h1 className="text-4xl font-bold">Welcome back, {username || "builder"}</h1>
        <p className="mt-2 text-slate-400">
          Manage your leagues, surface what changed, and keep the next move obvious.
        </p>
      </div>

      <div className="mb-12 space-y-5">
        {navCardRows.map((row, rowIndex) => (
          <div
            key={`dashboard-row-${rowIndex}`}
            className={
              row.length === 1
                ? "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
                : "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
            }
          >
            {row.map((item) => (
              <motion.div
                key={item.tab}
                onClick={() => {
                  if (!isConnected) return;
                  onNavigate(item.tab);
                }}
                whileHover={isConnected ? { scale: 1.03 } : {}}
                className={`relative h-44 w-full overflow-hidden rounded-3xl border border-slate-800 transition ${
                  row.length === 1 ? "justify-self-center md:col-span-2 md:max-w-[320px] xl:col-span-1 xl:col-start-2" : ""
                } ${
                  isConnected ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                }`}
              >
                <img
                  src={item.image}
                  alt={item.title}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <div className={`absolute inset-0 bg-gradient-to-b ${item.overlay}`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                <div className="relative z-10 flex h-full flex-col justify-end p-5">
                  <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-lg">
                    {item.title}
                  </h2>
                  {!isConnected && (
                    <p className="mt-1 text-xs text-slate-300">Connect to unlock</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        ))}
      </div>

      {isConnected && (
        <div className="mb-12">
          <h2 className="mb-4 text-xl font-semibold text-slate-300">Recently Viewed Leagues</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {recentLeagues.map((league) => (
              <motion.div
                key={league.league_id}
                whileHover={{ scale: 1.02 }}
                onClick={() => {
                  onSelectLeague(league);
                  onNavigate("LEAGUES");
                }}
                className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900 p-4 hover:bg-slate-800"
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
            className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
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
