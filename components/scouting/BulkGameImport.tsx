"use client";
import { useState, useCallback } from "react";
import type { RouteType, Alignment } from "../../lib/types";

interface ParsedPlay {
  route_type: RouteType;
  alignment: Alignment;
  on_line: boolean;
  targeted: boolean;
  success: boolean | null;
  yards: number | null;
  play_notes: string;
  no_route_run: boolean;
  valid: boolean;
  raw: string;
  error?: string;
}

interface Props {
  gameLabel: string;
  onImport: (plays: Omit<ParsedPlay, "valid" | "raw" | "error">[]) => Promise<void>;
  onCancel: () => void;
}

// Route keywords that mean "aligned on field but no route run" (run play, blocking snap, etc.)
const NRR_KEYWORDS = new Set(["nrr", "aligned", "align", "snap", "noroute", "no route", "no_route", "block", "blk", "run"]);

const ROUTE_MAP: Record<string, RouteType> = {
  nine: "nine", "9": "nine", go: "nine", fly: "nine", streak: "nine",
  post: "post", p: "post",
  dig: "dig", d: "dig",
  curl: "curl",
  slant: "slant", sl: "slant",
  screen: "screen", scr: "screen", sc: "screen",
  flat: "flat", fl: "flat",
  comeback: "comeback", cb: "comeback", com: "comeback",
  out: "out", o: "out",
  corner: "corner", cor: "corner", crn: "corner",
  other: "other", oth: "other",
};

const ALIGN_MAP: Record<string, Alignment> = {
  l: "left", left: "left",
  r: "right", right: "right",
  s: "slot", slot: "slot",
  b: "backfield", backfield: "backfield", bf: "backfield", back: "backfield",
};

function parseBool(v: string): boolean {
  return ["y", "yes", "true", "1", "x", "✓", "catch", "caught", "c"].includes(v.toLowerCase().trim());
}

function parsePlay(row: string[]): ParsedPlay {
  const raw = row.join("\t");
  if (row.length < 2) return { route_type: "other", alignment: "right", on_line: true, targeted: false, success: null, yards: null, play_notes: "", no_route_run: false, valid: false, raw, error: "Too few columns" };

  const col = (i: number) => (row[i] ?? "").trim();

  // Column order: Route | Alignment | On Line | Targeted | Success | Yards | Notes
  const routeRaw = col(0).toLowerCase().replace(/\s+/g, " ").trim();
  const no_route_run = NRR_KEYWORDS.has(routeRaw);

  if (no_route_run) {
    const alignRaw = col(1).toLowerCase();
    const alignment: Alignment = ALIGN_MAP[alignRaw] ?? "right";
    const alignValid = !!ALIGN_MAP[alignRaw];
    const on_line = col(2) === "" ? true : parseBool(col(2));
    const play_notes = col(3) ?? "";
    const error = !alignValid ? `Unknown alignment "${col(1)}"` : undefined;
    return { route_type: "other", alignment, on_line, targeted: false, success: null, yards: null, play_notes, no_route_run: true, valid: !error, raw, error };
  }

  const route_type: RouteType = ROUTE_MAP[routeRaw] ?? "other";
  const routeValid = !!ROUTE_MAP[routeRaw];

  const alignRaw = col(1).toLowerCase();
  const alignment: Alignment = ALIGN_MAP[alignRaw] ?? "right";
  const alignValid = !!ALIGN_MAP[alignRaw];

  const on_line = col(2) === "" ? true : parseBool(col(2));
  const targeted = col(3) === "" ? false : parseBool(col(3));
  const successRaw = col(4);
  const success = targeted ? (successRaw === "" ? null : parseBool(successRaw)) : null;
  const yardsRaw = col(5);
  const yards = yardsRaw && !isNaN(parseInt(yardsRaw, 10)) ? parseInt(yardsRaw, 10) : null;
  const play_notes = col(6) ?? "";

  const error = !routeValid ? `Unknown route "${col(0)}"` : !alignValid ? `Unknown alignment "${col(1)}"` : undefined;

  return { route_type, alignment, on_line, targeted, success, yards, play_notes, no_route_run: false, valid: !error, raw, error };
}

function parseInput(text: string): ParsedPlay[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const plays: ParsedPlay[] = [];
  for (const line of lines) {
    // Support tab-separated (from Google Sheets) or comma-separated
    const cols = line.includes("\t") ? line.split("\t") : line.split(",");
    // Skip header rows
    const first = cols[0]?.trim().toLowerCase() ?? "";
    if (["route", "route type", "type", "#"].includes(first)) continue;
    plays.push(parsePlay(cols));
  }
  return plays;
}

const EXAMPLE = `curl\tR\tY\tY\tY\t12
nrr\tL\tY\t\t\t\tRun play aligned left
dig\tS\tN\tN
post\tL\tY\tY\tN
nrr\tR\tN\t\t\t\tBlocking snap
slant\tR\tY\tY\tY\t8\tGood separation`;

