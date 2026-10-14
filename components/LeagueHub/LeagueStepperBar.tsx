"use client";
import { memo } from "react";
import type { SleeperLeague } from "../../lib/types";
import { getStepIndex, type LeagueStepSession } from "../../lib/helpers/actionQueue";
import Button from "../ui/Button";
import SleeperLink from "../TodoHub/SleeperLink";

// League Hub bar for a run through the leagues needing attention (To-Do Stage 3,
// app/hooks/useLeagueStepper.ts): where the selected league sits in the run, Prev / Next (also
// [ / ] — MainLayout's key listener), Open in Sleeper and Back to To-Do. The run is fixed when it
// starts, so the position reads the snapshot, not the live list.

interface LeagueStepperBarProps {
  session: LeagueStepSession;
  leagues: SleeperLeague[];
  selectedLeagueId: string | null;
  onStep: (dir: 1 | -1) => void;
  onBackToTodo: () => void;
  onClose: () => void;
}

const KEY_HINT = "hidden sm:inline rounded border border-slate-600 px-1 text-[10px] font-normal leading-none text-slate-400";

function LeagueStepperBar({ session, leagues, selectedLeagueId, onStep, onBackToTodo, onClose }: LeagueStepperBarProps) {
  const total = session.stops.length;
  const at = selectedLeagueId ? session.stops.findIndex((s) => s.leagueId === selectedLeagueId) : -1;
  const prev = getStepIndex(session, selectedLeagueId, -1);
  const next = getStepIndex(session, selectedLeagueId, 1);
  const leagueName = leagues.find((l) => l.league_id === selectedLeagueId)?.name;
  const label = at >= 0
    ? `League ${at + 1} of ${total} needing attention`
    : `Not on the list · ${total} ${total === 1 ? "league" : "leagues"} needing attention`;

  return (
    <nav
      aria-label="Leagues needing attention"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-blue-900/70 bg-slate-900 px-3 py-2"
    >
      <div
        className="min-w-0 basis-full sm:basis-0 sm:flex-1"
        aria-live="polite"
        title="The list as of when you opened this league from To-Do — Back to To-Do shows the current one."
      >
        <div className="truncate text-xs font-semibold text-slate-100">{label}</div>
        {leagueName && <div className="truncate text-[11px] text-slate-400">{leagueName}</div>}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onStep(-1)}
        disabled={prev == null}
        aria-label="Previous league needing attention"
        title="Previous league ( [ )"
      >
        <span aria-hidden="true">‹</span> Prev <kbd className={KEY_HINT}>[</kbd>
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onStep(1)}
        disabled={next == null}
        aria-label="Next league needing attention"
        title={next == null ? "That was the last one" : "Next league ( ] )"}
      >
        Next <kbd className={KEY_HINT}>]</kbd> <span aria-hidden="true">›</span>
      </Button>
      {selectedLeagueId && <SleeperLink leagueId={selectedLeagueId} />}
      <Button variant="ghost" size="sm" onClick={onBackToTodo}>
        Back to To-Do
      </Button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the leagues needing attention bar"
        title="Close — Open in app on To-Do starts it again"
        className="ml-auto rounded-full px-2 py-0.5 text-sm leading-none text-slate-500 transition hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span aria-hidden="true">×</span>
      </button>
    </nav>
  );
}

export default memo(LeagueStepperBar);
