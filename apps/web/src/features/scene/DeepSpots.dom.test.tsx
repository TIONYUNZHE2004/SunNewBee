// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schemas } from "@tl/api-client";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { DeepSpots } from "./DeepSpots";
import { useScene } from "./sceneStore";

const site = (deep_spots?: Schemas["DeepSpot"][]): Schemas["Site"] => ({
  id: "t",
  name: "Test",
  township: "Test",
  bbox: [101.4, 3.0, 101.5, 3.1],
  center: [101.45, 3.05],
  ...(deep_spots ? { deep_spots } : {}),
});
const clientWith = (s: Schemas["Site"]) => {
  const qc = newQueryClient();
  qc.setQueryData(["site"], s);
  return qc;
};

beforeEach(() => useScene.getState().reset());

describe("DeepSpots", () => {
  it("renders nothing when the site has no deep_spots", () => {
    const { container } = renderWithClient(<DeepSpots />, clientWith(site()));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty deep_spots list", () => {
    const { container } = renderWithClient(<DeepSpots />, clientWith(site([])));
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking a spot flies the camera there and shows its lens", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <DeepSpots />,
      clientWith(
        site([
          { id: "mall", lens: "access", name: "Lakeside mall", bbox: [101.4, 3.0, 101.42, 3.02] },
          { id: "river", lens: "flood", name: "River bend", bbox: [101.44, 3.04, 101.46, 3.06] },
        ]),
      ),
    );
    expect(screen.getByText("Jump to")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lakeside mall" }));
    const s = useScene.getState();
    expect(s.camera?.center[0]).toBeCloseTo(101.41);
    expect(s.camera?.center[1]).toBeCloseTo(3.01);
    expect(s.camera?.rangeM).toBeGreaterThanOrEqual(500);
    expect(s.lensVisible.access).toBe(true);
    expect(s.scenarioId).toBeNull();
  });

  it("a spot for a hidden lens turns that lens on", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <DeepSpots />,
      clientWith(
        site([
          { id: "bins", lens: "waste", name: "Recycling hub", bbox: [101.4, 3.0, 101.41, 3.01] },
        ]),
      ),
    );
    expect(useScene.getState().lensVisible.waste).toBe(false);
    await user.click(screen.getByRole("button", { name: "Recycling hub" }));
    expect(useScene.getState().lensVisible.waste).toBe(true);
  });

  it("a flood spot also switches the flood lens on with the 3 m scenario", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <DeepSpots />,
      clientWith(
        site([
          { id: "river", lens: "flood", name: "River bend", bbox: [101.44, 3.04, 101.46, 3.06] },
        ]),
      ),
    );
    await user.click(screen.getByRole("button", { name: "River bend" }));
    const s = useScene.getState();
    expect(s.lensVisible.flood).toBe(true);
    expect(s.scenarioId).toBe("stage_p3m");
    expect(s.camera).not.toBeNull();
  });
});
