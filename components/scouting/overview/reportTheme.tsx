"use client";
import { createContext, useContext } from "react";

/**
 * The prospect report's colours. On screen the report follows the app's dark
 * slate look; the Print / PDF copy renders the same components in LIGHT, a
 * white page like Reception Perception's report.
 */
export interface ReportTheme {
  card: string;
  divider: string;
  title: string;
  heading: string;
  label: string;
  strong: string;
  body: string;
  muted: string;
  dim: string;
  track: string;
  fill: { chart: string; pff: string };
  chip: { good: string; mid: string; low: string };
  pos: string;
  neg: string;
  tile: string;
  tilePrimary: string;
  tilePrimaryLabel: string;
  pill: { role: string; grade: string; round: string };
  rowRule: string;
  /** Grids and number sizes: auto-fit on screen, denser on paper. */
  layout: {
    strip: string; lg: string; md: string; sm: string; band: string;
    valueLg: string; valueMd: string; valueSm: string; valuePrimary: string; valueScore: string;
  };
}

export const DARK_REPORT: ReportTheme = {
  card: "border-slate-800 bg-slate-900",
  divider: "border-slate-800",
  title: "text-slate-50",
  heading: "text-slate-200",
  label: "text-slate-400",
  strong: "text-slate-50",
  body: "text-slate-200",
  muted: "text-slate-400",
  dim: "text-slate-500",
  track: "bg-slate-800",
  fill: { chart: "bg-blue-400", pff: "bg-violet-400" },
  chip: {
    good: "border-emerald-800 bg-emerald-950 text-emerald-300",
    mid: "border-slate-700 bg-slate-800 text-slate-300",
    low: "border-red-900 bg-red-950 text-red-300",
  },
  pos: "text-emerald-400",
  neg: "text-red-400",
  tile: "border-slate-800 bg-slate-950/40",
  tilePrimary: "border-blue-800 bg-blue-950/30",
  tilePrimaryLabel: "text-blue-300",
  pill: {
    role: "border-blue-900 bg-blue-950 text-blue-300",
    grade: "border-slate-700 bg-slate-800 text-slate-300",
    round: "border-yellow-900 bg-yellow-950 text-yellow-300",
  },
  rowRule: "border-slate-800/70",
  layout: {
    strip: "grid-cols-[repeat(auto-fit,minmax(170px,1fr))]",
    lg: "grid-cols-[repeat(auto-fit,minmax(200px,1fr))]",
    md: "grid-cols-[repeat(auto-fit,minmax(160px,1fr))]",
    sm: "grid-cols-[repeat(auto-fit,minmax(130px,1fr))]",
    band: "grid-cols-[repeat(auto-fit,minmax(260px,1fr))]",
    valueLg: "text-4xl", valueMd: "text-3xl", valueSm: "text-xl", valuePrimary: "text-[44px]", valueScore: "text-3xl",
  },
};

export const LIGHT_REPORT: ReportTheme = {
  card: "border-slate-300 bg-white",
  divider: "border-slate-200",
  title: "text-slate-900",
  heading: "text-slate-800",
  label: "text-slate-600",
  strong: "text-slate-900",
  body: "text-slate-800",
  muted: "text-slate-600",
  dim: "text-slate-400",
  track: "bg-slate-200",
  fill: { chart: "bg-emerald-800", pff: "bg-violet-700" },
  chip: {
    good: "border-emerald-300 bg-emerald-50 text-emerald-800",
    mid: "border-slate-300 bg-slate-100 text-slate-700",
    low: "border-red-300 bg-red-50 text-red-800",
  },
  pos: "text-emerald-700",
  neg: "text-red-700",
  tile: "border-slate-200 bg-slate-50",
  tilePrimary: "border-emerald-700 bg-emerald-50",
  tilePrimaryLabel: "text-emerald-800",
  pill: {
    role: "border-slate-300 bg-slate-100 text-slate-800",
    grade: "border-slate-300 bg-slate-100 text-slate-800",
    round: "border-amber-300 bg-amber-50 text-amber-800",
  },
  rowRule: "border-slate-200",
  // A Letter / A4 sheet is ~720 px wide: four big tiles, six mid ones, five
  // scores and the three-column band to a row, so page 1 reads like the screen.
  layout: {
    strip: "grid-cols-[repeat(auto-fit,minmax(115px,1fr))]",
    lg: "grid-cols-[repeat(auto-fit,minmax(150px,1fr))]",
    md: "grid-cols-[repeat(auto-fit,minmax(105px,1fr))]",
    sm: "grid-cols-[repeat(auto-fit,minmax(100px,1fr))]",
    band: "grid-cols-[repeat(auto-fit,minmax(200px,1fr))]",
    valueLg: "text-3xl", valueMd: "text-2xl", valueSm: "text-lg", valuePrimary: "text-4xl", valueScore: "text-2xl",
  },
};

const ReportThemeContext = createContext<ReportTheme>(DARK_REPORT);
export const ReportThemeProvider = ReportThemeContext.Provider;
export const useReportTheme = (): ReportTheme => useContext(ReportThemeContext);
