import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EvacuationLensSection,
  EvacuationSection,
  ListLensSections,
  WasteLensSection,
  WasteSection,
} from "./LensSections";

describe("list lens sections", () => {
  it("lists evacuation centres as buttons with source labels", () => {
    const html = renderToStaticMarkup(
      <EvacuationSection
        items={[
          {
            id: "evc-b",
            name: "Hall",
            sourceLabel: "Candidate (OSM), not an official relief centre",
          },
        ]}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Evacuation centres");
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>/);
    expect(html).toContain("Hall");
    expect(html).toContain("Candidate (OSM), not an official relief centre");
  });

  it("says so when there are no centres", () => {
    const html = renderToStaticMarkup(<EvacuationSection items={[]} onSelect={() => {}} />);
    expect(html).toContain("No evacuation centres");
  });

  it("lists waste points as buttons with status and no schedule", () => {
    const html = renderToStaticMarkup(
      <WasteSection
        items={[
          {
            id: "wp-1",
            name: "Bins",
            typeLabel: "Recycling drop off",
            statusLabel: "Status: unknown",
          },
        ]}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Waste points");
    expect(html).toContain("Bins");
    expect(html).toContain("Status: unknown");
    expect(html).not.toMatch(/Monday|Tuesday|every week/i);
  });
});

describe("lens gating", () => {
  const mounted = (flood: boolean, waste: boolean) => {
    const el = ListLensSections({ flood, waste }) as { props: { children: unknown[] } };
    return el.props.children.filter(Boolean).map((c) => (c as { type: unknown }).type);
  };
  it("mounts each section only with its lens", () => {
    expect(mounted(false, false)).toEqual([]);
    expect(mounted(true, false)).toEqual([EvacuationLensSection]);
    expect(mounted(false, true)).toEqual([WasteLensSection]);
    expect(mounted(true, true)).toEqual([EvacuationLensSection, WasteLensSection]);
  });
});
