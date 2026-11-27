// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import DueNowList, { type DueMarksState } from "@/components/scouting/stats/DueNowList";
import { CATAPULT_CHOICES, type DueItem } from "@/lib/scouting/dueNow";

// Analysis → Grading checks → Due now (stage 2 of the 2026-11-26 scouting plan).

afterEach(() => cleanup());

const item = (key: string, state: DueItem["state"], extra: Partial<DueItem> = {}): DueItem =>
  ({ key, cycle: "2027", title: `Title ${key}`, detail: `Detail ${key}`, when: `When ${key}`, state, at: 1, mark: "done", ...extra });

function renderList(items: DueItem[], marksState: DueMarksState = "ok") {
  const onMark = vi.fn(async (): Promise<string | null> => null);
  const onUnmark = vi.fn(async (): Promise<string | null> => null);
  render(<DueNowList items={items} dataReady marksState={marksState} onMark={onMark} onUnmark={onUnmark} />);
  return { onMark, onUnmark };
}

describe("DueNowList", () => {
  it("shows due and coming-up checks in full, counts each group, and folds later and done away", () => {
    renderList([
      item("due", "due"), item("soon", "soon"),
      item("wait", "waiting", { progress: { have: 12, need: 30, unit: "TE games" } }),
      item("later", "later"), item("done", "done", { done: { doneAt: "2026-11-20T12:00:00Z", value: null } }),
    ]);
    expect(screen.getByText("1 due · 1 coming up · 1 waiting on data")).toBeTruthy();
    expect(screen.getByText("Detail due")).toBeTruthy();
    expect(screen.getByText("12 / 30 TE games")).toBeTruthy();
    expect(screen.getByText("Later (1)")).toBeTruthy();
    expect(screen.getByText("Done (1)")).toBeTruthy();
  });

  it("Mark done saves the check's cycle; a choice saves its value", async () => {
    const { onMark } = renderList([
      item("fill_40s", "due"),
      item("catapult", "due", { mark: "choice", choices: CATAPULT_CHOICES }),
    ]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark done" })); });
    expect(onMark).toHaveBeenCalledWith("fill_40s", "2027", null);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No access: chart the slower tape" })); });
    expect(onMark).toHaveBeenCalledWith("catapult", "2027", "no_access");
  });

  it("Undo removes a done mark; a failed save says so", async () => {
    const { onUnmark } = renderList([item("done", "done", { done: { doneAt: "2026-11-20T12:00:00Z", value: null } })]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(onUnmark).toHaveBeenCalledWith("done", "2027");
    cleanup();

    const onMark = vi.fn(async () => "Couldn't save (is migration 106 applied?)");
    render(<DueNowList items={[item("x", "due")]} dataReady marksState="ok" onMark={onMark} onUnmark={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark done" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/migration 106/);
  });

  it("without migration 106 the buttons are off and it says why", () => {
    renderList([item("x", "due")], "missing");
    expect((screen.getByRole("button", { name: "Mark done" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs migration 106/)).toBeTruthy();
  });

  it("a check that clears itself has no button", () => {
    renderList([item("top60_goal", "due", { mark: null })]);
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });
});
