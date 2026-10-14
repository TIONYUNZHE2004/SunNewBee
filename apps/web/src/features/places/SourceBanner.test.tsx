import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { toPlaceView } from "./placeModel";
import { SourceBanner } from "./SourceBanner";

const view = (d: object) => toPlaceView({ ok: true, data: { id: "x", name: "X", ...d } });

describe("SourceBanner", () => {
  it("renders nothing for an access place", () => {
    expect(renderToStaticMarkup(<SourceBanner view={view({ type: "parking" })} />)).toBe("");
  });

  it("shows the candidate label prominently", () => {
    const html = renderToStaticMarkup(
      <SourceBanner view={view({ kind: "evac_centre", source: "osm_candidate" })} />,
    );
    expect(html).toContain("Candidate (OSM), not an official relief centre");
  });

  it("shows the official PPS label", () => {
    const html = renderToStaticMarkup(
      <SourceBanner view={view({ kind: "evac_centre", source: "official_pps" })} />,
    );
    expect(html).toContain("Official PPS");
    expect(html).not.toContain("Candidate");
  });

  it("shows waste status plus an MBSA link and no schedule", () => {
    const html = renderToStaticMarkup(
      <SourceBanner
        view={view({
          kind: "waste_point",
          status: "unknown",
          source_label: "Waste point: unknown",
        })}
      />,
    );
    expect(html).toContain("Waste point: unknown");
    expect(html).toContain("Collection day: unknown, ask MBSA");
    expect(html).toMatch(/<a [^>]*href="https:\/\/www\.mbsa\.gov\.my"/);
    expect(html).toContain("MBSA");
  });
});
