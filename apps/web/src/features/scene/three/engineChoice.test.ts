import { describe, expect, it } from "vitest";
import { readStylisedEngine, rendererFor } from "./engineChoice";

const memStore = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe("readStylisedEngine", () => {
  it("?engine=three wins and is persisted", () => {
    const mem = memStore();
    expect(readStylisedEngine("?engine=three", mem)).toBe("three");
    expect(mem.getItem("tl.engine")).toBe("three");
    expect(readStylisedEngine("", mem)).toBe("three");
  });
  it("defaults to cesium with an empty store", () => {
    expect(readStylisedEngine("", memStore())).toBe("cesium");
  });
  it("ignores a bogus value and writes nothing", () => {
    const mem = memStore();
    expect(readStylisedEngine("?engine=bogus", mem)).toBe("cesium");
    expect(mem.m.size).toBe(0);
  });
  it("survives a throwing store", () => {
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStylisedEngine("", bad)).toBe("cesium");
    expect(readStylisedEngine("?engine=three", bad)).toBe("three");
  });
});

describe("rendererFor", () => {
  it("routes three only for cesium + stylised + three", () => {
    expect(rendererFor("cesium", "stylised", "three")).toBe("three");
    expect(rendererFor("cesium", "realistic", "three")).toBe("cesium");
    expect(rendererFor("cesium", "stylised", "cesium")).toBe("cesium");
    expect(rendererFor("mapbox", "stylised", "three")).toBe("mapbox");
    expect(rendererFor("list", "stylised", "three")).toBe("list");
  });
});
