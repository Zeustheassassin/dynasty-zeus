"use client";
import { useState } from "react";
import type { RouteType } from "../../../../lib/types";
import { defaultRouteVariant, routeVariantMissing, type RouteVariant } from "../../../../lib/scouting/routeVariants";

export interface UseRouteVariantReturn {
  /** The sub-route on screen: the play being edited, or the next route to log. */
  value: RouteVariant | null;
  /** Editing a route charted before sub-routes, still on its own route: it may stay blank. */
  legacy: boolean;
  set: (variant: RouteVariant) => void;
  /** A route button was picked: a new route starts on its default (Other on none). */
  pickRoute: (next: RouteType | null, current: RouteType | null) => void;
  /** After a log, or to leave an edit: the route's default. */
  reset: (route: RouteType | null) => void;
  startEdit: (variant: RouteVariant | null | undefined) => void;
  /** Still to pick (blocks Log Play / Save Edit). */
  missing: (route: RouteType | null) => boolean;
}

/**
 * Sub-route state for the WR, TE and QB boards (lib/scouting/routeVariants.ts).
 * `initialRoute` = the route the board starts on.
 */
export function useRouteVariant(initialRoute: RouteType | null): UseRouteVariantReturn {
  const [value, setValue] = useState<RouteVariant | null>(() => defaultRouteVariant(initialRoute));
  const [legacy, setLegacy] = useState(false);

  return {
    value,
    legacy,
    set(variant) {
      setValue(variant);
    },
    pickRoute(next, current) {
      // Picking the route already on keeps the sub-route picked under it.
      if (next === current) return;
      setValue(defaultRouteVariant(next));
      setLegacy(false);
    },
    reset(route) {
      setValue(defaultRouteVariant(route));
      setLegacy(false);
    },
    startEdit(variant) {
      setValue(variant ?? null);
      setLegacy(variant == null);
    },
    missing(route) {
      return routeVariantMissing(route, value, legacy);
    },
  };
}
