// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FeedTab from "@/components/AlertsPage/FeedTab";
import type { DashboardAlert } from "@/components/AlertsPage/alertsPageHelpers";

// This project doesn't set `test.globals: true` in vitest.config.mts, so
// @testing-library/react's automatic afterEach cleanup never registers —
// without this, each render() in this file would stack up in document.body
// instead of being torn down between tests.
afterEach(cleanup);

function mkAlert(id: string, title: string): DashboardAlert {
  return {
    id,
    category: "watchlist",
    source: "internal",
    severity: "low",
    title,
    detail: "",
    actionable: true,
    dismissed: false,
    playerId: null,
    leagueId: null,
    link: null,
    payload: {},
    timestamp: Date.now(),
  } as DashboardAlert;
}

describe("FeedTab — Dismiss all operates on exactly what's rendered", () => {
  it("when actionableAlerts is a narrower subset, Dismiss all only dismisses the rendered (actionable) alerts, not the full unfiltered list", () => {
    const all = [mkAlert("a1", "A1"), mkAlert("a2", "A2"), mkAlert("hidden1", "Hidden 1")];
    const actionable = [mkAlert("a1", "A1"), mkAlert("a2", "A2")]; // "hidden1" is filtered out, never shown
    const onDismissAlert = vi.fn();

    render(<FeedTab alerts={all} actionableAlerts={actionable} onDismissAlert={onDismissAlert} />);

    // The non-actionable alert must not be on screen at all.
    expect(screen.queryByText("Hidden 1")).toBeNull();

    fireEvent.click(screen.getByText("Dismiss all"));

    // Only the two VISIBLE alerts get dismissed — "hidden1" (never shown to
    // the user) must not be silently discarded.
    expect(onDismissAlert).toHaveBeenCalledTimes(2);
    expect(onDismissAlert).toHaveBeenCalledWith("a1");
    expect(onDismissAlert).toHaveBeenCalledWith("a2");
    expect(onDismissAlert).not.toHaveBeenCalledWith("hidden1");
  });

  it("falls back to the full alerts list when there are no actionable alerts", () => {
    const all = [mkAlert("a1", "A1"), mkAlert("a2", "A2")];
    const onDismissAlert = vi.fn();

    render(<FeedTab alerts={all} actionableAlerts={[]} onDismissAlert={onDismissAlert} />);

    expect(screen.getByText("A1")).toBeTruthy();
    fireEvent.click(screen.getByText("Dismiss all"));
    expect(onDismissAlert).toHaveBeenCalledTimes(2);
  });

  it("hides Dismiss all when only a single alert is visible, matching the visible (not full) count", () => {
    const all = [mkAlert("a1", "A1"), mkAlert("hidden1", "Hidden 1")];
    const actionable = [mkAlert("a1", "A1")]; // only 1 visible, even though `all` has 2

    render(<FeedTab alerts={all} actionableAlerts={actionable} onDismissAlert={vi.fn()} />);

    expect(screen.queryByText("Dismiss all")).toBeNull();
  });
});
