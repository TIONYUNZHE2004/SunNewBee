// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import type { AssistantMessage } from "../chat/chatReducer";
import { useScene } from "../scene/sceneStore";
import { RouteSummary } from "./RouteSummary";

const eff = vi.hoisted(() => ({ view: "cesium" }));
// Show on map only does something in the 3D view, so these tests run "on" Cesium by default.
vi.mock("../scene/useMapStyle", async (orig) => ({
  ...(await orig<typeof import("../scene/useMapStyle")>()),
  useEffectiveView: () => eff.view,
}));

const demoCite = {
  type: "citation",
  ref: 1,
  evidence_id: "e1",
  element_id: "seg-1",
  attribute: "step_count",
  status: "reported",
  source_type: "team_survey_placeholder",
};
const base: AssistantMessage = {
  role: "assistant",
  id: "a",
  text: "x",
  draft: "",
  draftAttempt: 0,
  checks: [],
  done: true,
  vrs: [],
  tools: [],
  citations: [],
};
const line = (id: string) => ({ id, geojson: { type: "LineString" as const, coordinates: [] } });
const DEMO = /Demo value · not surveyed/;

describe("RouteSummary", () => {
  beforeEach(() => {
    useScene.setState({ route: null });
    eff.view = "cesium";
    stubFetch(() => json([]));
  });

  it("flood-only strip with a placeholder citation shows the demo chip", async () => {
    // The API client builds relative-URL Requests jsdom rejects; seed the cache instead.
    const qc = newQueryClient();
    qc.setQueryData(["scenarios"], [{ id: "stage_p3m", stage_m: 3 }]);
    renderWithClient(
      <RouteSummary m={{ ...base, scenarioId: "stage_p3m", citations: [demoCite] as never }} />,
      qc,
    );
    expect(await screen.findByText("River +3 m · indicative")).toBeInTheDocument();
    expect(screen.getByText(DEMO)).toBeInTheDocument();
  });

  it("with neither route nor flood, a placeholder citation still renders just the demo chip", () => {
    const { container } = renderWithClient(
      <RouteSummary m={{ ...base, citations: [demoCite] as never }} />,
    );
    expect(screen.getByText(DEMO)).toBeInTheDocument();
    expect(container.querySelectorAll(".chip")).toHaveLength(1);
  });

  it("renders nothing without route, flood or demo evidence", () => {
    const { container } = renderWithClient(<RouteSummary m={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Show on map only appears on the card whose route is the scene's current route", () => {
    const m = { ...base, route: { id: "r1", status: "confirmed" } };
    useScene.setState({ route: line("r2") });
    const first = renderWithClient(<RouteSummary m={m} />);
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
    first.unmount();
    useScene.setState({ route: line("r1") });
    renderWithClient(<RouteSummary m={m} />);
    expect(screen.getByRole("button", { name: "Show on map" })).toBeInTheDocument();
  });

  it.each(["list", "mapbox"])("Show on map is not offered in the %s view", (view) => {
    eff.view = view;
    useScene.setState({ route: line("r1") });
    renderWithClient(<RouteSummary m={{ ...base, route: { id: "r1", status: "confirmed" } }} />);
    expect(screen.getByText("No known barrier")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
  });
});
