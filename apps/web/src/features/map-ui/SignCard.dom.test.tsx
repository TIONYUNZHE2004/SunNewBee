// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { SignCard } from "./SignCard";

const layer = {
  buildings: { type: "FeatureCollection", features: [] },
  trees: { type: "FeatureCollection", features: [] },
  signage: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [101.5, 3.18] },
        properties: {
          id: "sign-1",
          text: "Central Mart",
          building_id: "b1",
          source_url: "https://www.openstreetmap.org/way/203237462",
          source_label: "OpenStreetMap",
          as_of: "2026-10-17",
        },
      },
    ],
  },
};

function setup() {
  const qc = newQueryClient();
  qc.setQueryData(["buildings"], layer);
  useScene.getState().selectSign("sign-1");
  return renderWithClient(<SignCard />, qc);
}

beforeEach(() => useScene.getState().reset());

describe("SignCard", () => {
  it("shows the text, the source line and a safe external link", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Central Mart" })).toHaveFocus();
    expect(screen.getByText("Source: OpenStreetMap, as of 2026-10-17")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open source/ });
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/way/203237462");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("draws no link for a non-http(s) source_url, but keeps the text and source line", () => {
    const qc = newQueryClient();
    const bad = structuredClone(layer);
    bad.signage.features[0]!.properties.source_url = "javascript:alert(1)";
    qc.setQueryData(["buildings"], bad);
    useScene.getState().selectSign("sign-1");
    renderWithClient(<SignCard />, qc);
    expect(screen.getByRole("heading", { name: "Central Mart" })).toBeInTheDocument();
    expect(screen.getByText(/^Source: OpenStreetMap/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when no sign is selected or the sign is unknown", () => {
    const qc = newQueryClient();
    qc.setQueryData(["buildings"], layer);
    const { container, unmount } = renderWithClient(<SignCard />, qc);
    expect(container).toBeEmptyDOMElement();
    unmount();
    useScene.getState().selectSign("missing");
    const again = renderWithClient(<SignCard />, qc);
    expect(again.container).toBeEmptyDOMElement();
  });

  it("closes with the button and with Escape", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Close sign details" }));
    expect(useScene.getState().selectedSignId).toBeNull();
    useScene.getState().selectSign("sign-1");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(useScene.getState().selectedSignId).toBeNull();
  });

  it("is mutually exclusive with the place and path cards", () => {
    useScene.getState().selectSign("sign-1");
    useScene.getState().selectPlace("p1");
    expect(useScene.getState().selectedSignId).toBeNull();
    useScene.getState().selectSign("sign-1");
    expect(useScene.getState().selectedPlaceId).toBeNull();
    useScene.getState().selectFloodEdge("e1");
    expect(useScene.getState().selectedSignId).toBeNull();
    useScene.getState().selectSign("sign-1");
    expect(useScene.getState().selectedFloodEdgeId).toBeNull();
  });
});
