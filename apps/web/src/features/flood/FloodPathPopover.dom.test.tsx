// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { FloodPathPopover } from "./FloodPathPopover";

const scenario = {
  id: "stage_p3m",
  label: "River +3 m",
  stage_m: 3,
  method: "REM",
  dem: "Copernicus GLO-30",
  margin_m: 0.5,
  created: "2026-09-30",
  disclaimer: "Indicative scenario, not a forecast.",
  links: [],
};
const layer = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: null,
      properties: { id: "seg-cd", name: "Jalan Tasik", flood_class: "likely_flooded" },
    },
  ],
};

beforeEach(() => useScene.getState().reset());

// The popover is opened from a map click or a list row; here a plain button stands in for it.
function Harness() {
  const select = useScene((s) => s.selectFloodEdge);
  return (
    <>
      <button type="button" onClick={() => select("seg-cd")}>
        Jalan Tasik row
      </button>
      <FloodPathPopover />
    </>
  );
}

function setup() {
  const qc = newQueryClient();
  const profile = useScene.getState().profile;
  useScene.setState({ scenarioId: "stage_p3m" });
  qc.setQueryData(["layer", "flood", profile, "stage_p3m"], layer);
  qc.setQueryData(["scenarios"], [scenario]);
  return renderWithClient(<Harness />, qc);
}

describe("flood 'Why this path?' popover", () => {
  it("opens for the selected path and moves focus to its heading", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Jalan Tasik row" }));
    expect(screen.getByRole("dialog", { name: "Why this path?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why this path?" })).toHaveFocus();
    expect(screen.getByText("Likely flooded (indicative)")).toBeInTheDocument();
  });

  it("Escape closes it and returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    setup();
    const opener = screen.getByRole("button", { name: "Jalan Tasik row" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useScene.getState().selectedFloodEdgeId).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("sits above the demo bar (bottom offset by --demo-bar-h)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Jalan Tasik row" }));
    expect(screen.getByRole("dialog").className).toContain(
      "bottom-[calc(var(--demo-bar-h,0px)+1rem)]",
    );
  });

  it("the Close button also closes it and returns focus", async () => {
    const user = userEvent.setup();
    setup();
    const opener = screen.getByRole("button", { name: "Jalan Tasik row" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("selecting a place closes it (one panel at a time)", () => {
    setup();
    act(() => useScene.getState().selectFloodEdge("seg-cd"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => useScene.getState().selectPlace("p1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
