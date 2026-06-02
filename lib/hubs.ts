// ============================================================
// Hub registry — single source of truth for the top-level hubs
// (the in-app "router" targets; the app has one URL and switches
// hubs via the `mainTab` state).
// ============================================================
// Adding a hub: add one entry here. The nav (MainLayout) and the
// content-width logic (HubRouter) both derive from this list, and
// `MainTab` is the union of these ids so a typo in a `mainTab === "…"`
// comparison or a `setMainTab("…")` call fails at compile time
// (previously `mainTab` was a plain string and typos failed silently).
//
// NOTE: HubRouter still renders each hub with its own bespoke props,
// so the render blocks there are not driven from this registry — only
// the nav order/labels and the layout width are.

export interface HubDef {
  /** Stable id stored in `mainTab` state. */
  id: string;
  /** Label shown in the top nav. */
  label: string;
  /** Wide hubs render full-bleed; non-wide hubs are centered (max-w-3xl). */
  wide: boolean;
}

export const HUBS = [
  { id: "DASHBOARD",      label: "Dashboard",      wide: false },
  { id: "LEAGUES",        label: "League Hub",     wide: true  },
  { id: "DATA_HUB",       label: "Data Hub",       wide: false },
  { id: "DRAFT",          label: "Draft Hub",      wide: true  },
  { id: "TRADE_HUB",      label: "Trade Hub",      wide: true  },
  { id: "GAMEDAY_HUB",    label: "Gameday Hub",    wide: true  },
  { id: "ALERTS",         label: "Alert Hub",      wide: true  },
  { id: "MANAGEMENT_HUB", label: "Management Hub", wide: true  },
  { id: "SCOUTING_HUB",   label: "Scouting Hub",   wide: true  },
  { id: "USER_SCOUT",     label: "User Scout",     wide: true  },
] as const satisfies readonly HubDef[];

/** Union of valid hub ids — use this to type `mainTab`. */
export type MainTab = typeof HUBS[number]["id"];

/** True when the hub renders full-bleed (no centered max-width container). */
export function isWideHub(id: string): boolean {
  return HUBS.find((h) => h.id === id)?.wide ?? false;
}
