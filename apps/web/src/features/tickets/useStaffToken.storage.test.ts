// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("useStaffToken with blocked sessionStorage", () => {
  it("creates the store and keeps the token in memory when storage throws", async () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.resetModules();
    const { useStaffTokenStore } = await import("./useStaffToken");
    expect(useStaffTokenStore.getState().token).toBe("");
    expect(() => useStaffTokenStore.getState().setToken("abc")).not.toThrow();
    expect(useStaffTokenStore.getState().token).toBe("abc");
  });
});
