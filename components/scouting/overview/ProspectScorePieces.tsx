"use client";
import { useProspectReport, type OverviewData } from "./useProspectReport";
import { ScorePiecesView } from "./ReportViews";
import { ReportLoading } from "./ProspectOverview";

/** The Breakdown tab's first card: how his AE Score adds up, piece by piece. */
export default function ProspectScorePieces({ prospectId, data }: { prospectId: string; data: OverviewData }) {
  const report = useProspectReport(prospectId, data);
  if (!report.p || !report.pos || !report.ready) return <ReportLoading report={report} />;
  return <ScorePiecesView report={report} />;
}
