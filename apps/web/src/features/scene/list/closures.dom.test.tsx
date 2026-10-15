// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "../../../test/helpers";
import { PlaceCard } from "../../places/PlaceCard";
import { toPlaceView } from "../../places/placeModel";
import { useScene } from "../sceneStore";
import { ListView } from "./ListView";
import { parseLayer } from "./listModel";

const LABEL = "Closed: works until 2026-10-20";
const closure = {
  id: "cl-0001",
  element_id: "seg-ab",
  element_name: "Lakeside path",
  element_kind: "edge",
  reason: "works",
  starts_at: "2026-10-15T00:00:00Z",
  ends_at: "2026-10-20T00:00:00Z",
  note: null,
  label: LABEL,
  source_label: "Reported closure (staff)",
  active: true,
};
const layer = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: {
        id: "seg-ab",
        type: "footway",
        name: "Lakeside path",
        status_for_profile: "blocked",
        closed: true,
        closure_label: LABEL,
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {
        id: "toilet-1",
        kind: "place",
        type: "toilet",
        name: "Park toilet",
        closed: true,
        closure_label: LABEL,
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [1, 1] },
      properties: { id: "kiosk", kind: "place", type: "kiosk", name: "Park kiosk" },
    },
  ],
};

// The generated client binds fetch when it is created, so stubbing fetch cannot reach it:
// replace the data hooks instead.
const state = vi.hoisted(() => ({
  layer: null as unknown,
  closures: [] as unknown[],
  place: null as unknown,
}));
const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: () => {} });
vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  useLayer: () => ok(state.layer),
  useScenarios: () => ok([]),
  useClosures: () => ok(state.closures),
  usePlace: () => ok(state.place),
}));

beforeEach(() => {
  useScene.getState().reset();
  state.layer = layer;
  state.closures = [closure];
  state.place = null;
});

describe("closure parsing", () => {
  it("reads closed edges and places from the access layer", () => {
    const { edges, places } = parseLayer(layer);
    expect(edges[0]).toMatchObject({ status: "blocked", closure: LABEL });
    expect(places.find((p) => p.id === "toilet-1")?.closure).toBe(LABEL);
    expect(places.find((p) => p.id === "kiosk")?.closure).toBeUndefined();
  });

  it("reads active place closures from place details", () => {
    const v = toPlaceView({
      ok: true,
      data: {
        id: "toilet-1",
        name: "Park toilet",
        type: "toilet",
        claims: {},
        closures: [closure],
      },
    });
    expect(v?.closures).toEqual([
      {
        label: LABEL,
        line: `Reported closure (staff): ${LABEL} (reported from 2026-10-15)`,
        note: null,
      },
    ]);
    expect(
      toPlaceView({ ok: true, data: { id: "k", name: "K", type: "kiosk" } })?.closures,
    ).toEqual([]);
  });
});

describe("list view", () => {
  it("shows the closures section, a Closed tag on the place, and Closed on a route step", async () => {
    useScene.setState({
      route: {
        id: "rt-1",
        geojson: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
    });
    renderWithClient(
      <MemoryRouter>
        <ListView />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Closed paths and places" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Reported closure (staff): ${LABEL} (reported from 2026-10-15)`),
    ).toBeInTheDocument();
    const toilet = screen.getByRole("button", { name: /Park toilet/ });
    expect(toilet).toHaveTextContent("Closed");
    expect(screen.getByRole("button", { name: /Park kiosk/ })).not.toHaveTextContent("Closed");
    const step = (await screen.findByText("1.")).closest("li");
    expect(step).toHaveTextContent("Lakeside path");
    expect(step).toHaveTextContent("Closed");
    expect(step).toHaveTextContent("Not passable");
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/\bsafe\b/);
  });

  it("hides the section when nothing is closed", async () => {
    state.closures = [];
    renderWithClient(
      <MemoryRouter>
        <ListView />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Places" });
    expect(
      screen.queryByRole("heading", { name: "Closed paths and places" }),
    ).not.toBeInTheDocument();
  });
});

describe("place card", () => {
  it("shows a Closed banner with the staff source and date", async () => {
    state.place = {
      ok: true,
      data: {
        id: "toilet-1",
        name: "Park toilet",
        type: "toilet",
        claims: {},
        closures: [closure],
      },
      evidence: [],
    };
    useScene.getState().selectPlace("toilet-1");
    renderWithClient(
      <MemoryRouter>
        <PlaceCard />
      </MemoryRouter>,
    );
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Closed");
    expect(banner).toHaveTextContent("Reported closure (staff)");
    expect(banner).toHaveTextContent("2026-10-20");
  });
});
