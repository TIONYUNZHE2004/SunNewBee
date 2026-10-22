// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDevsim } from "../../devsim/devsimStore";
import provisional from "../../devsim/fixtures/plan.elmina.json";
import type { DevelopmentPlan } from "../../devsim/types";
import { DevsimTextPanel } from "./DevsimTextPanel";

const plan = provisional as unknown as DevelopmentPlan;
const d = () => useDevsim.getState();

beforeEach(() => d().stop());
afterEach(cleanup);

describe("DevsimTextPanel (Mapbox lite: text version only)", () => {
  it("nothing while idle; the text version while a simulation is active", () => {
    render(<DevsimTextPanel />);
    expect(screen.queryByTestId("devsim-text-panel")).toBeNull();
    act(() => d().start(plan, "b"));
    expect(screen.getByTestId("devsim-text-panel")).toBeInTheDocument();
    expect(screen.getByTestId("devsim-list")).toBeInTheDocument();
    expect(screen.getAllByTestId("devsim-quote")).toHaveLength(plan.bubbles.length);
  });

  it("shows the not-available message on a 404", () => {
    render(<DevsimTextPanel />);
    act(() => {
      d().start(null, "b");
      d().setStatus("unavailable");
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Development simulation is not available for this map.",
    );
  });

  it("unheard quotes keep full-opacity text (Q3)", () => {
    render(<DevsimTextPanel />);
    act(() => d().start(plan, "b"));
    for (const q of screen.getAllByTestId("devsim-quote"))
      expect(q.className).not.toMatch(/opacity/);
  });
});
