// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { FloodNote } from "./FloodNote";

const scenarios = [
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "Indicative only", links: [] },
];

// The API client builds a Request with a relative URL, which jsdom rejects; seed the cache instead.
function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], scenarios);
  return qc;
}

beforeEach(() => useScene.getState().reset());

describe("FloodNote", () => {
  it("renders nothing when no flood level is on", () => {
    renderWithClient(<FloodNote />, seeded());
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("says indicative, not a forecast, links MBSA/JPS/NADMA, never 'safe' or a depth", async () => {
    useScene.getState().setScenario("stage_p3m");
    renderWithClient(<FloodNote />, seeded());
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(/indicative scenario, not a forecast/i);
    for (const n of ["MBSA", "JPS", "NADMA"])
      expect(screen.getByRole("link", { name: new RegExp(n) })).toHaveAttribute("href");
    expect(note.className.split(" ")).not.toContain("absolute");
    expect(note.className).not.toMatch(/(^|\s)top-/);
    expect(note.textContent).not.toMatch(/\bsafe\b|depth|metres deep/i);
  });
});
