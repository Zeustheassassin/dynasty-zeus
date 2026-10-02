// The "Role Fit" column group every position's Analysis table carries (and so
// the Compare tab, which reuses the column lists): the headline bucket, a
// match % per bucket, what his usage alone points to, Versatile and
// confidence. Each cell's tooltip says why (ColDef.titleKey).
import type { ColDef } from "./StatsTableShell";
import {
  ROLES, VERSATILE_PCT, confidenceLabel, matchFor, matchTooltip, roleFitTooltip, roleInfo, roleLabel,
  type RoleFit, type RolePos,
} from "../../../lib/scouting/roleFit";

const GROUP = "Role Fit";

export function roleFitCols(pos: RolePos): ColDef[] {
  return [
    {
      key: "role", label: "Role", group: GROUP, width: 110, titleKey: "role_tip",
      tooltip: "Best-case NFL role from his charting plus height and weight. Two roles within 5 points read \"A / B\": equally a candidate for both, the higher-ceiling one first. \"?\" = not proven yet (an X needs 10+ in-app press reps). Hover a cell for why.",
    },
    ...ROLES[pos].map((r): ColDef => ({
      key: `role_${r.key}`, label: `${r.short}%`, group: GROUP, fmt: "pct0", colorDir: 1, width: 64,
      titleKey: `role_${r.key}_tip`, tooltip: `${r.label}: ${r.description} Match %: each role scored on its own, so they don't add to 100.`,
    })),
    {
      key: "role_used", label: "Used as", group: GROUP, width: 80,
      tooltip: "The role his usage alone points to (where he lined up, what he was asked to do). Blank without usage data, e.g. a WR charted only in the import.",
    },
    { key: "role_vers", label: "Vers", group: GROUP, width: 48, tooltip: `Versatile: ${VERSATILE_PCT}%+ in two or more roles.` },
    { key: "role_conf", label: "Conf", group: GROUP, width: 64, titleKey: "role_conf_tip", tooltip: "How much tape the fit rests on." },
  ];
}

/** The row fields roleFitCols reads. All null without a fit (under the floor). */
export function roleFitRow(pos: RolePos, fit: RoleFit | null | undefined): Record<string, number | string | null> {
  const row: Record<string, number | string | null> = {
    role: fit ? roleLabel(fit) : null,
    role_tip: fit ? roleFitTooltip(fit) : "Not enough tape for a role yet",
    role_used: fit?.usedAs ? roleInfo(fit.usedAs).label : null,
    role_vers: fit?.versatile ? "Yes" : null,
    role_conf: fit ? confidenceLabel(fit.confidence) : null,
    role_conf_tip: fit
      ? `${fit.sample.n} ${fit.sample.unit}${fit.skillOnly ? " · skill only: no in-app alignment, so where he lined up doesn't count" : ""}`
      : null,
  };
  for (const r of ROLES[pos]) {
    row[`role_${r.key}`] = fit ? matchFor(fit, r.key)?.pct ?? null : null;
    row[`role_${r.key}_tip`] = fit ? matchTooltip(fit, r.key) : null;
  }
  return row;
}
