// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CitationList } from "./CitationList";
import type { Citation } from "./chatReducer";

// Six distinct elements: four are shown, two hide behind the toggle.
const citations: Citation[] = Array.from({ length: 6 }, (_, i) => ({
  type: "citation",
  ref: i + 1,
  element_id: `e${i + 1}`,
  attribute: "incline_pct",
  evidence_id: `ev-${i + 1}`,
  status: "verified",
  source_type: "survey",
}));
const names = new Map(citations.map((c) => [c.element_id, `Place ${c.element_id.slice(1)}`]));

const setup = () => render(<CitationList citations={citations} names={names} />);

describe("CitationList toggle", () => {
  it("shows four sources and a collapsed 'Show 2 more sources' button", () => {
    setup();
    expect(screen.getByText("Place 4")).toBeInTheDocument();
    expect(screen.queryByText("Place 5")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Show 2 more sources" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("expands on click, flips aria-expanded, and collapses again", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Show 2 more sources" }));
    const btn = screen.getByRole("button", { name: "Show fewer sources" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Place 5")).toBeInTheDocument();
    expect(screen.getByText("Place 6")).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByText("Place 6")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 2 more sources" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("expands from the keyboard (%s) after tabbing to the button", async (_n, key) => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    const btn = screen.getByRole("button", { name: "Show 2 more sources" });
    expect(btn).toHaveFocus();
    await user.keyboard(key);
    expect(screen.getByText("Place 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer sources" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders no toggle when everything already fits", () => {
    render(<CitationList citations={citations.slice(0, 4)} names={names} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
