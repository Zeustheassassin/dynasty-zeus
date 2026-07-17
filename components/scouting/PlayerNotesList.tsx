"use client";

interface Props {
  totalPlays: number;
  notes: string[];
}

export default function PlayerNotesList({ totalPlays, notes }: Props) {
  return (
    <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
      <div className="text-sm font-semibold text-slate-200 mb-3">
        Play Notes
        <span className="ml-2 text-xs font-normal text-slate-500">
          {notes.length} {notes.length === 1 ? "note" : "notes"} across {totalPlays} {totalPlays === 1 ? "play" : "plays"}
        </span>
      </div>
      {notes.length === 0 ? (
        <p className="text-xs text-slate-600">No play notes recorded yet.</p>
      ) : (
        <ol className="space-y-1.5 list-decimal list-inside text-sm text-slate-300">
          {notes.map((note, i) => (
            <li key={i} className="leading-relaxed">{note}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
