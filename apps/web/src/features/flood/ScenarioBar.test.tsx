import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScenarioButtons, shortLabel } from "./ScenarioBar";

describe("ScenarioButtons", () => {
  it("shortens labels and keeps full accessible names", () => {
    expect(shortLabel("River +3 m (indicative)")).toBe("+3 m");
    expect(shortLabel("Odd label")).toBe("Odd label");
    const html = renderToStaticMarkup(
      <ScenarioButtons
        scenarios={[{ id: "p1", label: "River +1 m (indicative)" }]}
        scenarioId={null}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('aria-label="River +1 m (indicative)"');
    expect(html).toContain('aria-label="Normal"');
    expect(html).toMatch(/sm:hidden[^>]*>\+1 m</);
    expect(html).toMatch(/hidden sm:inline[^>]*>River \+1 m \(indicative\)</);
  });
});
