import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFloodStory } from "./floodStoryData";

function server({
  searchOk = true,
  routeId = "route",
  journeyStatus = 200,
  missingStage = false,
} = {}) {
  const stages = ["baseline", "stage_p1m", "stage_p2m", "stage_p3m"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://township.test").pathname;
      const response = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (path === "/api/scenarios")
        return response(stages.map((id, stage_m) => ({ id, stage_m, kind: "river_stage" })));
      if (path === "/api/scenarios/stage_p2m" && missingStage) return response({}, 404);
      if (path.includes("/scenarios/"))
        return response(
          path.endsWith("/affected")
            ? { flooded_places: [], cut_off_places: [], flooded_path_m: 0 }
            : { type: "FeatureCollection", features: [] },
        );
      if (path === "/api/places")
        return response({
          ok: searchOk,
          data: [{ id: "home", name: "Pangsapuri Cendana", type: "residential" }],
        });
      if (path === "/api/evacuation-centres")
        return response([
          {
            centre: { id: "hall", name: "Hall", source: "osm_candidate" },
            reachable: true,
            distance_m: 358.7,
            route_status: "partly_unverified",
          },
        ]);
      if (path === "/api/journeys")
        return response(
          journeyStatus === 409
            ? { route_status: "no_data", message: "No mapped connection (data gap)." }
            : {
                route_id: routeId,
                profile: "wheelchair",
                pace_m_per_s: 1,
                polyline: [
                  [101, 3],
                  [101.001, 3],
                ],
                spans: [[0, 100, "UNKNOWN"]],
                events: [],
              },
          journeyStatus,
        );
      if (path === "/api/routes") {
        const body = JSON.parse(String(init?.body));
        expect(body.profile).toBe("wheelchair");
        return response({
          status: "partly_unverified",
          routes: [
            {
              id: "route",
              profile: "wheelchair",
              from_place: "home",
              to_place: "__centre__hall",
              scenario_id: body.scenario_id,
            },
          ],
        });
      }
      throw new Error(`Unexpected test URL ${path}`);
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
const load = () => loadFloodStory(new AbortController().signal);

describe("river story API evidence binding", () => {
  it("keeps the honest mapped candidate when journey and route identify the same trip", async () => {
    server();
    const story = await load();
    expect(story.resident?.centre.centre.source).toBe("osm_candidate");
    expect(story.residentGap).toBeNull();
  });
  it("does not use a place result whose tool reports failure", async () => {
    server({ searchOk: false });
    const story = await load();
    expect(story.resident).toBeNull();
    expect(story.residentGap).toMatch(/could not be checked/);
  });
  it("does not bind another route's metadata to the displayed hero", async () => {
    server({ routeId: "different-route" });
    const story = await load();
    expect(story.resident).toBeNull();
    expect(story.residentGap).toMatch(/changed while loading/);
  });
  it("keeps a missing connection as no data and leaves the river stages available", async () => {
    server({ journeyStatus: 409 });
    const story = await load();
    expect(story.stages).toHaveLength(4);
    expect(story.resident).toBeNull();
    expect(story.residentGap).toBe("No mapped connection (data gap).");
  });
  it("fails a missing stage instead of replacing it with a normal/zero stage", async () => {
    server({ missingStage: true });
    await expect(load()).rejects.toThrow(/data is unavailable/);
  });
});
