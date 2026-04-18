"use client";
import { useState, useCallback } from "react";
import type { RouteType, Alignment, CoverageType } from "../../lib/types";

interface ReconstructedPlay {
  route_type: RouteType;
  alignment: Alignment;
  on_line: boolean;
  coverage: CoverageType;
  was_open: boolean;
  targeted: boolean;
  success: boolean | null;
  contested: boolean;
  yards: number | null;
  play_notes: string;
}

interface GameSummary {
  totalRoutes: number;
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contestedCatches: number;
  routeCounts: Partial<Record<RouteType, number>>;
  routeTimesOpen: Partial<Record<RouteType, number>>;
  alignRight: number;
  alignLeft: number;
  alignSlot: number;
  alignBackfield: number;
  totalSnaps: number;
  behindLOS: number;
  coverageMan: number; coverageManSuccess: number;
  coverageZone: number; coverageZoneSuccess: number;
  coverageDouble: number; coverageDoubleSuccess: number;
  coveragePress: number; coveragePressSuccess: number;
}

export interface SummaryTotals {
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contestedCatches: number;
}

interface Props {
  gameLabel: string;
  onImport: (plays: ReconstructedPlay[], totals: SummaryTotals) => Promise<void>;
  onCancel: () => void;
}

const ROUTE_LABEL_MAP: Record<string, RouteType> = {
  nine: "nine", post: "post", dig: "dig", curl: "curl",
  slant: "slant", screen: "screen", flat: "flat",
  comeback: "comeback", out: "out", corner: "corner", other: "other",
};

const COVERAGE_LABEL_MAP: Record<string, CoverageType> = {
  "vs. man": "man", "man": "man",
  "vs. zone": "zone", "zone": "zone",
  "vs. double cvg": "double", "vs. double": "double", "double": "double",
  "vs. press": "press", "press": "press",
};

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/[^0-9-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseSummary(text: string): GameSummary | null {
  const lines = text.split("\n").map((l) =>
    l.split("\t").map((c) => c.trim())
  );

  const summary: GameSummary = {
    totalRoutes: 0, targets: 0, catches: 0, drops: 0,
    contested: 0, contestedCatches: 0,
    routeCounts: {}, routeTimesOpen: {},
    alignRight: 0, alignLeft: 0, alignSlot: 0, alignBackfield: 0,
    totalSnaps: 0, behindLOS: 0,
    coverageMan: 0, coverageManSuccess: 0,
    coverageZone: 0, coverageZoneSuccess: 0,
    coverageDouble: 0, coverageDoubleSuccess: 0,
    coveragePress: 0, coveragePressSuccess: 0,
  };

  type Section = "none" | "routes" | "depth" | "align" | "coverage";
  let section: Section = "none";

  // Read the cell directly below a label — no lookahead to avoid cross-contamination
  function numBelow(i: number, j: number): number {
    const v = (lines[i + 1]?.[j] ?? "").trim();
    if (!v || v === "—" || v === "-") return 0;
    return parseNum(v);
  }

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i];
    const c0 = (cols[0] ?? "").toLowerCase().trim();

    // Detect section changes — NO continue so we still scan the whole row
    if (c0 === "routes") section = "routes";
    else if (c0 === "depth of wr") section = "depth";
    else if (c0 === "aligned") section = "align";
    else if (c0 === "coverage") section = "coverage";

    // Scan EVERY cell in every row for stats-box labels.
    // These labels appear in right-side columns alongside depth/align data.
    for (let j = 0; j < cols.length; j++) {
      const label = (cols[j] ?? "").toLowerCase().trim();
      if (label === "targets" && summary.targets === 0) {
        const v = numBelow(i, j);
        if (v > 0) summary.targets = v;
      }
      if (label === "catches" && summary.catches === 0) {
        const v = numBelow(i, j);
        if (v > 0) summary.catches = v;
      }
      if (label === "drops" && summary.drops === 0) {
        const v = numBelow(i, j);
        if (v > 0) summary.drops = v;
      }
      // "contested" without "catch" following in same cell
      if (label === "contested" && summary.contested === 0) {
        const v = numBelow(i, j);
        if (v > 0) summary.contested = v;
      }
      if (label === "contested catch" && summary.contestedCatches === 0) {
        const v = numBelow(i, j);
        if (v > 0) summary.contestedCatches = v;
      }
    }

    const isHeader = ["routes", "depth of wr", "aligned", "coverage"].includes(c0);

    // Parse route rows
    if (section === "routes" && !isHeader) {
      const route = ROUTE_LABEL_MAP[c0];
      if (route) {
        const count = parseNum(cols[1]);
        const timesOpen = parseNum(cols[3]);
        if (count > 0) {
          summary.routeCounts[route] = (summary.routeCounts[route] ?? 0) + count;
          summary.routeTimesOpen[route] = (summary.routeTimesOpen[route] ?? 0) + timesOpen;
        }
      }
      if (c0 === "total") summary.totalRoutes = parseNum(cols[1]);
    }

    // Parse depth rows
    if (section === "depth" && !isHeader) {
      if (c0 === "behind los") summary.behindLOS = parseNum(cols[1]);
      if (c0 === "snaps" && summary.totalSnaps === 0) summary.totalSnaps = parseNum(cols[1]);
    }

    // Parse alignment rows
    if (section === "align" && !isHeader) {
      if (c0 === "rwr") summary.alignRight = parseNum(cols[1]);
      if (c0 === "lwr") summary.alignLeft = parseNum(cols[1]);
      if (c0 === "slot") summary.alignSlot = parseNum(cols[1]);
      if (c0 === "backfield") summary.alignBackfield = parseNum(cols[1]);
      if (c0 === "snaps" && summary.totalSnaps === 0) summary.totalSnaps = parseNum(cols[1]);
    }

    // Parse coverage rows
    if (section === "coverage" && !isHeader) {
      const cvgKey = COVERAGE_LABEL_MAP[c0];
      if (cvgKey === "man") { summary.coverageMan = parseNum(cols[1]); summary.coverageManSuccess = parseNum(cols[2]); }
      if (cvgKey === "zone") { summary.coverageZone = parseNum(cols[1]); summary.coverageZoneSuccess = parseNum(cols[2]); }
      if (cvgKey === "double") { summary.coverageDouble = parseNum(cols[1]); summary.coverageDoubleSuccess = parseNum(cols[2]); }
      if (cvgKey === "press") { summary.coveragePress = parseNum(cols[1]); summary.coveragePressSuccess = parseNum(cols[2]); }
    }
  }

  const routeTotal = Object.values(summary.routeCounts).reduce((a, b) => a + (b ?? 0), 0);
  if (routeTotal === 0) return null;
  if (summary.totalRoutes === 0) summary.totalRoutes = routeTotal;

  return summary;
}

