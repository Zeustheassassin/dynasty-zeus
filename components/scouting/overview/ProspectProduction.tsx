"use client";
import { useProspectReport, type OverviewData } from "./useProspectReport";
import { ProductionView } from "./ReportViews";
import { ReportLoading } from "./ProspectOverview";

/** The Production tab: every PFF number over the charted games, with percentile chips. */
export default function ProspectProduction({ prospectId, data }: { prospectId: string; data: OverviewData }) {
  const report = useProspectReport(prospectId, data);
  if (!report.p || !report.pos || !report.ready) return <ReportLoading report={report} />;
  return <ProductionView report={report} />;
}
