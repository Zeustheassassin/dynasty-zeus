// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import ChartingBoard, { type ChartingBoardProps } from "@/components/scouting/shared/ChartingBoard";
import { useChartingState } from "@/components/scouting/shared/hooks/useChartingState";
import type { OverviewData } from "@/components/scouting/overview/ProspectOverview";
import type { Prospect } from "@/lib/types";

// 2026-11-15: the 40 (migration 099) in Edit Bio. It saves in its own request,
// only when it changed, so a database without 099 can't fail the rest of the bio.

const { UPDATES, ERRORS } = vi.hoisted(() => ({
  UPDATES: [] as Record<string, unknown>[],
  ERRORS: [] as ({ message: string } | null)[],
}));
vi.mock("@/lib/supabaseclient", () => {
  // scouting_games load: select().eq().order().order() resolves to no games.
  interface Chain extends Promise<{ data: unknown[]; error: null }> { select(): Chain; eq(): Chain; order(): Chain }
  const games = Promise.resolve({ data: [], error: null }) as unknown as Chain;
  games.select = () => games;
  games.eq = () => games;
  games.order = () => games;
  return {
    supabase: {
      from: (table: string) => (table === "prospects"
        ? {
          update: (payload: Record<string, unknown>) => {
            UPDATES.push(payload);
            const error = ERRORS.shift() ?? null;
            return { eq: () => Promise.resolve({ error }) };
          },
        }
        : games),
    },
  };
});
vi.mock("@/components/scouting/overview/ProspectOverview", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectScorePieces", () => ({ default: () => null }));
vi.mock("@/components/scouting/overview/ProspectProduction", () => ({ default: () => null }));
vi.mock("@/components/scouting/shared/RoleFields", () => ({ ShouldPlayField: () => null, WillPlayPostSelect: () => null }));

const prospect = (extra: Partial<Prospect> = {}) =>
  ({ id: "p", name: "Darius Taylor", position: "RB", school: "Minnesota", draft_class_year: 2027, height: "5'11\"", weight: 205, ...extra }) as Prospect;

beforeEach(() => { UPDATES.length = 0; ERRORS.length = 0; localStorage.clear(); });
afterEach(() => cleanup());

describe("saveBio and the 40", () => {
  async function hook(p: Prospect) {
    const h = renderHook(() => useChartingState(p, { onDataChanged: vi.fn() }));
    await act(async () => {}); // games load + bio from the prospect
    act(() => h.result.current.onToggleEditBio());
    return h;
  }

  it("leaves the 40 out of the bio update, and sends nothing for it when it didn't change", async () => {
    const h = await hook(prospect());
    act(() => h.result.current.onBioChange({ school: "Minnesota State" }));
    await act(async () => { await h.result.current.onSaveBio(); });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0]).toMatchObject({ school: "Minnesota State" });
    expect(Object.keys(UPDATES[0])).not.toContain("forty_time");
    expect(Object.keys(UPDATES[0])).not.toContain("forty_weight");
    expect(h.result.current.editBio).toBe(false);
  });

  it("saves a new 40, where he ran it and his weigh-in in their own request", async () => {
    const h = await hook(prospect());
    act(() => h.result.current.onBioChange({ forty_time: 4.62, forty_source: "pro_day", forty_weight: 201 }));
    await act(async () => { await h.result.current.onSaveBio(); });
    expect(UPDATES).toHaveLength(2);
    expect(UPDATES[1]).toEqual({ forty_time: 4.62, forty_source: "pro_day", forty_weight: 201 });
    expect(h.result.current.editBio).toBe(false);
  });

  it("clears all three together", async () => {
    const h = await hook(prospect({ forty_time: 4.5, forty_source: "combine", forty_weight: 210 }));
    act(() => h.result.current.onBioChange({ forty_time: null, forty_source: null, forty_weight: null }));
    await act(async () => { await h.result.current.onSaveBio(); });
    expect(UPDATES[1]).toEqual({ forty_time: null, forty_source: null, forty_weight: null });
  });

  it("keeps the form open with a message when only the 40 fails (no migration 099 yet)", async () => {
    const h = await hook(prospect());
    ERRORS.push(null, { message: "column prospects.forty_time does not exist" });
    act(() => h.result.current.onBioChange({ forty_time: 4.55, forty_source: "combine" }));
    await act(async () => { await h.result.current.onSaveBio(); });
    expect(UPDATES).toHaveLength(2);
    expect(h.result.current.editBio).toBe(true);
    expect(h.result.current.gameError).toMatch(/except the 40 time/);
  });

  it("won't save a weigh-in out of range", async () => {
    const h = await hook(prospect());
    act(() => h.result.current.onBioChange({ forty_time: 4.55, forty_source: "combine", forty_weight: 21 }));
    await act(async () => { await h.result.current.onSaveBio(); });
    expect(UPDATES).toHaveLength(0);
    expect(h.result.current.gameError).toMatch(/Weighed must be 150–400/);
  });
});

