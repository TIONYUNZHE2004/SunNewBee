// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { FloodImpactCard, FloodImpactList } from "./FloodImpact";

const affected = {
  scenario_id: "stage_p3m",
  disclaimer: "Indicative scenario, not a forecast.",
  flooded_path_m: 111.2,
  flooded_places: [
    { id: "playground", name: "Urban Park playground", type: "playground", lonlat: [101.5, 3.1] },
  ],
  cut_off_places: [{ id: "b3", name: "Urban Park bench 3", type: "seating", lonlat: [101.5, 3.1] }],
  isolated_components: [],
  isolated_total: 0,
};

// The API client builds a Request with a relative URL, which jsdom rejects; seed the cache instead.
function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(["scenario-affected", "stage_p3m"], affected);
  return qc;
}

beforeEach(() => useScene.getState().reset());

describe("flood impact (T-027)", () => {
  it("shows nothing at normal river level", () => {
    renderWithClient(<FloodImpactCard />, seeded());
    expect(screen.queryByTestId("flood-impact")).toBeNull();
  });

  it("summarises the API's counts and metres with both notes, never 'safe' or a depth", async () => {
    useScene.getState().setScenario("stage_p3m");
    renderWithClient(<FloodImpactCard />, seeded());
    const card = await screen.findByTestId("flood-impact");
    expect(card).toHaveTextContent("1 place likely flooded (indicative)");
    expect(card).toHaveTextContent("1 place cut off: no mapped way in or out");
    expect(card).toHaveTextContent("111 m of mapped paths likely flooded");
    expect(card).toHaveTextContent("Indicative scenario, not a forecast.");
    expect(card).toHaveTextContent("Flash floods from heavy rain are not shown.");
    expect(card.textContent).not.toMatch(/\bsafe\b|depth|deep/i);
  });

  it("lists every marked place in the List view under its label", async () => {
    renderWithClient(<FloodImpactList scenarioId="stage_p3m" />, seeded());
    await screen.findByTestId("flood-impact-list");
    expect(screen.getByRole("heading", { name: "Likely flooded (indicative)" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Cut off: no mapped way in or out (indicative)" }),
    ).toBeVisible();
    expect(screen.getByText("Urban Park bench 3")).toBeVisible();
  });
});
