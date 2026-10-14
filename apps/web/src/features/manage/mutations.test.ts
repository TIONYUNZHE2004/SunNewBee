import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onCreated, onResolved } from "./createVr";
import { createVR } from "./manageApi";

afterEach(() => vi.unstubAllGlobals());

describe("createVR", () => {
  it("POSTs the body with the staff token header and returns the result", async () => {
    const out = { request_id: "r", element_id: "e", attribute: "a", created: true, demand: 1 };
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(out), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await createVR({ target_id: "e", attribute: "a", reason: "unknown" }, "tok");
    expect(r.demand).toBe(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/verification-requests");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Staff-Token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({
      target_id: "e",
      attribute: "a",
      reason: "unknown",
    });
  });
  it("throws ApiError with status on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(createVR({ target_id: "e", attribute: "a" }, "")).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("invalidation", () => {
  const keys = (qc: QueryClient) => vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
  it("onCreated invalidates VR list and KPIs", async () => {
    const qc = new QueryClient();
    const spy = keys(qc);
    await onCreated(qc);
    const ks = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(ks).toContainEqual(["manage", "vrs"]);
    expect(ks).toContainEqual(["manage", "kpis"]);
  });
  it("onResolved invalidates VR list and KPIs", async () => {
    const qc = new QueryClient();
    const spy = keys(qc);
    await onResolved(qc);
    const ks = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(ks).toContainEqual(["manage", "vrs"]);
    expect(ks).toContainEqual(["manage", "kpis"]);
  });
});