function reconstructPlays(s: GameSummary): ReconstructedPlay[] {
  const plays: ReconstructedPlay[] = [];

  // Build flat list of plays by route type
  for (const [rt, count] of Object.entries(s.routeCounts) as [RouteType, number][]) {
    for (let i = 0; i < (count ?? 0); i++) {
      plays.push({
        route_type: rt,
        alignment: "right",
        on_line: true,
        coverage: "",
        was_open: false,
        targeted: false,
        success: null,
        contested: false,
        yards: null,
        play_notes: "",
      });
    }
  }

  const total = plays.length;
  if (total === 0) return plays;

  // Assign coverage sequentially: man, zone, press, double
  const coveragePool: CoverageType[] = [
    ...Array(s.coverageMan).fill("man" as CoverageType),
    ...Array(s.coverageZone).fill("zone" as CoverageType),
    ...Array(s.coveragePress).fill("press" as CoverageType),
    ...Array(s.coverageDouble).fill("double" as CoverageType),
  ];
  // Fill any remainder (rounding diff) with ""
  for (let i = 0; i < total; i++) {
    plays[i].coverage = coveragePool[i] ?? "";
  }

  // Assign alignment proportionally from snap counts
  const snapTotal = s.alignRight + s.alignLeft + s.alignSlot + s.alignBackfield;
  if (snapTotal > 0) {
    const rightCount = Math.round((s.alignRight / snapTotal) * total);
    const leftCount = Math.round((s.alignLeft / snapTotal) * total);
    const slotCount = Math.round((s.alignSlot / snapTotal) * total);
    // remainder goes to backfield
    const alignPool: Alignment[] = [
      ...Array(rightCount).fill("right" as Alignment),
      ...Array(leftCount).fill("left" as Alignment),
      ...Array(slotCount).fill("slot" as Alignment),
      ...Array(Math.max(0, total - rightCount - leftCount - slotCount)).fill("backfield" as Alignment),
    ];
    for (let i = 0; i < total; i++) plays[i].alignment = alignPool[i] ?? "right";
  }

  // Assign on_line proportionally from snap depth data
  if (s.totalSnaps > 0 && s.behindLOS > 0) {
    const offLineCount = Math.max(0, Math.round((s.behindLOS / s.totalSnaps) * total));
    for (let i = 0; i < offLineCount && i < total; i++) plays[i].on_line = false;
  }

  // Assign was_open from route timesOpen (factual from spreadsheet)
  const routePlayIndicesForOpen: Partial<Record<RouteType, number[]>> = {};
  for (let i = 0; i < plays.length; i++) {
    const rt = plays[i].route_type;
    if (!routePlayIndicesForOpen[rt]) routePlayIndicesForOpen[rt] = [];
    routePlayIndicesForOpen[rt]!.push(i);
  }
  for (const [rt, openCount] of Object.entries(s.routeTimesOpen) as [RouteType, number][]) {
    const indices = routePlayIndicesForOpen[rt] ?? [];
    for (let k = 0; k < openCount && k < indices.length; k++) {
      plays[indices[k]].was_open = true;
    }
  }

  return plays;
}

