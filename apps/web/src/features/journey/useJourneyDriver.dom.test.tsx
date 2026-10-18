// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "./fixtures/demoPlan.json";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";
import { useJourneyDriver } from "./useJourneyDriver";

function Host() {
  useJourneyDriver();
  return null;
}
const j = () => useJourney.getState();
const total = () => j().timeline?.total ?? 0;

describe("useJourneyDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    j().clear();
    j().load(demo as unknown as JourneyPlan);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("advances by real time while playing and not while paused", () => {
    render(<Host />);
    vi.advanceTimersByTime(500);
    expect(j().t).toBe(0);
    j().play();
    vi.advanceTimersByTime(1000);
    expect(j().t).toBeGreaterThan(0.85);
    expect(j().t).toBeLessThan(1.1);
    j().pause();
    const t = j().t;
    vi.advanceTimersByTime(1000);
    expect(j().t).toBe(t);
  });

  it("schedules no frames while paused and resumes on play", () => {
    render(<Host />);
    expect(vi.getTimerCount()).toBe(0);
    j().play();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    j().pause();
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops at the end", () => {
    render(<Host />);
    j().seek(total() - 0.1);
    j().play();
    vi.advanceTimersByTime(2000);
    expect(j().t).toBe(total());
    expect(j().playing).toBe(false);
  });

  it("does not run while the tab is hidden and resumes without a jump", () => {
    render(<Host />);
    j().play();
    vi.advanceTimersByTime(200);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    const t = j().t;
    vi.advanceTimersByTime(30_000);
    expect(j().t).toBe(t);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(100);
    expect(j().t - t).toBeLessThan(0.3);
  });

  it("two mounted hosts still advance once per frame", () => {
    render(
      <>
        <Host />
        <Host />
      </>,
    );
    j().play();
    vi.advanceTimersByTime(1000);
    expect(j().t).toBeLessThan(1.1);
  });
});
