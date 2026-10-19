import { describe, expect, it } from "vitest";
import { clearLegacyEngineChoice, rendererFor } from "./engineChoice";

describe("rendererFor", () => {
  it("routes three only for cesium + stylised", () => {
    expect(rendererFor("cesium", "stylised")).toBe("three");
    expect(rendererFor("cesium", "realistic")).toBe("cesium");
    expect(rendererFor("mapbox", "stylised")).toBe("mapbox");
    expect(rendererFor("list", "stylised")).toBe("list");
  });
});

describe("clearLegacyEngineChoice", () => {
  it("removes tl.engine and leaves other keys", () => {
    const m = new Map([
      ["tl.engine", "cesium"],
      ["other", "x"],
    ]);
    clearLegacyEngineChoice({ removeItem: (k: string) => void m.delete(k) });
    expect(m.has("tl.engine")).toBe(false);
    expect(m.get("other")).toBe("x");
  });
  it("tolerates a null or throwing store", () => {
    expect(() => clearLegacyEngineChoice(null)).not.toThrow();
    expect(() =>
      clearLegacyEngineChoice({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
