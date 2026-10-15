import { describe, expect, it } from "vitest";
import { HERO_SCRIPT } from "./heroScript";

describe("HERO_SCRIPT honesty", () => {
  const captions = HERO_SCRIPT.map((s) => s.caption).join("\n");
  it("never says safe or claims verification", () => {
    expect(captions).not.toMatch(/\bsafe\b|selamat|安全/i);
    // "Not checked yet" is the UI's own gap label, so quoting it is fine.
    expect(captions.replaceAll("“Not checked yet”", "")).not.toMatch(/\bverified\b|\bchecked\b/i);
  });
  it("never states a depth", () => {
    expect(captions).not.toMatch(/\bdepth\b|\bdeep\b/i);
  });
  it("keeps the hero questions", () => {
    const asks = HERO_SCRIPT.flatMap((s) => (s.action.kind === "ask" ? [s.action.text] : []));
    expect(asks).toEqual([
      "Can I get to the lakeside mall with a stroller?",
      "Where is the nearest evacuation centre if the water rises 3 m?",
    ]);
  });
});
