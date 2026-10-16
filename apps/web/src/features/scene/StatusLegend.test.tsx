import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusLegend } from "./StatusLegend";
import { type EdgeStatus, statusStyle } from "./styles";

const lineFor = (html: string, label: string) => {
  const end = html.indexOf(`</line></svg>${label}`);
  if (end < 0) throw new Error(`no sample for ${label}`);
  return html.slice(html.lastIndexOf("<line", end), end);
};

describe("StatusLegend", () => {
  const html = renderToStaticMarkup(<StatusLegend />);
  it("lists the statuses", () => {
    expect(html).toContain("No known barrier");
    expect(html).toContain("Not checked yet");
  });
  it("dashed and dotted samples use butt caps so gaps stay visible", () => {
    expect(lineFor(html, "Not checked yet")).toContain('stroke-linecap="butt"');
    expect(lineFor(html, "Not passable")).toContain('stroke-linecap="butt"');
    expect(lineFor(html, "Not checked yet")).toContain('stroke-dasharray="6 4"');
    expect(lineFor(html, "Not passable")).toContain('stroke-dasharray="2 3"');
    expect(lineFor(html, "No known barrier")).not.toContain("stroke-dasharray");
  });
  it("each sample keeps the width and colour defined in styles.ts", () => {
    const all: EdgeStatus[] = ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"];
    for (const k of all) {
      const st = statusStyle(k);
      const l = lineFor(html, st.label);
      expect(l).toContain(`stroke-width="${Math.min(st.width, 7)}"`);
      expect(l).toContain(`stroke="${st.color}"`);
    }
  });
});
