// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { ClosurePanel } from "./ClosurePanel";
import { SIM_RESULT } from "./fixtures";

const access = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "seg-ab", name: "Persiaran Garcinia", type: "street" },
      geometry: {
        type: "LineString",
        coordinates: [
          [101.5, 3.1],
          [101.51, 3.1],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "seg-bc", name: "Persiaran Tamarind", type: "street" },
      geometry: {
        type: "LineString",
        coordinates: [
          [101.51, 3.1],
          [101.51, 3.11],
        ],
      },
    },
  ],
};

function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(["layer", "access", "default", null], access);
  return qc;
}

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => useScene.getState().reset());
afterEach(() => vi.unstubAllGlobals());

async function openAndFill() {
  const user = userEvent.setup();
  renderWithClient(<ClosurePanel />, seeded());
  await user.click(screen.getByRole("button", { name: /Road closures/ }));
  await user.type(screen.getByLabelText(/Road or stretch/), "Persiaran Garcinia");
  return user;
}

describe("ClosurePanel (T-027)", () => {
  it("runs the request and shows the result with pressure for managers", async () => {
    const fetchMock = reply(200, SIM_RESULT);
    vi.stubGlobal("fetch", fetchMock);
    const user = await openAndFill();
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    const card = await screen.findByTestId("closure-result");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/closures/simulate");
    expect(JSON.parse(String(init.body))).toMatchObject({
      reason: "works",
      closures: [{ road_names: ["Persiaran Garcinia"] }],
    });
    expect(card).toHaveTextContent("7 of 63 sample trips change route");
    expect(card).toHaveTextContent("3 trips newly without a mapped route");
    expect(card).toHaveTextContent("data gaps, not the closure");
    expect(card).toHaveTextContent("High detour pressure");
    expect(card).toHaveTextContent("Review signposting the detour via Jalan Dillenia");
    // the basis in plain words for managers, never the engine's raw field path
    expect(card).toHaveTextContent("Based on: 8 weighted sample trips on Persiaran Tamarind");
    expect(card.textContent).not.toContain("detour_roads[");
    // the marshal suggestion the engine repeated once per stretch shows once
    expect(card.textContent?.match(/Consider a marshal/g)).toHaveLength(1);
    expect(card).toHaveTextContent("not traffic counts");
    expect(card).toHaveTextContent("Peak weights are an assumed travel pattern, not measured.");
    expect(card.textContent).not.toMatch(/\bsafe\b|minutes? of delay|vehicles/i);
    // the map gets the course in red and the detour by pressure
    const sim = useScene.getState().closureSim?.geojson.features as {
      properties: Record<string, string>;
    }[];
    expect(sim.map((f) => f.properties)).toEqual([
      { closure: "course" },
      { closure: "detour", pressure: "high" },
    ]);
  });

  it("says plainly when the backend has not landed", async () => {
    vi.stubGlobal("fetch", reply(404, { detail: "Not Found" }));
    const user = await openAndFill();
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Closure simulation is not available on this server yet.",
    );
    expect(screen.queryByTestId("closure-result")).toBeNull();
  });

  it("asks for a road before simulating, and can add a second closure", async () => {
    const fetchMock = reply(200, SIM_RESULT);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithClient(<ClosurePanel />, seeded());
    await user.click(screen.getByRole("button", { name: /Road closures/ }));
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name a road or a stretch");
    await user.click(screen.getByRole("button", { name: "Add closure" }));
    expect(screen.getByLabelText(/closure 2/)).toBeVisible();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