export default function BulkGameImport({ gameLabel, onImport, onCancel }: Props) {
  const [text, setText] = useState("");
  const [plays, setPlays] = useState<ParsedPlay[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  const handleChange = useCallback((val: string) => {
    setText(val);
    setPlays(val.trim() ? parseInput(val) : []);
  }, []);

  async function confirmImport() {
    const valid = plays.filter((p) => p.valid);
    if (!valid.length) return;
    setImporting(true);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await onImport(valid.map(({ valid: _v, raw: _r, error: _e, ...rest }) => rest));
    setImporting(false);
    setDone(true);
  }

  const validCount = plays.filter((p) => p.valid).length;
  const invalidCount = plays.length - validCount;

  if (done) {
    return (
      <div className="p-6 bg-gray-900 border border-gray-700 rounded-lg text-center">
        <div className="text-green-400 text-2xl mb-2">✓</div>
        <div className="text-white font-medium mb-1">Imported {validCount} plays</div>
        <div className="text-gray-400 text-sm mb-4">for {gameLabel}</div>
        <button onClick={onCancel} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Bulk Import Plays</h3>
          <p className="text-xs text-gray-400">{gameLabel}</p>
        </div>
        <button onClick={onCancel} className="text-gray-500 hover:text-white text-sm px-2">✕ Cancel</button>
      </div>

      {/* Format guide */}
      <div className="p-3 bg-gray-900/80 border border-gray-800 rounded-lg text-xs">
        <div className="text-gray-400 font-medium mb-2">
          Column order — copy directly from your Google Sheet template:
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2 text-center">
          {["Route", "Alignment", "On Line?", "Targeted?", "Success?", "Yards", "Notes"].map((h, i) => (
            <div key={h} className={`px-1 py-0.5 rounded text-xs font-medium ${i < 4 ? "bg-blue-900/50 text-blue-300" : i === 4 ? "bg-green-900/50 text-green-300" : "bg-gray-800 text-gray-400"}`}>
              {h}
            </div>
          ))}
        </div>
        <div className="text-gray-500 space-y-0.5">
          <div><span className="text-gray-300">Route:</span> curl, dig, post, corner, go, screen, slant, out, flat, comeback, other — or use <span className="text-amber-300 font-medium">nrr</span> / aligned / snap / run / block for alignment-only snaps (no route run)</div>
          <div><span className="text-gray-300">Alignment:</span> L / R / S / B (or Left / Right / Slot / Backfield)</div>
          <div><span className="text-gray-300">Booleans:</span> Y or N &nbsp;·&nbsp; Leave Success blank if not targeted &nbsp;·&nbsp; For NRR rows columns 4–7 are ignored</div>
        </div>
        <div className="mt-2 text-gray-600">Example (tab-separated, same as Google Sheets copy):</div>
        <pre className="mt-1 text-gray-500 font-mono text-xs overflow-x-auto whitespace-pre">{EXAMPLE}</pre>
      </div>

      {/* Paste area */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-400">Paste your sheet data here</label>
          {text && (
            <button onClick={() => { setText(""); setPlays([]); }} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>
          )}
        </div>
        <textarea
          rows={10}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-xs font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-y"
          placeholder={"Paste from Google Sheets (Ctrl+V)…\n\ncurl\tR\tY\tY\tY\t12\ndig\tS\tN\tN"}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onPaste={(e) => {
            // Use clipboardData directly for reliable TSV from Google Sheets
            const pasted = e.clipboardData.getData("text/plain");
            e.preventDefault();
            handleChange(pasted);
          }}
        />
      </div>

      {/* Preview */}
      {plays.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs text-gray-400">{plays.length} rows parsed</span>
            {validCount > 0 && <span className="text-xs text-green-400">✓ {validCount} valid</span>}
            {plays.filter((p) => p.valid && p.no_route_run).length > 0 && (
              <span className="text-xs text-amber-400">{plays.filter((p) => p.valid && p.no_route_run).length} aligned snaps</span>
            )}
            {invalidCount > 0 && <span className="text-xs text-red-400">✗ {invalidCount} with errors</span>}
          </div>
          <div className="max-h-56 overflow-y-auto border border-gray-800 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-950">
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="px-2 py-1 text-left w-6">#</th>
                  <th className="px-2 py-1 text-left">Route</th>
                  <th className="px-2 py-1 text-left">Align</th>
                  <th className="px-2 py-1 text-left">Line</th>
                  <th className="px-2 py-1 text-left">Tgt</th>
                  <th className="px-2 py-1 text-left">Result</th>
                  <th className="px-2 py-1 text-left">Yds</th>
                  <th className="px-2 py-1 text-left">Note</th>
                  <th className="px-2 py-1 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900">
                {plays.map((pl, i) => (
                  <tr key={pl.raw} className={pl.valid ? "bg-gray-950" : "bg-red-950/30"}>
                    <td className="px-2 py-1 text-gray-600">{i + 1}</td>
                    <td className="px-2 py-1">
                      {pl.no_route_run
                        ? <span className="text-amber-400 font-medium">aligned</span>
                        : <span className="text-white capitalize">{pl.route_type}</span>}
                    </td>
                    <td className="px-2 py-1 text-gray-300 capitalize">{pl.alignment[0].toUpperCase()}</td>
                    <td className="px-2 py-1 text-gray-400">{pl.on_line ? "On" : "Off"}</td>
                    <td className="px-2 py-1">{pl.targeted ? <span className="text-yellow-400">Y</span> : <span className="text-gray-600">N</span>}</td>
                    <td className="px-2 py-1">
                      {pl.targeted
                        ? pl.success === true ? <span className="text-green-400">✓</span>
                          : pl.success === false ? <span className="text-red-400">✗</span>
                          : <span className="text-gray-600">—</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-2 py-1 text-gray-300">{pl.yards ?? "—"}</td>
                    <td className="px-2 py-1 text-gray-500 max-w-24 truncate">{pl.play_notes || "—"}</td>
                    <td className="px-2 py-1">
                      {pl.valid
                        ? <span className="text-green-400">✓</span>
                        : <span className="text-red-400 truncate" title={pl.error}>✗ {pl.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={confirmImport}
          disabled={importing || validCount === 0}
          className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition"
        >
          {importing ? "Importing…" : `Import ${validCount} Play${validCount !== 1 ? "s" : ""}`}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition">
          Cancel
        </button>
        {invalidCount > 0 && validCount > 0 && (
          <span className="text-xs text-gray-500 self-center">Invalid rows will be skipped</span>
        )}
      </div>
    </div>
  );
}
