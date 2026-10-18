import { describe, expect, it } from "vitest";
import { BOOKMARKS, bookmarkFromSearch, DEFAULT_BOOKMARK } from "./bookmarks";

describe("bookmarks", () => {
  it("parses the bookmark query param", () => {
    expect(bookmarkFromSearch("?bookmark=hero-near")).toBe("hero-near");
    expect(bookmarkFromSearch("?bookmark=nope")).toBeNull();
    expect(bookmarkFromSearch("")).toBeNull();
  });
  it("holds the gate values", () => {
    expect(BOOKMARKS["hero-mid"].rangeM).toBe(800);
    expect(BOOKMARKS["hero-near"]).toMatchObject({ rangeM: 150, pitchDeg: -40, headingDeg: 0 });
    expect(BOOKMARKS.township).toMatchObject({
      centre: [101.5099, 3.1813],
      rangeM: 7000,
      pitchDeg: -55,
    });
    expect(DEFAULT_BOOKMARK).toBe("hero-mid");
  });
});
