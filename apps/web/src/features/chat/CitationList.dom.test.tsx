// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CitationList } from "./CitationList";
import type { Citation } from "./chatReducer";

// Six distinct elements; the last two rest on demo (placeholder) evidence.
const citations: Citation[] = Array.from({ length: 6 }, (_, i) => ({
  type: "citation",
  ref: i + 1,
  element_id: `e${i + 1}`,
  attribute: "incline_pct",
  evidence_id: `ev-${i + 1}`,
  status: "verified",
  source_type: i >= 4 ? "team_survey_placeholder" : "survey",
}));
const names = new Map(citations.map((c) => [c.element_id, `Place ${c.element_id.slice(1)}`]));

const setup = (defaultExpanded = false) =>
  render(<CitationList citations={citations} names={names} defaultExpanded={defaultExpanded} />);

const HEADER = "Evidence · 6 sources · 2 demo values";

describe("CitationList summary", () => {
  it("is collapsed by default behind a summary that states source and demo counts", () => {
    setup();
    const btn = screen.getByRole("button", { name: HEADER });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Place 1")).not.toBeInTheDocument();
  });

  it("expands on click, flips aria-expanded, shows every source and the demo label, then collapses", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: HEADER }));
    expect(screen.getByRole("button", { name: HEADER })).toHaveAttribute("aria-expanded", "true");
    for (let i = 1; i <= 6; i++) expect(screen.getByText(`Place ${i}`)).toBeInTheDocument();
    expect(screen.getAllByText("Demo value · not surveyed").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: HEADER }));
    expect(screen.queryByText("Place 6")).not.toBeInTheDocument();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("expands from the keyboard (%s) after tabbing to the button", async (_n, key) => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(screen.getByRole("button", { name: HEADER })).toHaveFocus();
    await user.keyboard(key);
    expect(screen.getByText("Place 6")).toBeInTheDocument();
  });

  it("defaultExpanded opens it", () => {
    setup(true);
    expect(screen.getByText("Place 1")).toBeInTheDocument();
  });

  it("omits the demo count when no source is demo data", () => {
    render(<CitationList citations={citations.slice(0, 1)} names={names} />);
    expect(screen.getByRole("button", { name: "Evidence · 1 source" })).toBeInTheDocument();
  });
});