export default function SummaryGameImport({ gameLabel, onImport, onCancel }: Props) {
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  const handleChange = useCallback((val: string) => {
    setText(val);
    if (!val.trim()) { setSummary(null); setParseError(""); return; }
    const parsed = parseSummary(val);
    if (!parsed) { setSummary(null); setParseError("Could not detect summary table format. Make sure you copied the full game summary from your Google Sheet."); }
    else { setSummary(parsed); setParseError(""); }
  }, []);

  async function confirmImport() {
    if (!summary) return;
    const plays = reconstructPlays(summary);
    if (!plays.length) return;
    setImporting(true);
    await onImport(plays, {
      targets: summary.targets,
      catches: summary.catches,
      drops: summary.drops,
      contested: summary.contested,
      contestedCatches: summary.contestedCatches,
    });
    setImporting(false);
    setDone(true);
  }

  if (done && summary) {
    const plays = reconstructPlays(summary);
    return (
      <div className="p-6 bg-gray-900 border border-gray-700 rounded-lg text-center">
        <div className="text-green-400 text-2xl mb-2">✓</div>
        <div className="text-white font-medium mb-1">Imported {plays.length} plays</div>
        <div className="text-gray-400 text-sm mb-4">for {gameLabel}</div>
        <button onClick={onCancel} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition">Done</button>
      </div>
    );
  }

  const plays = summary ? reconstructPlays(summary) : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Summary Import</h3>
          <p className="text-xs text-gray-400">{gameLabel}</p>
        </div>
        <button onClick={onCancel} className="text-gray-500 hover:text-white text-sm px-2">✕ Cancel</button>
      </div>

      {/* Instructions */}
      <div className="p-3 bg-gray-900/80 border border-gray-800 rounded-lg text-xs text-gray-400 space-y-1">
        <div className="text-gray-300 font-medium mb-1">How to import from your Google Sheet:</div>
        <div>1. Open the player tab in your Google Sheet</div>
        <div>2. Select the full game summary table (Routes + Depth + Alignment + Coverage sections)</div>
        <div>3. Copy (Ctrl+C) and paste below</div>
        <div className="text-yellow-400/80 mt-1">Note: plays are reconstructed from totals — aggregate stats will be accurate, individual play order is approximate.</div>
      </div>

      {/* Paste area */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-400">Paste game summary here</label>
          {text && <button onClick={() => { setText(""); setSummary(null); setParseError(""); }} className="text-xs text-gray-600 hover:text-gray-400">Clear</button>}
        </div>
        <textarea
          rows={10}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-xs font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-y"
          placeholder={"Paste the full game summary from Google Sheets (Ctrl+V)…"}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text/plain");
            e.preventDefault();
            handleChange(pasted);
          }}
        />
        {parseError && <div className="mt-1 text-xs text-red-400">{parseError}</div>}
      </div>

      {/* Preview */}
      {summary && (
        <div className="p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs space-y-3">
          <div className="text-gray-300 font-medium">Detected — {plays.length} plays to reconstruct</div>
          <div className="grid grid-cols-3 gap-3">
            {/* Routes */}
            <div>
              <div className="text-gray-500 mb-1">Routes</div>
              {Object.entries(summary.routeCounts).map(([rt, cnt]) => (
                <div key={rt} className="flex justify-between text-gray-400">
                  <span className="capitalize">{rt}</span>
                  <span className="text-white">{cnt}</span>
                </div>
              ))}
              <div className="flex justify-between text-gray-500 border-t border-gray-800 mt-1 pt-1">
                <span>Total</span><span>{summary.totalRoutes}</span>
              </div>
            </div>
            {/* Outcomes */}
            <div>
              <div className="text-gray-500 mb-1">Outcomes</div>
              <div className="flex justify-between text-gray-400"><span>Targets</span><span className="text-yellow-400">{summary.targets}</span></div>
              <div className="flex justify-between text-gray-400"><span>Catches</span><span className="text-green-400">{summary.catches}</span></div>
              <div className="flex justify-between text-gray-400"><span>Drops</span><span className="text-red-400">{summary.drops}</span></div>
              <div className="flex justify-between text-gray-400"><span>Contested</span><span className="text-purple-400">{summary.contested}</span></div>
              <div className="flex justify-between text-gray-400"><span>Cont. Catch</span><span className="text-purple-300">{summary.contestedCatches}</span></div>
            </div>
            {/* Coverage */}
            <div>
              <div className="text-gray-500 mb-1">Coverage</div>
              {summary.coverageMan > 0 && <div className="flex justify-between text-gray-400"><span>Man</span><span>{summary.coverageMan}</span></div>}
              {summary.coverageZone > 0 && <div className="flex justify-between text-gray-400"><span>Zone</span><span>{summary.coverageZone}</span></div>}
              {summary.coveragePress > 0 && <div className="flex justify-between text-gray-400"><span>Press</span><span>{summary.coveragePress}</span></div>}
              {summary.coverageDouble > 0 && <div className="flex justify-between text-gray-400"><span>Double</span><span>{summary.coverageDouble}</span></div>}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={confirmImport}
          disabled={importing || !summary || plays.length === 0}
          className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition"
        >
          {importing ? "Importing…" : summary ? `Import ${plays.length} Plays` : "Paste data above"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition">Cancel</button>
      </div>
    </div>
  );
}
