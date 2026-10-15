import { describe, expect, it } from "vitest";
import { fetchBuildings } from "./api";

const res = (status: number, body: unknown = {}) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("fetchBuildings", () => {
  it("returns the payload on 200", async () => {
    const payload = {
      buildings: { type: "FeatureCollection", features: [] },
      trees: { type: "FeatureCollection", features: [] },
      as_of: "2026-10-16",
      attribution: ["OSM"],
    };
    expect(await fetchBuildings(res(200, payload))).toEqual(payload);
  });

  it("returns null on 404 and never throws", async () => {
    expect(await fetchBuildings(res(404, { detail: "no" }))).toBeNull();
  });

  it("throws on other failures", async () => {
    await expect(fetchBuildings(res(502))).rejects.toThrow(/502/);
  });
});
