import { describe, expect, it } from "vitest";
import { failureBurst } from "./failureBurst";

describe("failureBurst", () => {
  it("ignores isolated tile failures", () => {
    const hit = failureBurst(10, 30_000);
    for (let i = 0; i < 9; i++) expect(hit(i * 1000)).toBe(false);
  });
  it("trips once a burst reaches the threshold inside the window", () => {
    const hit = failureBurst(3, 30_000);
    expect(hit(0)).toBe(false);
    expect(hit(1000)).toBe(false);
    expect(hit(2000)).toBe(true);
  });
  it("forgets failures older than the window", () => {
    const hit = failureBurst(3, 10_000);
    hit(0);
    hit(1000);
    expect(hit(20_000)).toBe(false);
  });
});
