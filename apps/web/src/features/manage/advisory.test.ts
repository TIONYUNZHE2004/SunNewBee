import { describe, expect, it } from "vitest";
import { buildAdvisory, LANGS } from "./advisory";

const input = { scenarioLabel: "+3 m", likely: 4, possible: 2 };

describe("buildAdvisory", () => {
  for (const { id } of LANGS) {
    it(`${id}: carries disclaimer + guidance, no safety claims`, () => {
      const t = buildAdvisory(id, input);
      expect(t).toContain("indicative scenario, not a forecast");
      expect(t).toContain("MBSA / JPS / NADMA");
      expect(t).toMatch(/follow official|ikut panduan rasmi|官方指引/);
      expect(t).toContain("4");
      expect(t.toLowerCase()).not.toMatch(/\bsafe\b|selamat|安全/);
    });
  }
});
