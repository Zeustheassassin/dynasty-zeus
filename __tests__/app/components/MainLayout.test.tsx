// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { User as SupabaseUser } from "@supabase/auth-js";
import { MainLayout } from "@/app/components/MainLayout";
import type { MainTab } from "@/lib/hubs";
import type { SleeperUser } from "@/lib/types";

// To-Do Stage 3 (10/14): [ / ] step through the leagues needing attention on the League Hub and
// To-Do — never while typing, with a modifier, on key repeat or with a dialog open.

afterEach(cleanup);
// jsdom has no scrollIntoView (the command palette keeps its highlighted row in view).
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

function renderLayout(mainTab: MainTab, children: React.ReactNode = null) {
  const stepLeague = vi.fn(() => true);
  render(
    <MainLayout
      supabaseUser={{ id: "acct", email: "a@b.c" } as SupabaseUser}
      user={{ user_id: "me", display_name: "Me" } as SleeperUser}
      disconnectSleeper={vi.fn()}
      signOut={vi.fn()}
      leagues={[]}
      selectedLeague={null}
      loadRoster={vi.fn()}
      mainTab={mainTab}
      setMainTab={vi.fn()}
      nflState={null}
      players={{}}
      setTradeHubSection={vi.fn()}
      setLeagueHubTab={vi.fn()}
      setDataHubTab={vi.fn()}
      setDraftHubSection={vi.fn()}
      setPlayerProfileId={vi.fn()}
      setTodoView={vi.fn()}
      stepLeague={stepLeague}
      peekLeagueStep={() => null}
    >
      {children}
    </MainLayout>
  );
  return stepLeague;
}

describe("MainLayout — [ / ] league stepping", () => {
  it("steps Next on ] and Prev on [ in the League Hub and To-Do", () => {
    const step = renderLayout("LEAGUES");
    fireEvent.keyDown(document, { key: "]" });
    fireEvent.keyDown(document, { key: "[" });
    expect(step.mock.calls).toEqual([[1], [-1]]);
    cleanup();
    const todoStep = renderLayout("TODO");
    fireEvent.keyDown(document, { key: "]" });
    expect(todoStep).toHaveBeenCalledWith(1);
  });

  it("does nothing on other hubs", () => {
    const step = renderLayout("DATA_HUB");
    fireEvent.keyDown(document, { key: "]" });
    expect(step).not.toHaveBeenCalled();
  });

  it("stays out of the way while typing, with a modifier, on repeat, or with a dialog open", () => {
    const step = renderLayout("LEAGUES", (
      <>
        <input aria-label="search" />
        <textarea aria-label="note" />
        <select aria-label="pick"><option>x</option></select>
      </>
    ));
    for (const label of ["search", "note", "pick"]) {
      fireEvent.keyDown(document.querySelector(`[aria-label="${label}"]`)!, { key: "]" });
    }
    fireEvent.keyDown(document, { key: "]", ctrlKey: true });
    fireEvent.keyDown(document, { key: "]", metaKey: true });
    fireEvent.keyDown(document, { key: "]", repeat: true });
    expect(step).not.toHaveBeenCalled();

    // The command palette is a modal dialog: the brackets are left to it.
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: "]" });
    expect(step).not.toHaveBeenCalled();
  });
});
