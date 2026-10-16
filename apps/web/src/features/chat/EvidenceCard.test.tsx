import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CitationList } from "./CitationList";
import type { Citation } from "./chatReducer";
import { EvidenceCard } from "./EvidenceCard";

const base: Citation = {
  type: "citation",
  ref: 1,
  evidence_id: "e1",
  element_id: "pl-1",
  attribute: "step_count",
  status: "verified",
  verified_at: "2026-01-02T00:00:00Z",
};
const names = new Map([["pl-1", "Mall"]]);

describe("EvidenceCard", () => {
  it("shows placeholders as demo values, not verified", () => {
    const html = renderToStaticMarkup(
      <EvidenceCard
        element_id="pl-1"
        title="Mall"
        citations={[{ ...base, source_type: "team_survey_placeholder" }]}
      />,
    );
    expect(html).toContain("Demo value · not surveyed");
    expect(html).not.toContain("✓");
    expect(html).not.toContain("verified");
    expect(html).not.toContain("checked");
  });
  it("leaves other statuses unchanged", () => {
    const html = renderToStaticMarkup(
      <EvidenceCard element_id="pl-1" title="Mall" citations={[base]} />,
    );
    expect(html).toContain("✓");
    expect(html).toContain("verified");
    expect(html).toContain("checked 2026-01-02");
    expect(html).toContain("[1]");
    expect(html).toContain("Step count");
  });
});

describe("CitationList", () => {
  const cs = Array.from({ length: 41 }, (_, i) => ({
    ...base,
    ref: i + 1,
    element_id: `seg-${i % 15}`,
  }));
  it("shows no cards and a collapsed summary header", () => {
    const html = renderToStaticMarkup(<CitationList citations={cs} names={names} />);
    expect(html.match(/<li data-evidence-card/g)).toBeNull();
    expect(html).toContain("Evidence · 15 sources");
    expect(html).toContain('aria-expanded="false"');
  });
  it("shows all 15 when expanded", () => {
    const html = renderToStaticMarkup(
      <CitationList citations={cs} names={names} defaultExpanded />,
    );
    expect(html.match(/<li data-evidence-card/g)).toHaveLength(15);
    expect(html).toContain('aria-expanded="true"');
  });
});

describe("EvidenceCard photo", () => {
  it("shows a thumbnail with alt text and a full-image link when there is a photo", () => {
    const html = renderToStaticMarkup(
      <EvidenceCard
        element_id="pl-1"
        title="Mall"
        citations={[{ ...base, source_type: "site_visit", photo_url: "/evidence/ab12" }]}
      />,
    );
    expect(html).toContain('src="/api/evidence/ab12"');
    expect(html).toContain('alt="Photo evidence for Mall · Step count"');
    expect(html).toContain('href="/api/evidence/ab12"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("site_visit");
    expect(html).toContain("checked 2026-01-02");
  });
  it("renders as before without a photo", () => {
    const html = renderToStaticMarkup(
      <EvidenceCard element_id="pl-1" title="Mall" citations={[base]} />,
    );
    expect(html).not.toContain("<img");
  });
  it("keeps the demo label on placeholder evidence, even with a photo", () => {
    const html = renderToStaticMarkup(
      <EvidenceCard
        element_id="pl-1"
        title="Mall"
        citations={[
          { ...base, source_type: "team_survey_placeholder", photo_url: "/evidence/ab12" },
        ]}
      />,
    );
    expect(html).toContain("Demo value · not surveyed");
    expect(html).not.toContain("checked 2026");
  });
});
