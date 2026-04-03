import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";

export default function Dashboard({ username, leagues, onSelectLeague, onNavigate }) {
  const isConnected = !!username;
  const [search, setSearch] = useState("");
  const [recentLeagues, setRecentLeagues] = useState([]);

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

  void filteredLeagues;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="mb-10">
        <h1 className="text-4xl font-bold">Welcome back, {username} 👋</h1>
        <p className="text-slate-400 mt-2">
          Manage your leagues, track players, and dominate your dynasty.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 mb-12">
        {[
          { title: "League Hub", icon: "🏈" },
          { title: "Data Hub", icon: "📊" },
          { title: "Draft Hub", icon: "⚡" },
          { title: "Trade Hub", icon: "🔄" },
          { title: "Management Hub", icon: "⚙️" },
        ].map((item, i) => (
          <motion.div
            key={i}
            onClick={() => {
              if (!isConnected) return;

              if (item.title === "League Hub") {
                onNavigate("LEAGUES");
              }

              if (item.title === "Data Hub") {
                onNavigate("DATA_HUB");
              }

              if (item.title === "Draft Hub") {
                onNavigate("DRAFT");
              }

              if (item.title === "Trade Hub") {
                onNavigate("TRADE_HUB");
              }

              if (item.title === "Management Hub") {
                onNavigate("MANAGEMENT_HUB");
              }
            }}
            whileHover={isConnected ? { scale: 1.03 } : {}}
            className={`
              bg-slate-900 border border-slate-800 p-6 rounded-2xl transition
              ${isConnected ? "cursor-pointer hover:bg-slate-800" : "opacity-50 cursor-not-allowed"}
            `}
          >
            <div className="text-3xl mb-3">{item.icon}</div>
            <h2 className="text-lg font-semibold">{item.title}</h2>
            {!isConnected && (
              <div className="text-xs text-slate-400 mt-2">🔒 Connect to unlock</div>
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
                className="bg-slate-900 p-4 rounded-xl border border-slate-800 hover:bg-slate-800 cursor-pointer"
              >
                <p className="font-medium">{league.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
