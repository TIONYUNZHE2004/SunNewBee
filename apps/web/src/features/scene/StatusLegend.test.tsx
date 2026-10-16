import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusLegend } from "./StatusLegend";

describe("StatusLegend", () => {
  it("each label has a line sample whose dash pattern matches its border style", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("No known barrier");
    expect(html).toContain("Not checked yet");
    expect(html).toMatch(/stroke-dasharray="6 4"/); // dashed (Not checked yet)
    expect(html).toMatch(/stroke-dasharray="1.5 3.5"/); // dotted (Not passable)
  });
});
