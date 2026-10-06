"use client";
import type { ReactNode } from "react";
import { ordinal, type OverviewSection, type OverviewStat } from "../../../lib/scouting/overviewStats";
import { useReportTheme } from "./reportTheme";

// The building blocks every report page (Overview, Production, the score
// pieces, the print copy) is drawn with. Colours come from the report theme,
// so the same blocks render dark on screen and light on paper.

export type Ranks = Map<string, Map<string, number>>;

export function fmtStat(s: OverviewStat): string {
  if (s.fmt === "text") return s.text ?? "—";
  if (s.value == null) return "—";
  const v = s.value;
  if (s.fmt === "pct0") return `${Math.round(v)}%`;
  if (s.fmt === "pct1") return `${v.toFixed(1)}%`;
  if (s.fmt === "int") return `${Math.round(v)}`;
  return `${v.toFixed(s.fmt === "dec1" ? 1 : 2)}${s.unit ?? ""}`;
}

/** The report's card (its sections keep themselves whole on paper). */
export function ReportCard({ label, children }: { label: string; children: ReactNode }) {
  const t = useReportTheme();
  return (
    <article className={`rounded-xl border overflow-hidden ${t.card}`} aria-label={label}>
      {children}
    </article>
  );
}

export function Chip({ pct }: { pct: number }) {
  const t = useReportTheme();
  const cls = pct >= 67 ? t.chip.good : pct <= 33 ? t.chip.low : t.chip.mid;
  return (
    <span className={`px-1.5 py-0.5 rounded-full border text-[11px] font-semibold ${cls}`} title={`${ordinal(pct)} percentile`}>
      {ordinal(pct)}
    </span>
  );
}

function Bar({ s, thin }: { s: OverviewStat; thin?: boolean }) {
  const t = useReportTheme();
  if (s.bar == null) return null;
  return (
    <div className={`${thin ? "h-[3px]" : "h-1"} rounded overflow-hidden ${t.track}`}>
      <div className={`h-full ${s.tone === "pff" ? t.fill.pff : t.fill.chart}`} style={{ width: `${s.bar}%` }} />
    </div>
  );
}

export function SectionTitle({ title }: { title: string }) {
  const t = useReportTheme();
  return <h3 className={`text-sm font-semibold tracking-wide uppercase ${t.heading}`}>{title}</h3>;
}

function Tile({ s, pct, size }: { s: OverviewStat; pct: number | undefined; size: "lg" | "md" | "sm" }) {
  const t = useReportTheme();
  const empty = s.value == null && s.fmt !== "text";
  return (
    <div className="min-w-0 flex flex-col gap-1.5" title={s.tooltip}>
      <div className={`text-[11px] font-semibold tracking-wider uppercase ${t.label}`}>
        {s.label}{s.note && <span className="ml-1 normal-case tracking-normal font-normal">{s.note}</span>}
      </div>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className={`${size === "lg" ? t.layout.valueLg : size === "md" ? t.layout.valueMd : t.layout.valueSm} font-bold leading-none tabular-nums ${empty ? t.dim : t.strong}`}>{fmtStat(s)}</span>
        {pct != null && <Chip pct={pct} />}
      </div>
      {s.detail && <div className={`text-xs tabular-nums ${t.muted}`}>{s.detail}</div>}
      <Bar s={s} />
    </div>
  );
}

/** A full-width section of number tiles (or, with no title, a second row of the one above). */
export function MainSection({ section, ranks, id }: { section: OverviewSection; ranks: Ranks; id: string }) {
  const t = useReportTheme();
  const size = section.size === "list" ? "md" : section.size;
  return (
    <section className={`px-6 pb-6 flex flex-col gap-4 break-inside-avoid ${section.title ? `border-t pt-5 ${t.divider}` : "pt-1"}`}>
      {section.title && <SectionTitle title={section.title} />}
      <div className={`grid ${size === "sm" ? "gap-x-6 gap-y-5" : "gap-6"} ${t.layout[size]}`}>
        {section.stats.map((s) => <Tile key={s.key} s={s} size={size} pct={ranks.get(s.key)?.get(id)} />)}
      </div>
    </section>
  );
}

/** A narrow section in the bottom band: label-and-number rows, or one big tile. */
export function ColumnSection({ section, ranks, id }: { section: OverviewSection; ranks: Ranks; id: string }) {
  const t = useReportTheme();
  return (
    <section className={`px-6 pt-5 pb-6 flex flex-col gap-3.5 break-inside-avoid [&:not(:last-child)]:border-r ${t.divider}`}>
      {section.title && <SectionTitle title={section.title} />}
      {section.size === "list"
        ? section.stats.map((s) => {
          const pct = ranks.get(s.key)?.get(id);
          return (
            <div key={s.key} className="flex flex-col gap-1" title={s.tooltip}>
              <div className="flex justify-between items-baseline gap-3">
                <span className={`text-sm font-medium ${t.body}`}>{s.label}</span>
                <span className="flex items-baseline gap-2">
                  {pct != null && <Chip pct={pct} />}
                  <span className={`text-lg font-bold tabular-nums ${s.value == null && s.fmt !== "text" ? t.dim : t.strong}`}>{fmtStat(s)}</span>
                </span>
              </div>
              {s.detail && <div className={`text-right text-xs tabular-nums ${t.muted}`}>{s.detail}</div>}
              <Bar s={s} thin />
            </div>
          );
        })
        : section.stats.map((s) => <Tile key={s.key} s={s} size="lg" pct={ranks.get(s.key)?.get(id)} />)}
    </section>
  );
}

/** A score in the strip at the top of the Overview page. */
export function ScoreTile({ label, value, tone, lines, title, primary }: {
  label: string; value: string; tone: "pos" | "neg" | "plain" | "dim"; lines: string[]; title?: string; primary?: boolean;
}) {
  const t = useReportTheme();
  const valueCls = tone === "pos" ? t.pos : tone === "neg" ? t.neg : tone === "dim" ? t.dim : t.strong;
  return (
    <div className={`p-4 rounded-lg border flex flex-col gap-1 ${primary ? t.tilePrimary : t.tile}`} title={title}>
      <div className={`text-[11px] font-semibold tracking-wider ${primary ? t.tilePrimaryLabel : t.label}`}>{label}</div>
      <div className={`${primary ? t.layout.valuePrimary : t.layout.valueScore} font-bold leading-none tabular-nums ${valueCls}`}>{value}</div>
      {lines.map((l, i) => (
        <div key={i} className={`text-xs ${i === 0 && primary ? t.body : t.muted}`}>{l}</div>
      ))}
    </div>
  );
}

/** The chip legend at the foot of a page. */
export function ChipLegend({ show, pos }: { show: boolean; pos: string }) {
  const t = useReportTheme();
  return (
    <div className={`border-t px-6 py-3 text-xs ${t.divider} ${t.muted}`}>
      {show
        ? `Chips: percentile among all ${pos} prospects with enough of a sample.`
        : `Percentile chips appear once 10 ${pos}s have enough of a sample.`}
    </div>
  );
}
