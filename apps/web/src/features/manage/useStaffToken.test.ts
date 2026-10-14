import { beforeEach, describe, expect, it } from "vitest";
import { useStaffTokenStore } from "./useStaffToken";

describe("staff token store", () => {
  beforeEach(() => useStaffTokenStore.getState().setToken(""));
  it("is one shared value: a set from one consumer is visible to another immediately", () => {
    const a = useStaffTokenStore.getState();
    a.setToken("abc");
    expect(useStaffTokenStore.getState().token).toBe("abc");
  });
  it("notifies subscribers", () => {
    let seen = "";
    const un = useStaffTokenStore.subscribe((s) => {
      seen = s.token;
    });
    useStaffTokenStore.getState().setToken("xyz");
    un();
    expect(seen).toBe("xyz");
  });
});
