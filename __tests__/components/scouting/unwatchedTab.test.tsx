// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import UnwatchedTab from "@/components/scouting/UnwatchedTab";
import { useChartingState } from "@/components/scouting/shared/hooks/useChartingState";
import { unwatchedByProspect } from "@/lib/scouting/unwatchedGames";
import type { Prospect, ScoutingGame } from "@/lib/types";

// 2026-11-16: Scouting → Unwatched lists logged games with no charted plays; a
// click opens the prospect's board on Chart Game with that game picked.

const { GAMES } = vi.hoisted(() => ({ GAMES: [] as unknown[] }));
vi.mock("@/lib/supabaseclient", () => {
  // scouting_games load: select().eq().order().order() resolves to GAMES.
  interface Chain extends PromiseLike<{ data: unknown[]; error: null }> { select(): Chain; eq(): Chain; order(): Chain }
  const chain = {} as Chain;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.then = (ok, bad) => Promise.resolve({ data: [...GAMES], error: null }).then(ok, bad);
  return { supabase: { from: () => chain } };
});

const prospect = (id: string, extra: Partial<Prospect> = {}) =>
  ({ id, name: id, position: "WR", school: "Ohio State", draft_class_year: 2027, personal_rank: null, ...extra }) as Prospect;
const game = (id: string, prospect_id: string, extra: Partial<ScoutingGame> = {}) =>
  ({ id, prospect_id, season_year: 2026, game_slot: 1, opponent: `Opp ${id}`, game_type: "regular", created_at: "2026-11-13T12:00:00Z", ...extra }) as ScoutingGame;

beforeEach(() => { GAMES.length = 0; });
afterEach(() => cleanup());

