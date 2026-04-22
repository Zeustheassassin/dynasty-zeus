"use client";
import Image from "next/image";

type DashboardProps = {
  username: string;
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
      image: "https://images.pexels.com/photos/1618200/pexels-photo-1618200.jpeg?auto=compress&cs=tinysrgb&w=800",
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
      title: "Alert Hub",
      tab: "ALERTS",
      image: "https://images.pexels.com/photos/128457/pexels-photo-128457.jpeg?auto=compress&cs=tinysrgb&w=800",
      overlay: "from-red-950/70 via-slate-900/60 to-slate-950/80",
    },
    {
      title: "Scouting Hub",
      tab: "SCOUTING_HUB",
      image: "https://images.pexels.com/photos/1618200/pexels-photo-1618200.jpeg?auto=compress&cs=tinysrgb&w=800",
      overlay: "from-purple-950/70 via-slate-900/60 to-slate-950/80",
    },
  ],
] as const;

export default function Dashboard({
  username,
  onNavigate,
}: DashboardProps) {
  const isConnected = !!username;

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
            className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            {row.map((item) => (
              <button
                key={item.tab}
                type="button"
                aria-label={item.title}
                aria-disabled={!isConnected}
                tabIndex={isConnected ? 0 : -1}
                onClick={() => {
                  if (!isConnected) return;
                  onNavigate(item.tab);
                }}
                className={`relative h-44 w-full overflow-hidden rounded-3xl border border-slate-800 text-left transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                  isConnected
                    ? "cursor-pointer hover:scale-[1.03]"
                    : "cursor-not-allowed opacity-40"
                }`}
              >
                <Image
                  src={item.image}
                  alt=""
                  aria-hidden="true"
                  className="object-cover"
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
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
              </button>
            ))}
          </div>
        ))}
      </div>

      {!isConnected && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
          Sign in and connect Sleeper to activate your league workspace and alerts page.
        </div>
      )}
    </div>
  );
}