describe("Edit Bio 40 fields", () => {
  function props(bio: Partial<Prospect>, onBioChange = vi.fn()): ChartingBoardProps {
    const p = prospect();
    return {
      prospect: p,
      config: { positionLabel: "RB", accentColor: "green", rolePos: "RB" },
      overviewData: {} as OverviewData,
      tab: "chart", games: [], selectedGameId: null, loading: false, gamePlayCounts: {},
      showAddGame: false, newGame: { year: 2026, opponent: "", type: "regular" }, savingGame: false, gameError: null,
      editBio: true, bio: { weight: 205, ...bio }, savingBio: false,
      onBack: vi.fn(), onTabChange: vi.fn(), onSelectGame: vi.fn(), onToggleAddGame: vi.fn(), onNewGameChange: vi.fn(),
      onAddGame: vi.fn(), onDeleteGame: vi.fn(), onUpdateGame: vi.fn(), onToggleEditBio: vi.fn(), onBioChange, onSaveBio: vi.fn(),
      renderPlayLogger: () => null,
      renderGamesTable: () => null,
    };
  }

  it("takes a typed 40 as the combine's, and only enables where / weighed once there's a time", () => {
    const onBioChange = vi.fn();
    render(<ChartingBoard {...props({}, onBioChange)} />);
    expect((screen.getByRole("combobox", { name: "40 Run At" }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("spinbutton", { name: "Weighed (lbs)" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("spinbutton", { name: "Weighed (lbs)" }).getAttribute("placeholder")).toBe("bio 205");
    const box = screen.getByRole("textbox", { name: /^40 Time/ });
    fireEvent.change(box, { target: { value: "4." } });
    expect(onBioChange).not.toHaveBeenCalled(); // not a time yet
    fireEvent.change(box, { target: { value: "4.52" } });
    expect(onBioChange).toHaveBeenLastCalledWith({ forty_time: 4.52, forty_source: "combine" });
    fireEvent.change(box, { target: { value: "" } });
    expect(onBioChange).toHaveBeenLastCalledWith({ forty_time: null, forty_source: null, forty_weight: null });
  });

  it("keeps a pro day as the source when the time changes", () => {
    const onBioChange = vi.fn();
    render(<ChartingBoard {...props({ forty_time: 4.5, forty_source: "pro_day" }, onBioChange)} />);
    expect((screen.getByRole("combobox", { name: "40 Run At" }) as HTMLSelectElement).value).toBe("pro_day");
    fireEvent.change(screen.getByRole("textbox", { name: /^40 Time/ }), { target: { value: "4.48" } });
    expect(onBioChange).toHaveBeenLastCalledWith({ forty_time: 4.48, forty_source: "pro_day" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Weighed (lbs)" }), { target: { value: "199" } });
    expect(onBioChange).toHaveBeenLastCalledWith({ forty_weight: 199 });
  });
});
