"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useProspectReport, type OverviewData, type UseProspectReportReturn } from "./useProspectReport";
import { OverviewView, ProductionView, ScorePiecesView } from "./ReportViews";
import { LIGHT_REPORT, ReportThemeProvider } from "./reportTheme";

export type { OverviewData } from "./useProspectReport";

interface Props {
  prospectId: string;
  data: OverviewData;
}

/** The "still loading" line every report tab shows until the hub's data is in. */
export function ReportLoading({ report }: { report: UseProspectReportReturn }) {
  const msg = !report.p ? "Loading…" : "Loading every position's plays for the scores…";
  return <div className="text-slate-500 text-sm text-center py-8">{msg}</div>;
}

/**
 * A prospect's report, page 1 (the Overview tab): the scores up top, then his
 * charting's win / loss calls and PFF's box-score numbers over the charted
 * games, each with where it ranks at his position (ReportViews.tsx). Scores
 * come from the same hook as the Big Board, so the two always agree.
 *
 * Print / PDF prints the report on white: this page, the AE Score piece by
 * piece, and Production, each starting a new sheet. The print copy is
 * rendered straight into <body> (#prospect-print-root); the print styles in
 * globals.css hide everything else on paper.
 */
export default function ProspectOverview({ prospectId, data }: Props) {
  const report = useProspectReport(prospectId, data);
  const [printing, setPrinting] = useState(false);

  // Print once the copy is in the page; drop it when the dialog closes.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  if (!report.p || !report.pos || !report.ready || !report.pages.has(report.p.id)) return <ReportLoading report={report} />;

  const printButton = (
    <button
      type="button"
      onClick={() => setPrinting(true)}
      className="px-3 py-1.5 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[13px] font-medium transition"
    >
      Print / PDF
    </button>
  );

  return (
    <>
      <OverviewView report={report} actions={printButton} />
      {printing && createPortal(
        <div id="prospect-print-root">
          <ReportThemeProvider value={LIGHT_REPORT}>
            <div className="flex flex-col gap-4 bg-white text-slate-900">
              <OverviewView report={report} />
              <div className="break-before-page"><ScorePiecesView report={report} /></div>
              <div className="break-before-page"><ProductionView report={report} /></div>
            </div>
          </ReportThemeProvider>
        </div>,
        document.body,
      )}
    </>
  );
}
