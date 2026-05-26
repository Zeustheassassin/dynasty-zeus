"use client";

interface Props {
  totalPlays: number;
  notes: string[];
}

export default function PlayerNotesList({ totalPlays, notes }: Props) {
  return (
    <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
      <div className="text-sm font-semibold text-gray-200 mb-3">
        Play Notes
        <span className="ml-2 text-xs font-normal text-gray-500">
          {notes.length} {notes.length === 1 ? "note" : "notes"} across {totalPlays} {totalPlays === 1 ? "play" : "plays"}
        </span>
      </div>
      {notes.length === 0 ? (
        <p className="text-xs text-gray-600">No play notes recorded yet.</p>
      ) : (
        <ol className="space-y-1.5 list-decimal list-inside text-sm text-gray-300">
          {notes.map((note, i) => (
            <li key={i} className="leading-relaxed">{note}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
