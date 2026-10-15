// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { PathOverlay } from "./PathOverlay";

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
      properties: { id: "e1", name: "Jalan Tasik", flood_class: "likely_flooded" },
    },
  ],
};

function setup() {
  const qc = newQueryClient();
  const profile = useScene.getState().profile;
  useScene.setState({ scenarioId: "stage_p3m" });
  qc.setQueryData(["layer", "flood", profile, "stage_p3m"], layer);
  qc.setQueryData(["scenarios"], [scenario]);
  useScene.getState().selectFloodEdge("e1");
  return renderWithClient(<PathOverlay />, qc);
}

beforeEach(() => useScene.getState().reset());

describe("PathOverlay", () => {
  it("explains the path without safety claims or depths", () => {
    const { container } = setup();
    expect(screen.getByRole("dialog", { name: "Why this path?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why this path?" })).toHaveFocus();
    expect(screen.getAllByText(/indicative/i).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bsafe\b|\d+(\.\d+)?\s?(m|cm) deep|depth/i);
  });

  it("closes with the button and with Escape", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Close path details" }));
    expect(useScene.getState().selectedFloodEdgeId).toBeNull();
    useScene.getState().selectFloodEdge("e1");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(useScene.getState().selectedFloodEdgeId).toBeNull();
  });
});
