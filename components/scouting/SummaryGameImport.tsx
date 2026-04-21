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
  no_route_run: boolean;
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
  type CovKey = "man" | "zone" | "press" | "double";
  const COV_KEYS: CovKey[] = ["man", "zone", "press", "double"];

  const covCount: Record<CovKey, number> = {
    man: s.coverageMan, zone: s.coverageZone,
    press: s.coveragePress, double: s.coverageDouble,
  };
  const covOpen: Record<CovKey, number> = {
    man: s.coverageManSuccess, zone: s.coverageZoneSuccess,
    press: s.coveragePressSuccess, double: s.coverageDoubleSuccess,
  };
  const totalCovRoutes = COV_KEYS.reduce((a, k) => a + covCount[k], 0);

  const routeEntries = Object.entries(s.routeCounts) as [RouteType, number][];

  // Step 1: Compute cell_count[rt][cov] — distribute each route type's plays
  //         across coverages proportionally to the coverage route counts.
  //         Use floor + largest-remainder to guarantee sum == count exactly.
  const cellCount: Partial<Record<RouteType, Record<CovKey, number>>> = {};
  for (const [rt, count] of routeEntries) {
    cellCount[rt] = { man: 0, zone: 0, press: 0, double: 0 };
    const fracs1: Record<CovKey, number> = { man: 0, zone: 0, press: 0, double: 0 };
    let used = 0;
    for (const cov of COV_KEYS) {
      const exact = totalCovRoutes > 0 ? count * covCount[cov] / totalCovRoutes : 0;
      cellCount[rt]![cov] = Math.floor(exact);
      fracs1[cov] = exact - Math.floor(exact);
      used += cellCount[rt]![cov];
    }
    let rem1 = count - used;
    for (const cov of ([...COV_KEYS].sort((a, b) => fracs1[b] - fracs1[a]))) {
      if (rem1 <= 0) break;
      cellCount[rt]![cov]++;
      rem1--;
    }
  }

  // Step 2: Solve the transportation problem for cell_open[rt][cov].
  //   Supply[rt] = routeTimesOpen[rt]  (must satisfy route-breakdown open counts)
  //   Demand[cov] = covOpen[cov]        (must satisfy coverage-breakdown open counts)
  //   Capacity[rt][cov] = cellCount[rt][cov]
  //
  //   Greedy: process route types sorted by open-rate desc (most constrained first),
  //   within each row distribute to coverages proportional to remaining demand,
  //   capped by capacity.
  const supply: Partial<Record<RouteType, number>> = {};
  for (const [rt] of routeEntries) supply[rt] = s.routeTimesOpen[rt] ?? 0;
  const demand: Record<CovKey, number> = { ...covOpen };

  const cellOpen: Partial<Record<RouteType, Record<CovKey, number>>> = {};
  for (const [rt] of routeEntries) cellOpen[rt] = { man: 0, zone: 0, press: 0, double: 0 };

  // Sort routes by open rate descending so high-open-rate routes get served first
  const sortedRts = [...routeEntries].sort(([rt1, n1], [rt2, n2]) => {
    const r1 = n1 > 0 ? (supply[rt1] ?? 0) / n1 : 0;
    const r2 = n2 > 0 ? (supply[rt2] ?? 0) / n2 : 0;
    return r2 - r1;
  });

  for (const [rt] of sortedRts) {
    const rem = supply[rt] ?? 0;
    if (rem <= 0) continue;

    // Two passes: first allocate proportional to remaining demand, then fill leftovers
    const totalDem = COV_KEYS.reduce((a, k) => a + demand[k], 0);

    // Pass 1: floor-based proportional allocation — guarantees allocTotal <= rem
    const allocs: Record<CovKey, number> = { man: 0, zone: 0, press: 0, double: 0 };
    const fracs2: Record<CovKey, number> = { man: 0, zone: 0, press: 0, double: 0 };
    if (totalDem > 0) {
      for (const cov of COV_KEYS) {
        const exact = Math.min(rem * demand[cov] / totalDem, cellCount[rt]![cov], demand[cov]);
        allocs[cov] = Math.floor(exact);
        fracs2[cov] = exact - Math.floor(exact);
      }
    }

    // Pass 2: distribute remainder via largest-remainder — fills exactly rem if capacity allows
    const allocTotal = COV_KEYS.reduce((a, k) => a + allocs[k], 0);
    let allocRem = rem - allocTotal;
    for (const cov of ([...COV_KEYS].sort((a, b) => fracs2[b] - fracs2[a]))) {
      if (allocRem <= 0) break;
      const canAdd = Math.min(cellCount[rt]![cov] - allocs[cov], demand[cov] - allocs[cov]);
      if (canAdd > 0) {
        const add = Math.min(canAdd, allocRem);
        allocs[cov] += add;
        allocRem -= add;
      }
    }

    for (const cov of COV_KEYS) {
      cellOpen[rt]![cov] = allocs[cov];
      demand[cov] = Math.max(0, demand[cov] - allocs[cov]);
    }
  }

  // Step 3: Build route plays directly from cells — open plays first, then not-open.
  //         This means coverage and was_open are set correctly by construction.
  const routePlays: ReconstructedPlay[] = [];
  for (const [rt, count] of routeEntries) {
    for (const cov of COV_KEYS) {
      const total = cellCount[rt]![cov];
      const open  = Math.min(cellOpen[rt]![cov], total);
      for (let i = 0; i < open;  i++) routePlays.push({ route_type: rt, alignment: "right", on_line: true, coverage: cov, was_open: true,  targeted: false, success: null, contested: false, yards: null, play_notes: "", no_route_run: false });
      for (let i = open; i < total; i++) routePlays.push({ route_type: rt, alignment: "right", on_line: true, coverage: cov, was_open: false, targeted: false, success: null, contested: false, yards: null, play_notes: "", no_route_run: false });
    }
    // Plays that didn't get a coverage slot (only happens if totalCovRoutes < totalRoutes)
    const covAssigned = COV_KEYS.reduce((a, k) => a + (cellCount[rt]![k] ?? 0), 0);
    for (let i = covAssigned; i < count; i++) routePlays.push({ route_type: rt, alignment: "right", on_line: true, coverage: "", was_open: false, targeted: false, success: null, contested: false, yards: null, play_notes: "", no_route_run: false });
  }

  // NRR plays (alignment-only snaps)
  const nrrCount = Math.max(0, s.totalSnaps - routePlays.length);
  const nrrPlays: ReconstructedPlay[] = Array.from({ length: nrrCount }, () => ({
    route_type: "other" as RouteType, alignment: "right" as Alignment, on_line: true,
    coverage: "" as CoverageType, was_open: false, targeted: false,
    success: null, contested: false, yards: null, play_notes: "",
    no_route_run: true,
  }));

  const allPlays = [...routePlays, ...nrrPlays];
  const totalSnaps = allPlays.length;
  if (totalSnaps === 0) return allPlays;

  // Assign alignment across ALL snaps proportionally
  const snapTotal = s.alignRight + s.alignLeft + s.alignSlot + s.alignBackfield;
  if (snapTotal > 0) {
    const rightCount = Math.round((s.alignRight / snapTotal) * totalSnaps);
    const leftCount  = Math.round((s.alignLeft  / snapTotal) * totalSnaps);
    const slotCount  = Math.round((s.alignSlot  / snapTotal) * totalSnaps);
    const alignPool: Alignment[] = [
      ...Array(rightCount).fill("right" as Alignment),
      ...Array(leftCount).fill("left"  as Alignment),
      ...Array(slotCount).fill("slot"  as Alignment),
      ...Array(Math.max(0, totalSnaps - rightCount - leftCount - slotCount)).fill("backfield" as Alignment),
    ];
    for (let i = 0; i < totalSnaps; i++) allPlays[i].alignment = alignPool[i] ?? "right";
  }

  // Assign on_line proportionally from depth data
  if (s.totalSnaps > 0 && s.behindLOS > 0) {
    const offLineCount = Math.max(0, Math.round((s.behindLOS / s.totalSnaps) * totalSnaps));
    for (let i = 0; i < offLineCount && i < totalSnaps; i++) allPlays[i].on_line = false;
  }

  return allPlays;
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
    const routeCount = plays.filter((p) => !p.no_route_run).length;
    const snapCount = plays.length;
    return (
      <div className="p-6 bg-gray-900 border border-gray-700 rounded-lg text-center">
        <div className="text-green-400 text-2xl mb-2">✓</div>
        <div className="text-white font-medium mb-1">{snapCount} snaps imported ({routeCount} routes · {snapCount - routeCount} alignment-only)</div>
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
          <div className="text-gray-300 font-medium">
            Detected — {plays.length} snaps total
            ({plays.filter((p) => !p.no_route_run).length} routes · <span className="text-amber-400">{plays.filter((p) => p.no_route_run).length} alignment-only</span>)
          </div>
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
          {importing ? "Importing…" : summary ? `Import ${plays.length} Snaps (${plays.filter((p) => !p.no_route_run).length} routes)` : "Paste data above"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition">Cancel</button>
      </div>
    </div>
  );
}
