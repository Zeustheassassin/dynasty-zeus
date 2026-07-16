// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHubRouting } from "@/app/hooks/useHubRouting";

function setUrl(search: string) {
  window.history.replaceState(null, "", search ? `/?${search}` : "/");
}

beforeEach(() => {
  localStorage.clear();
  setUrl("");
});

describe("useHubRouting", () => {
  it("defaults to DASHBOARD with no URL or localStorage state", () => {
    const { result } = renderHook(() => useHubRouting());
    expect(result.current.mainTab).toBe("DASHBOARD");
  });

  it("restores mainTab from a deep-linking URL, overriding localStorage", () => {
    localStorage.setItem("mainTab", JSON.stringify("DASHBOARD"));
    setUrl("hub=TRADE_HUB&tab=FINDER");
    const { result } = renderHook(() => useHubRouting());
    expect(result.current.mainTab).toBe("TRADE_HUB");
    expect(result.current.tradeHubSection).toBe("FINDER");
  });

  it("falls back to localStorage when the URL has no hub param", () => {
    localStorage.setItem("mainTab", JSON.stringify("DATA_HUB"));
    localStorage.setItem("dataHubTab", JSON.stringify("BUY_LOW"));
    const { result } = renderHook(() => useHubRouting());
    expect(result.current.mainTab).toBe("DATA_HUB");
    expect(result.current.dataHubTab).toBe("BUY_LOW");
  });

  it("ignores an invalid hub value in the URL", () => {
    setUrl("hub=NOT_A_REAL_HUB");
    const { result } = renderHook(() => useHubRouting());
    expect(result.current.mainTab).toBe("DASHBOARD");
  });

  it("writes the initial state to the URL on mount", () => {
    setUrl("");
    renderHook(() => useHubRouting());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("hub")).toBe("DASHBOARD");
  });

  it("pushes a new history entry when the hub changes", () => {
    const { result } = renderHook(() => useHubRouting());
    const before = window.history.length;
    act(() => { result.current.setMainTab("TRADE_HUB"); });
    expect(new URLSearchParams(window.location.search).get("hub")).toBe("TRADE_HUB");
    expect(window.history.length).toBe(before + 1);
  });

  it("replaces (no new entry) when only the sub-tab changes within a hub", () => {
    const { result } = renderHook(() => useHubRouting());
    act(() => { result.current.setMainTab("TRADE_HUB"); });
    const before = window.history.length;
    act(() => { result.current.setTradeHubSection("FINDER"); });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("FINDER");
    expect(window.history.length).toBe(before);
  });

  // jsdom in this environment doesn't implement real session-history traversal
  // (history.back()/forward() are no-ops on location), so these simulate what
  // the browser does on a real back/forward press: the URL changes first, then
  // a `popstate` event fires — without going through our own pushState/
  // replaceState calls.
  it("restores state on a popstate event (browser back/forward)", () => {
    const { result } = renderHook(() => useHubRouting());
    act(() => { result.current.setMainTab("TRADE_HUB"); });

    act(() => {
      setUrl("hub=DASHBOARD");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.mainTab).toBe("DASHBOARD");
  });

  it("restores a hub's sub-tab from a popstate event", () => {
    const { result } = renderHook(() => useHubRouting());
    act(() => { result.current.setMainTab("TRADE_HUB"); });

    act(() => {
      setUrl("hub=TRADE_HUB&tab=ATTEMPTS");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.mainTab).toBe("TRADE_HUB");
    expect(result.current.tradeHubSection).toBe("ATTEMPTS");
  });

  it("does not re-write history while restoring from a popstate event", () => {
    const { result } = renderHook(() => useHubRouting());
    act(() => { result.current.setMainTab("TRADE_HUB"); });

    setUrl("hub=DASHBOARD");
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.mainTab).toBe("DASHBOARD");
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("ignores a popstate event with no recognizable hub", () => {
    const { result } = renderHook(() => useHubRouting());
    act(() => { result.current.setMainTab("TRADE_HUB"); });

    act(() => {
      setUrl("");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.mainTab).toBe("TRADE_HUB");
  });
});
