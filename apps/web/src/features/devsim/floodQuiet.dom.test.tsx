// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { useAttribution } from "../main/useAttribution";
import { useDevsimAnchors } from "./anchors";
import { DevsimOverlay } from "./DevsimOverlay";
import { useDevsim } from "./devsimStore";
import provisional from "./fixtures/plan.provisional.json";
import { quietAttribution, quietStarters } from "./floodQuiet";
import type { DevelopmentPlan } from "./types";

const plan = provisional as unknown as DevelopmentPlan;
const vp = { w: 1000, h: 700, top: 120, avoid: [] };
const d = () => useDevsim.getState();
const BANNED = /flood|river rises|\bsafe\b|selamat|安全/i;
// The Elmina seed's attribution lines (data/seed/elmina/site.json).
const ATTRIBUTION = [
  "© OpenStreetMap contributors (ODbL)",
  "Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA",
  "Flood scenarios: relative elevation above mapped OSM drainage (indicative)",
  "ESA WorldCover 10 m 2021 v200 © ESA WorldCover project, CC-BY 4.0",
];

function Attribution() {
  return <p data-testid="attribution">{useAttribution()}</p>;
}

function screenUnderTest() {
  stubFetch(() => json([]));
  // The typed client builds a relative Request that cannot run in jsdom: seed /site as a query result.
  const qc = newQueryClient();
  qc.setQueryData(["site"], { id: "elmina", attribution: ATTRIBUTION });
  return renderWithClient(
    <>
      <DevsimOverlay viewport={vp} />
      <AssistantPanel />
      <Attribution />
    </>,
    qc,
  );
}

beforeEach(() => {
  d().stop();
  useDevsimAnchors.getState().clear();
  useMode.setState({ mode: "management" });
});
afterEach(cleanup);

describe("no flood content on screen during devsim (D11, AC-H4)", () => {
  it("while the simulation plays, no flood wording anywhere in the overlay, panel or attribution", async () => {
    const { container } = screenUnderTest();
    act(() => {
      d().start(plan, "b");
      d().play();
    });
    await screen.findByText(/OpenStreetMap/);
    for (let t = 0; t <= plan.total_s; t += 1) {
      act(() => d().seek(t));
      expect(container.textContent ?? "", `t=${t}`).not.toMatch(BANNED);
    }
    // licence lines stay
    const attr = screen.getByTestId("attribution").textContent ?? "";
    expect(attr).toMatch(/OpenStreetMap contributors \(ODbL\)/);
    expect(attr).toMatch(/Copernicus DEM GLO-30/);
    expect(screen.queryByText("Rising river")).toBeNull();
  });

  it("back to idle: the flood starter, Rising river and the attribution's flood clause return", async () => {
    screenUnderTest();
    act(() => d().start(plan, "b"));
    await screen.findByText(/OpenStreetMap/);
    expect(screen.queryByRole("button", { name: /river rises 3 m/i })).toBeNull();
    act(() => d().stop());
    expect(await screen.findByRole("button", { name: /river rises 3 m/i })).toBeInTheDocument();
    expect(screen.getByText("Rising river")).toBeInTheDocument();
    expect(screen.getByTestId("attribution")).toHaveTextContent(/Flood scenarios:/);
  });

  it("helpers: only the flood clause and the flood starters go", () => {
    expect(quietAttribution(ATTRIBUTION)).toEqual([ATTRIBUTION[0], ATTRIBUTION[1], ATTRIBUTION[3]]);
    const kept = quietStarters([
      { icon: "flood", text: "Which places are cut off?" },
      { icon: "wheelchair", text: "What if the river rises 3 m and we build a ramp?" },
      { icon: "walk", text: "What happens to residents in the storm rehearsal?" },
      { icon: "map", text: "Simulate a 30-storey, 500-home tower near Lakeside Mall" },
    ]);
    expect(kept.map((s) => s.icon)).toEqual(["map"]);
  });
});
