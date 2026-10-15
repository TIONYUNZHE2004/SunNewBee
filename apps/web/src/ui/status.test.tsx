// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusChip } from "./StatusChip";
import { STATUS, type StatusKey } from "./status";

describe("status map", () => {
  const keys = Object.keys(STATUS) as StatusKey[];
  it("never uses banned words", () => {
    for (const k of keys) expect(STATUS[k].label).not.toMatch(/\bsafe\b|selamat|安全/i);
  });
  it("uses the required wording", () => {
    expect(STATUS.unchecked.label).toBe("Not checked yet");
    expect(STATUS.clear.label).toBe("No known barrier");
    expect(STATUS.gap.label).toBe("No mapped connection (data gap)");
    expect(STATUS.demo.label).toBe("Demo value · not surveyed");
    expect(STATUS.candidate.label).toMatch(/^Candidate/);
    expect(STATUS.likely.label).toMatch(/indicative/i);
    expect(STATUS.possibly.label).toMatch(/indicative/i);
  });
  it("every status has an icon and a label, so colour is never the only cue", () => {
    for (const k of keys) {
      expect(STATUS[k].icon.length).toBeGreaterThan(0);
      expect(STATUS[k].label.length).toBeGreaterThan(0);
    }
  });
  it("unverified statuses differ from verified by border style too", () => {
    expect(STATUS.unchecked.border).not.toBe(STATUS.verified.border);
    expect(STATUS.possibly.border).not.toBe(STATUS.likely.border);
  });
  it("renders icon aria-hidden and the label as text", () => {
    render(<StatusChip status="unchecked" />);
    const chip = screen.getByText("Not checked yet");
    expect(chip.closest(".chip-dashed")).not.toBeNull();
  });
  it("label override keeps the status cues", () => {
    render(<StatusChip status="verified" label="Verified 3 Oct 2026" />);
    expect(screen.getByText("Verified 3 Oct 2026")).toBeTruthy();
  });
});
