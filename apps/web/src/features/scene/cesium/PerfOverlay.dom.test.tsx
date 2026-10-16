// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useScene } from "../sceneStore";
import { PerfOverlay, SlowBanner, usePerfStats } from "./PerfOverlay";

afterEach(() => usePerfStats.getState().update({ slow: false }));

describe("PerfOverlay", () => {
  it("renders nothing without ?perf=1", () => {
    window.history.replaceState(null, "", "/");
    const { container } = render(<PerfOverlay />);
    expect(container.textContent).toBe("");
  });
  it("shows fps, frame time, draw calls and tier with ?perf=1", () => {
    window.history.replaceState(null, "", "/?perf=1");
    usePerfStats.getState().update({ fps: 42, frameMs: 23.8, drawCalls: 51, tier: "medium" });
    render(<PerfOverlay />);
    expect(screen.getByText(/42 fps/)).toBeInTheDocument();
    expect(screen.getByText(/51 draws/)).toBeInTheDocument();
    expect(screen.getByText(/medium/)).toBeInTheDocument();
  });
});

describe("SlowBanner", () => {
  it("is hidden until the map is slow", () => {
    const { container } = render(<SlowBanner />);
    expect(container.textContent).toBe("");
  });
  it("offers the list view and switches only on click", () => {
    useScene.getState().setView("cesium");
    usePerfStats.getState().update({ slow: true });
    render(<SlowBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "The 3D map is running slowly on this device.",
    );
    expect(useScene.getState().view).toBe("cesium");
    fireEvent.click(screen.getByRole("button", { name: "Use the list view" }));
    expect(useScene.getState().view).toBe("list");
  });
});
