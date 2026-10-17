import { describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { pointText, useTripPick } from "./tripPickStore";

describe("trip pick store", () => {
  it("switching mode closes the card and stops picking (review C20)", () => {
    useMode.setState({ mode: "resident" });
    useTripPick.getState().setOpen(true);
    useTripPick.getState().setPicking("from");
    useMode.setState({ mode: "management" });
    expect(useTripPick.getState()).toMatchObject({ open: false, picking: null, points: {} });
  });

  it("a chosen point ends picking and is written as lon,lat", () => {
    useTripPick.getState().setPicking("to");
    useTripPick.getState().setPoint("to", [101.5123456, 3.1812346]);
    expect(useTripPick.getState().picking).toBeNull();
    expect(pointText(useTripPick.getState().points.to as [number, number])).toBe(
      "101.512346,3.181235",
    );
  });
});
