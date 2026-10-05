// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePlayTags } from "@/components/scouting/shared/hooks/usePlayTags";
import type { TagPosition } from "@/lib/scouting/playEra";

type Props = { gameId: string | null; plays: object[] };
const setup = (position: TagPosition, initial: Props) =>
  renderHook(({ gameId, plays }: Props) => usePlayTags(position, gameId, plays), { initialProps: initial });

describe("usePlayTags", () => {
  it("keeps red zone / garbage time on across plays and clears the one-play tags after a log", () => {
    const { result, rerender } = setup("WR", { gameId: "g1", plays: [] });
    act(() => {
      result.current.set("red_zone", true);
      result.current.set("third_fourth_down", true);
    });
    const logged = result.current.payload({});
    expect(logged).toMatchObject({ red_zone: true, third_fourth_down: true, garbage_time: false });

    // The board appends the logged row and resets the form.
    act(() => result.current.reset());
    rerender({ gameId: "g1", plays: [logged] });
    expect(result.current.values.red_zone).toBe(true);
    expect(result.current.values.third_fourth_down).toBe(false);

    act(() => result.current.set("red_zone", false));
    expect(result.current.payload({}).red_zone).toBe(false);
  });

  it("starts each game from that game's last charted value", () => {
    const g2Plays = [{ red_zone: false, garbage_time: true }];
    const { result, rerender } = setup("RB", { gameId: "g1", plays: [] });
    act(() => result.current.set("red_zone", true));
    rerender({ gameId: "g2", plays: g2Plays });
    expect(result.current.values).toMatchObject({ red_zone: false, garbage_time: true });
    // Back on g1 the pick made there still holds.
    rerender({ gameId: "g1", plays: [] });
    expect(result.current.values.red_zone).toBe(true);
  });

  it("writes no tag column when editing a play charted before the tags", () => {
    const old = { id: "p1", route_type: "nine", red_zone: null, press_release: null };
    const { result } = setup("WR", { gameId: "g1", plays: [old] });
    act(() => result.current.startEdit(old));
    expect(result.current.editingUntagged).toBe(true);
    expect(result.current.payload({ press: true, catch: true })).toEqual({});
    // A required pick can't block saving an old play.
    expect(result.current.missing({ press: true })).toEqual([]);
    act(() => result.current.set("red_zone", true));
    expect(result.current.payload({})).toEqual({});

    act(() => result.current.reset());
    expect(result.current.editingUntagged).toBe(false);
    expect(result.current.payload({})).toMatchObject({ red_zone: false });
  });

  it("edits a tagged play with its own values and rewrites every column", () => {
    const tagged = { id: "p2", red_zone: true, third_fourth_down: true, short_yardage: false, garbage_time: false, blocked_defender: "lb", press_release: null, chipped_before_route: null };
    const { result } = setup("TE", { gameId: "g1", plays: [tagged] });
    act(() => result.current.startEdit(tagged));
    expect(result.current.editingUntagged).toBe(false);
    expect(result.current.values).toMatchObject({ red_zone: true, third_fourth_down: true, blocked_defender: "lb" });
    // Turned into a press route: the block target drops to NULL, release needs a pick.
    expect(result.current.missing({ route: true, press: true }).map((s) => s.column)).toEqual(["press_release"]);
    act(() => result.current.set("press_release", "won"));
    expect(result.current.payload({ route: true, press: true })).toEqual({
      red_zone: true, third_fourth_down: true, short_yardage: false, garbage_time: false,
      blocked_defender: null, press_release: "won", chipped_before_route: false,
    });
    // An edit's sticky change doesn't leak into the next new play.
    act(() => result.current.set("red_zone", false));
    act(() => result.current.reset());
    expect(result.current.values.red_zone).toBe(true);
  });
});
