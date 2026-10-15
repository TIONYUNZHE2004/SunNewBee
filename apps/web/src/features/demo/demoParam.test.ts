import { describe, expect, it } from "vitest";
import { parseDemoParam } from "./demoParam";

describe("parseDemoParam", () => {
  it("accepts demo=hero", () => {
    expect(parseDemoParam("?demo=hero")).toBe("hero");
    expect(parseDemoParam("?x=1&demo=hero")).toBe("hero");
  });
  it("ignores everything else", () => {
    expect(parseDemoParam("")).toBeNull();
    expect(parseDemoParam("?demo=")).toBeNull();
    expect(parseDemoParam("?demo=other")).toBeNull();
    expect(parseDemoParam("?replay=hero")).toBeNull();
  });
});
