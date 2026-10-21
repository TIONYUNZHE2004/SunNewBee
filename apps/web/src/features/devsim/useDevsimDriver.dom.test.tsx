// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDevsim } from "./devsimStore";
import provisional from "./fixtures/plan.provisional.json";
import type { DevelopmentPlan } from "./types";
import { useDevsimDriver } from "./useDevsimDriver";

const plan = provisional as unknown as DevelopmentPlan;
function Host() {
  useDevsimDriver();
  return null;
}
const d = () => useDevsim.getState();

describe("useDevsimDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    d().stop();
    d().start(plan, "brief");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("advances by real time while playing and not while paused", () => {
    render(<Host />);
    vi.advanceTimersByTime(500);
    expect(d().t).toBe(0);
    d().play();
    vi.advanceTimersByTime(1000);
    expect(d().t).toBeGreaterThan(0.85);
    expect(d().t).toBeLessThan(1.1);
    d().pause();
    const t = d().t;
    vi.advanceTimersByTime(1000);
    expect(d().t).toBe(t);
  });

  it("one loop however many components mount it; it ends at the total", () => {
    render(
      <>
        <Host />
        <Host />
      </>,
    );
    d().seek(65.5);
    d().play();
    vi.advanceTimersByTime(250);
    expect(d().t).toBeLessThan(65.85);
    vi.advanceTimersByTime(2000);
    expect(d().t).toBe(66);
    expect(d().playing).toBe(false);
  });
});