describe("UnwatchedTab", () => {
  const prospects = [
    prospect("Jeremiah Smith", { personal_rank: 1 }),
    prospect("Kewan Lacy", { position: "RB", school: "Ole Miss" }),
    prospect("Malachi Toney", { draft_class_year: 2028, school: "Miami" }),
  ];
  const games = [
    game("js1", "Jeremiah Smith"), game("js2", "Jeremiah Smith", { game_slot: 2, opponent: "Indiana" }),
    game("js3", "Jeremiah Smith", { game_slot: 3, opponent: "Ball State", game_type: "bowl" }),
    game("kl1", "Kewan Lacy", { opponent: "Missouri" }),
    game("mt1", "Malachi Toney", { opponent: "USF" }),
  ];
  const snaps = [{ game_id: "js1", snaps_charted: 60 }, { game_id: "js2", snaps_charted: 0 }];
  const groups = unwatchedByProspect(games, snaps, prospects);

  function renderTab(extra: Partial<Parameters<typeof UnwatchedTab>[0]> = {}) {
    const onOpenGame = vi.fn();
    const setDraftYearFilter = vi.fn();
    const onSaveTapeSource = vi.fn(async (): Promise<string | null> => null);
    render(
      <UnwatchedTab groups={groups} years={[2027, 2028]} loading={false} failed={false}
        draftYearFilter={null} setDraftYearFilter={setDraftYearFilter} onOpenGame={onOpenGame}
        tapeSourceOf={(g) => g.tape_source ?? null} tapeSuggestions={["Dynasty Nerds"]}
        onSaveTapeSource={onSaveTapeSource} {...extra} />,
    );
    return { onOpenGame, setDraftYearFilter, onSaveTapeSource };
  }
  const tapeBox = (label: string) => screen.getByLabelText(`Where the tape is: ${label}`) as HTMLInputElement;

  it("saves where a game's tape is on leaving the box, trimmed", async () => {
    const { onSaveTapeSource } = renderTab();
    const box = tapeBox("2026 Missouri");
    fireEvent.change(box, { target: { value: "  Dynasty Nerds " } });
    await act(async () => { fireEvent.blur(box); });
    expect(onSaveTapeSource).toHaveBeenCalledWith("kl1", "Dynasty Nerds");
    expect(box.value).toBe("Dynasty Nerds");
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("doesn't save an unchanged box, and clears a source emptied", async () => {
    const withTape = unwatchedByProspect([game("kl1", "Kewan Lacy", { opponent: "Missouri", tape_source: "Dynasty Nerds" })], [], prospects);
    const { onSaveTapeSource } = renderTab({ groups: withTape });
    const box = tapeBox("2026 Missouri");
    expect(box.value).toBe("Dynasty Nerds");
    await act(async () => { fireEvent.blur(box); });
    expect(onSaveTapeSource).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: " " } });
    await act(async () => { fireEvent.blur(box); });
    expect(onSaveTapeSource).toHaveBeenCalledWith("kl1", null);
  });

  it("Escape puts back what's saved; a failed save says why", async () => {
    const onSaveTapeSource = vi.fn(async () => "Couldn't save (is migration 101 applied?)");
    renderTab({ onSaveTapeSource });
    const box = tapeBox("2026 Indiana");
    fireEvent.change(box, { target: { value: "YouTube" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "YouTube" } });
    await act(async () => { fireEvent.blur(box); });
    expect(screen.getByText("Couldn't save (is migration 101 applied?)")).toBeTruthy();
  });

  it("links a source that's a URL, and offers the sources used", () => {
    const withLink = unwatchedByProspect([game("kl1", "Kewan Lacy", { opponent: "Missouri", tape_source: "https://youtu.be/abc" })], [], prospects);
    const { container } = render(
      <UnwatchedTab groups={withLink} years={[2027]} loading={false} failed={false} draftYearFilter={null}
        setDraftYearFilter={vi.fn()} onOpenGame={vi.fn()} tapeSourceOf={(g) => g.tape_source ?? null}
        tapeSuggestions={["Dynasty Nerds", "YouTube"]} onSaveTapeSource={vi.fn(async () => null)} />,
    );
    const open = screen.getByText("Open ↗") as HTMLAnchorElement;
    expect(open.href).toBe("https://youtu.be/abc");
    expect(open.rel).toBe("noopener noreferrer");
    const options = [...container.querySelectorAll("datalist option")].map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["Dynasty Nerds", "YouTube"]);
  });

  it("lists each prospect's unwatched games with how many of his logged games are charted", () => {
    renderTab();
    expect(screen.getByText("4 games across 3 prospects")).toBeTruthy();
    expect(screen.getByText("Indiana")).toBeTruthy();
    expect(screen.getByText("Ball State")).toBeTruthy();
    expect(screen.getByText("Bowl")).toBeTruthy();
    expect(screen.queryByText("Opp js1")).toBeNull(); // charted
    const smith = screen.getByText("Jeremiah Smith").closest("li")!;
    expect(smith.textContent).toContain("Charted 1 of 3 games");
  });

  it("opens the clicked game", () => {
    const { onOpenGame } = renderTab();
    fireEvent.click(screen.getByText("Missouri"));
    expect(onOpenGame).toHaveBeenCalledWith(prospects[1], "kl1");
  });

  it("filters by class and position, with counts on the position buttons", () => {
    renderTab({ draftYearFilter: 2027 });
    expect(screen.getByText("3 games across 2 prospects")).toBeTruthy();
    expect(screen.queryByText("USF")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "RB 1" }));
    expect(screen.getByText("1 game across 1 prospect")).toBeTruthy();
    expect(screen.queryByText("Indiana")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "TE 0" }));
    expect(screen.getByText("Every logged game in the 2027 class for TEs has charted plays.")).toBeTruthy();
  });

  it("says the counts didn't load instead of listing anything", () => {
    renderTab({ failed: true });
    expect(screen.getByText(/Couldn.t load the play counts per game/)).toBeTruthy();
    expect(screen.queryByText("Indiana")).toBeNull();
  });
});

describe("useChartingState initialGameId", () => {
  it("opens on Chart Game with the game picked", async () => {
    GAMES.push(game("first", "p"), game("second", "p", { game_slot: 2 }));
    const h = renderHook(() => useChartingState(prospect("p"), { onDataChanged: vi.fn(), initialGameId: "second" }));
    await act(async () => {});
    expect(h.result.current.tab).toBe("chart");
    expect(h.result.current.selectedGameId).toBe("second");
  });

  it("falls back to his first game when that game is gone", async () => {
    GAMES.push(game("first", "p"));
    const h = renderHook(() => useChartingState(prospect("p"), { onDataChanged: vi.fn(), initialGameId: "deleted" }));
    await act(async () => {});
    expect(h.result.current.selectedGameId).toBe("first");
  });

  it("starts on Overview with his first game picked otherwise", async () => {
    GAMES.push(game("first", "p"), game("second", "p", { game_slot: 2 }));
    const h = renderHook(() => useChartingState(prospect("p"), { onDataChanged: vi.fn() }));
    await act(async () => {});
    expect(h.result.current.tab).toBe("overview");
    expect(h.result.current.selectedGameId).toBe("first");
  });
});
