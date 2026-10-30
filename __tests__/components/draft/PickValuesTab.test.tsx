// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PickValuesTab from "@/components/draft/PickValuesTab";
import { applyPickValueOverrides } from "@/lib/helpers/picks";

// The chart is decoration here; jsdom can't lay it out.
vi.mock("@/components/charts/ChartCard", () => ({
  ChartCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  chartGridProps: {}, chartAxisProps: {}, chartTickStyle: {},
}));
vi.mock("recharts", () => ({
  LineChart: () => null, Line: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
}));

// 10/30: Draft Hub → Pick Values lets the user set their own value for any pick; FantasyCalc
// stays the default for the rest.
const market: Record<string, number> = {
  "2027-1-early": 4942, "2027-1-mid": 3254, "2027-1-late": 2513, "2027-1": 2926,
  "2027-2": 1597, "2027-3": 1093, "2027-4": 827,
  "2028-1": 2275, "2029-1": 1922,
};

function renderTab(overrides: Record<string, number> = {}) {
  const save = vi.fn();
  render(
    <PickValuesTab
      marketPickFcValues={market}
      pickFcValues={applyPickValueOverrides(market, overrides)}
      pickValueOverrides={overrides}
      savePickValueOverrides={save}
      allPicks={[]}
      myRosterId={1}
    />
  );
  return save;
}

const type = (label: string, text: string) => {
  const box = screen.getByLabelText(label);
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.blur(box);
};

describe("PickValuesTab", () => {
  afterEach(cleanup);

  it("shows the next undrafted class with FantasyCalc's band value in each slot", () => {
    renderTab();
    expect(screen.getByText("2027 Rookie Pick Values")).toBeTruthy();
    expect((screen.getByLabelText("2027 pick 1.01 value") as HTMLInputElement).value).toBe("4,942");
    expect((screen.getByLabelText("2027 pick 1.07 value") as HTMLInputElement).value).toBe("3,254");
    expect((screen.getByLabelText("2028 1st round value") as HTMLInputElement).value).toBe("2,275");
  });

  it("saves a typed value for that exact slot", () => {
    const save = renderTab();
    type("2027 pick 1.01 value", "8,500");
    expect(save).toHaveBeenCalledWith({ "2027-1.01": 8500 });
  });

  it("clearing a box, or typing FantasyCalc's own number, goes back to FantasyCalc", () => {
    const save = renderTab({ "2027-1.01": 8500, "2028-1": 3000 });
    type("2027 pick 1.01 value", "");
    expect(save).toHaveBeenLastCalledWith({ "2028-1": 3000 });
    type("2028 1st round value", "2275");
    expect(save).toHaveBeenLastCalledWith({ "2027-1.01": 8500 });
  });

  it("ignores text that isn't a value", () => {
    const save = renderTab();
    type("2027 pick 1.02 value", "abc");
    type("2027 pick 1.03 value", "-50");
    expect(save).not.toHaveBeenCalled();
  });

  it("marks edited picks with FantasyCalc's number and a reset, and resets all only after confirming", () => {
    const save = renderTab({ "2027-1.01": 8500 });
    expect(screen.getByText("FC 4,942")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Reset 1.01 to FantasyCalc"));
    expect(save).toHaveBeenLastCalledWith({});
    save.mockClear();
    fireEvent.click(screen.getByText("Reset all…"));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Reset all to FantasyCalc"));
    expect(save).toHaveBeenCalledWith({});
  });
});
