// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import type { AssetSpec, Manifest } from "../scene/three/assets/manifest";
import { useCityInfo } from "../scene/three/cityInfo";
import { BuildingCard, designHeightText, HEIGHT_LABELS } from "./BuildingCard";

const building = (id: string, props: Record<string, unknown>) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [] },
  properties: { id, kind: "residential", ...props },
});
const layer = {
  as_of: "2026-10-17",
  attribution: [],
  buildings: {
    type: "FeatureCollection",
    features: [
      building("b-tag", { archetype: "link_intermediate", display_height_source: "osm_height" }),
      building("b-lvl", { archetype: "bungalow", display_height_source: "osm_levels" }),
      building("b-arch", { archetype: "shop_office", display_height_source: "archetype_storeys" }),
      building("b-def", { archetype: "generic", display_height_source: "default" }),
      building("w1545153991", { archetype: "generic", display_height_source: "default" }),
      building("w1308938137", { archetype: "mall", display_height_source: "osm_levels" }),
    ],
  },
  landmarks: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
        properties: {
          id: "kanopi-residences",
          name: "Kanopi Residences",
          model: "kanopi",
          building_id: "w1545153991",
          source_url: "https://imagedelivery.net/x/plan/1920",
          source_label: "Sime Darby Property, Kanopi Residences facility plan",
          match: "traced_outline",
          as_of: "2026-10-18",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
        properties: {
          id: "elmina-lakeside-mall",
          name: "Elmina Lakeside Mall",
          model: "lakeside_mall",
          building_id: "w1308938137",
          source_url: "https://www.openstreetmap.org/way/1308938137",
          match: "building_name",
          as_of: "2026-10-17",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
        properties: {
          id: "bad-link",
          name: "Bad Link",
          model: "lakeside_mall",
          source_url: "javascript:alert(1)",
          match: "building_name",
          as_of: "2026-10-17",
        },
      },
    ],
  },
  parks: { type: "FeatureCollection", features: [] },
  water: { type: "FeatureCollection", features: [] },
  trees: { type: "FeatureCollection", features: [] },
};

const kanopiSpec = {
  group: "landmark",
  designStoreys: 36,
  heightBasis:
    "design height (36 storeys, Sime Darby Property), under construction; 36 x 3.2 m tower on an 8.7 m podium",
} as unknown as AssetSpec;
const manifest = {
  version: 1,
  as_of: "x",
  precinctGroups: [],
  assets: { kanopi: kanopiSpec, lakeside_mall: { group: "landmark" } as unknown as AssetSpec },
  landmarks: {},
} as Manifest;

function show(id: string, extruded: ReadonlySet<string> | null = new Set()) {
  const qc = newQueryClient();
  qc.setQueryData(["buildings"], layer);
  useCityInfo.setState({ manifest, extruded });
  useScene.getState().selectBuilding(id);
  return renderWithClient(<BuildingCard />, qc);
}

beforeEach(() => {
  useScene.getState().reset();
  useCityInfo.setState({ manifest: null, extruded: null });
});

describe("BuildingCard", () => {
  it.each([
    ["b-tag", "OSM height tag", "Link house"],
    ["b-lvl", "OSM building levels", "Bungalow"],
    ["b-arch", "Typical storeys for this type", "Shop office"],
    ["b-def", "Default estimate", "Building (no specific type)"],
  ])("%s: type, source and height label %s", (id, height, type) => {
    show(id);
    expect(screen.getByRole("heading", { name: "Building" })).toHaveFocus();
    expect(screen.getByText(`Building type: ${type}`)).toBeInTheDocument();
    expect(screen.getByText("Source: OSM · as of 2026-10-17")).toBeInTheDocument();
    expect(screen.getByText(`Height: ${height}`)).toBeInTheDocument();
    expect(screen.queryByText(/simple block/)).toBeNull();
  });

  it("the four height labels are fixed", () => {
    expect(HEIGHT_LABELS).toEqual({
      osm_height: "OSM height tag",
      osm_levels: "OSM building levels",
      archetype_storeys: "Typical storeys for this type",
      default: "Default estimate",
    });
  });

  it("a fallback (extruded) building says it is shown as a simple block", () => {
    show("b-tag", new Set(["b-tag"]));
    expect(screen.getByText("Building type: Link house (shown as a simple block)")).toBeVisible();
  });

  it("without city assets every building is a simple block", () => {
    show("b-lvl", null);
    expect(screen.getByText("Building type: Bungalow (shown as a simple block)")).toBeVisible();
  });

  it("a traced landmark shows its name, design height, match method and a safe source link", () => {
    show("kanopi-residences");
    expect(screen.getByRole("heading", { name: "Kanopi Residences" })).toHaveFocus();
    expect(screen.getByText("Landmark · matched by traced outline")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Height: design height (36 storeys, Sime Darby Property) · under construction",
      ),
    ).toBeInTheDocument();
    // never the podium's OSM default height, and never "Source: OSM" for a traced plan
    expect(screen.queryByText(/Default estimate/)).toBeNull();
    expect(screen.queryByText(/Source: OSM/)).toBeNull();
    expect(
      screen.getByText(
        "Source: Sime Darby Property, Kanopi Residences facility plan, as of 2026-10-18",
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open source/ });
    expect(link).toHaveAttribute("href", "https://imagedelivery.net/x/plan/1920");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("a building-name landmark says so and keeps its building's height label", () => {
    show("elmina-lakeside-mall");
    expect(screen.getByRole("heading", { name: "Elmina Lakeside Mall" })).toBeInTheDocument();
    expect(screen.getByText("Landmark · matched by building name")).toBeInTheDocument();
    expect(screen.getByText("Height: OSM building levels")).toBeInTheDocument();
    expect(screen.getByText("Source: www.openstreetmap.org, as of 2026-10-17")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open source/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/way/1308938137",
    );
  });

  it("draws no link for a non-http(s) landmark source", () => {
    show("bad-link");
    expect(screen.getByRole("heading", { name: "Bad Link" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when nothing is selected or the id is unknown", () => {
    const qc = newQueryClient();
    qc.setQueryData(["buildings"], layer);
    const { container, unmount } = renderWithClient(<BuildingCard />, qc);
    expect(container).toBeEmptyDOMElement();
    unmount();
    useScene.getState().selectBuilding("missing");
    expect(renderWithClient(<BuildingCard />, qc).container).toBeEmptyDOMElement();
  });

  it("closes with the button and with Escape", async () => {
    const user = userEvent.setup();
    show("b-tag");
    await user.click(screen.getByRole("button", { name: "Close building details" }));
    expect(useScene.getState().selectedBuildingId).toBeNull();
    useScene.getState().selectBuilding("b-tag");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(useScene.getState().selectedBuildingId).toBeNull();
  });
});

describe("designHeightText", () => {
  it("builds the line from heightBasis: its first clause, top-level commas as separators", () => {
    expect(designHeightText(kanopiSpec)).toBe(
      "design height (36 storeys, Sime Darby Property) · under construction",
    );
  });
  it("falls back to designStoreys, and is null without either", () => {
    expect(designHeightText({ designStoreys: 12 } as AssetSpec)).toBe("design height (12 storeys)");
    expect(designHeightText({} as AssetSpec)).toBeNull();
    expect(designHeightText(undefined)).toBeNull();
  });
});
