"use client";
import type { TradeAttempt, TradeAttemptStatus } from "../../../lib/types";
import { useModalBehavior } from "../../../lib/hooks/useModalBehavior";
import { Card } from "../../../components/ui/Card";
import EmptyState from "../../../components/ui/EmptyState";
import Button from "../../../components/ui/Button";

interface Props {
  attempts: TradeAttempt[];
  allLeagues: { league_id: string; name: string }[];
  onUpdateAttemptStatus: (id: string, status: TradeAttemptStatus) => Promise<void>;
  onDeleteAttempt: (id: string) => Promise<void>;
  onNavigateToAttempts: (leagueId: string) => void;
  onClose: () => void;
}

const statusConfig: Record<string, { label: string; color: string; border: string }> = {
  PENDING:     { label: "Pending",     color: "text-amber-300",   border: "border-amber-700 bg-amber-950/20"   },
  ACCEPTED:    { label: "Accepted",    color: "text-emerald-300", border: "border-emerald-700 bg-emerald-950/20" },
  DECLINED:    { label: "Declined",    color: "text-red-300",     border: "border-red-700 bg-red-950/20"       },
  COUNTERED:   { label: "Countered",   color: "text-orange-300",  border: "border-orange-700 bg-orange-950/20" },
  NO_RESPONSE: { label: "No Response", color: "text-slate-400",   border: "border-slate-600 bg-slate-800/40"   },
};

const formatDate = (iso: string | null) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export function AllOpenTradesPanel({
  attempts, allLeagues, onUpdateAttemptStatus, onDeleteAttempt, onNavigateToAttempts, onClose,
}: Props) {
  useModalBehavior(onClose);

  const leagueNames = Object.fromEntries(allLeagues.map((l) => [l.league_id, l.name]));

  const openAttempts = attempts
    .filter((a) => a.status === "PENDING")
    .sort((a, b) => new Date(b.attempted_at).getTime() - new Date(a.attempted_at).getTime());

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Trade Hub</div>
            <h1 className="mt-1 text-2xl font-semibold text-white">All Open Trades</h1>
            <p className="mt-1 text-sm text-slate-400">
              {openAttempts.length} pending {openAttempts.length === 1 ? "trade" : "trades"} across all leagues
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>

        {openAttempts.length === 0 && (
          <EmptyState>No pending trades across any of your leagues.</EmptyState>
        )}

        {openAttempts.map((attempt) => {
          const sc = statusConfig[attempt.status] ?? statusConfig.PENDING;
          const leagueName = leagueNames[attempt.league_id] || "Unknown League";

          return (
            <Card key={attempt.id}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="rounded-full border border-blue-800/60 bg-blue-950/30 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                  {leagueName}
                </span>
                <span className="text-sm font-semibold text-blue-300">{attempt.partner_name}</span>
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase">
                  {attempt.source}
                </span>
                {attempt.initiated_by === "THEM" ? (
                  <span className="rounded-full border border-indigo-700 bg-indigo-950/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                    Sent by Them
                  </span>
                ) : (
                  <span className="rounded-full border border-orange-800 bg-orange-950/20 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
                    Sent by Me
                  </span>
                )}
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sc.border} ${sc.color}`}>
                  {sc.label}
                </span>
                <span className="ml-auto text-[10px] text-slate-500">
                  {attempt.initiated_by === "THEM" ? "Received" : "Offered"} {formatDate(attempt.attempted_at)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                  <div className="space-y-1">
                    {attempt.give_players.map((p) => (
                      <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-slate-800 px-2 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-white truncate">{p.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0 uppercase">{p.position}</span>
                        </div>
                        {p.value > 0 && <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">{p.value.toLocaleString()}</span>}
                      </div>
                    ))}
                    {attempt.give_picks.map((pk) => (
                      <div key={pk.key} className="flex items-center justify-between rounded-lg bg-slate-800 px-2 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-white truncate">{pk.label}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">PICK</span>
                        </div>
                        {pk.value > 0 && <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>}
                      </div>
                    ))}
                    {attempt.give_players.length === 0 && attempt.give_picks.length === 0 && <p className="text-xs text-slate-600">—</p>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1.5">You Receive</div>
                  <div className="space-y-1">
                    {attempt.receive_players.map((p) => (
                      <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-slate-800 px-2 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-white truncate">{p.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0 uppercase">{p.position}</span>
                        </div>
                        {p.value > 0 && <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">{p.value.toLocaleString()}</span>}
                      </div>
                    ))}
                    {attempt.receive_picks.map((pk) => (
                      <div key={pk.key} className="flex items-center justify-between rounded-lg bg-slate-800 px-2 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-white truncate">{pk.label}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">PICK</span>
                        </div>
                        {pk.value > 0 && <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>}
                      </div>
                    ))}
                    {attempt.receive_players.length === 0 && attempt.receive_picks.length === 0 && <p className="text-xs text-slate-600">—</p>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(["ACCEPTED", "DECLINED", "COUNTERED", "NO_RESPONSE"] as TradeAttemptStatus[]).map((s) => {
                  const cfg = statusConfig[s];
                  return (
                    <button
                      key={s}
                      onClick={() => onUpdateAttemptStatus(attempt.id, s)}
                      className="text-[11px] font-semibold px-3 py-1 rounded-full border border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300 transition"
                    >
                      {cfg.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => { onNavigateToAttempts(attempt.league_id); onClose(); }}
                  className="text-[11px] text-blue-400 hover:text-blue-300 transition"
                >
                  Open in Trade Hub →
                </button>
                <button
                  onClick={() => { if (window.confirm("Delete this trade attempt? This cannot be undone.")) onDeleteAttempt(attempt.id); }}
                  className="ml-auto text-[11px] text-slate-600 hover:text-red-400 transition"
                >
                  Delete
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
