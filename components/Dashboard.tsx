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

const navCards = [
  {
    title: "League Hub",
    tab: "LEAGUES",
    // American football on field — yard lines visible
    image: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=800&q=80&auto=format&fit=crop",
    overlay: "from-blue-950/70 via-slate-900/60 to-slate-950/80",
  },
  {
    title: "Data Hub",
    tab: "DATA_HUB",
    // Clash of American football players — competitive/analytical
    image: "https://images.pexels.com/photos/274517/pexels-photo-274517.jpeg?auto=compress&cs=tinysrgb&w=800",
    overlay: "from-cyan-950/70 via-slate-900/60 to-slate-950/80",
  },
  {
    title: "Draft Hub",
    tab: "DRAFT",
    // QB running with ball on green field — draft prospect energy
    image: "https://images.pexels.com/photos/264411/pexels-photo-264411.jpeg?auto=compress&cs=tinysrgb&w=800",
    overlay: "from-emerald-950/70 via-slate-900/60 to-slate-950/80",
  },
  {
    title: "Trade Hub",
    tab: "TRADE_HUB",
    // Handshake — deal making
    image: "https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800&q=80&auto=format&fit=crop",
    overlay: "from-orange-950/70 via-slate-900/60 to-slate-950/80",
  },
  {
    title: "Alerts",
    tab: "ALERTS",
    // NFL stadium packed with fans, game day
    image: "https://images.pexels.com/photos/128457/pexels-photo-128457.jpeg?auto=compress&cs=tinysrgb&w=800",
    overlay: "from-red-950/70 via-slate-900/60 to-slate-950/80",
  },
  {
    title: "Management Hub",
    tab: "MANAGEMENT_HUB",
    // Football team running through field — roster/team management
    image: "https://images.pexels.com/photos/718951/pexels-photo-718951.jpeg?auto=compress&cs=tinysrgb&w=800",
    overlay: "from-violet-950/70 via-slate-900/60 to-slate-950/80",
  },
];

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
              relative overflow-hidden rounded-3xl border border-slate-800 h-44 transition
              ${isConnected ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}
            `}
          >
            {/* Background image */}
            <img
              src={item.image}
              alt={item.title}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            {/* Gradient overlay — dims image and ensures text reads clearly */}
            <div className={`absolute inset-0 bg-gradient-to-b ${item.overlay}`} />
            {/* Subtle top vignette for extra depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

            {/* Text content — pinned to bottom */}
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
