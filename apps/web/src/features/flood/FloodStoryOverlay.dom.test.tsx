// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { assertHonest } from "../../test/honesty";
import { usePanel } from "../main/panelStore";
import { FloodStoryOverlay } from "./FloodStoryOverlay";
import type { FloodStory } from "./floodStoryData";
import { useFloodStory } from "./floodStoryStore";
import { RESIDENT_AT } from "./floodTimeline";

const story = {
  stages: [2, 1, 6, 0].map((count, index) => ({
    scenario: { id: `stage-${index}`, stage_m: index },
    water: null,
    affected: {
      flooded_places: Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        name: `Place ${i}`,
        type: "park",
        lonlat: [101, 3],
      })),
      cut_off_places: [],
      flooded_path_m: 1500 * index,
    },
  })),
  resident: null,
  residentGap: "No mapped connection (data gap).",
} as unknown as FloodStory;

afterEach(() => act(() => useFloodStory.getState().close()));

describe("river playback UI", () => {
  it("lets each viewpoint seek the same timeline while preserving pause and honest gaps", () => {
    useFloodStory.getState().load(story);
    render(<FloodStoryOverlay />);
    const river = screen.getByRole("button", { name: "River rise" });
    const buildings = screen.getByRole("button", { name: "Building edge" });
    const resident = screen.getByRole("button", { name: "Resident route" });
    const limits = screen.getByRole("button", { name: "Model limits" });
    expect(river).toHaveAttribute("aria-current", "step");
    fireEvent.click(buildings);
    expect(buildings).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("flood-story")).toHaveAttribute("data-phase", "buildings");
    fireEvent.click(resident);
    expect(resident).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent("No mapped connection (data gap).");
    expect(screen.queryByTestId("journey-hud")).toBeNull();
    fireEvent.click(limits);
    expect(limits).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("region", { name: "River scenario limits" })).toBeVisible();
    fireEvent.click(river);
    expect(useFloodStory.getState().t).toBe(0);
    expect(useFloodStory.getState().playing).toBe(false);
    expect(river).toHaveAttribute("aria-current", "step");
  });
  it("keeps the route's sidewalk and entrance caveats beside the resident", () => {
    const warnings = ["About 347 m has no mapped sidewalk.", "The home entrance is not mapped."];
    const residentStory = {
      ...story,
      resident: {
        origin: { id: "home", name: "Home" },
        centre: { centre: { name: "Candidate hall", source: "osm_candidate" } },
        plan: {
          route_id: "r",
          profile: "wheelchair",
          start_time: "08:00",
          pace_m_per_s: 1,
          polyline: [
            [101, 3],
            [101.001, 3],
          ],
          spans: [[0, 100, "UNKNOWN"]],
          events: [],
        },
        route: {
          status: "partly_unverified",
          warnings,
          routes: [{ id: "r", distance_m: 100, est_minutes: 2, segments: [] }],
        },
        missingCentres: 2,
      },
      residentGap: null,
    } as unknown as FloodStory;
    useFloodStory.getState().load(residentStory);
    render(<FloodStoryOverlay />);
    act(() => useFloodStory.getState().seek(RESIDENT_AT + 1));
    for (const text of warnings) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText("OSM candidate · not an official relief centre")).toBeVisible();
    assertHonest(document.body.textContent ?? "");
  });
  it("uses each stage's actual counters even if they do not increase; native seek updates them", () => {
    useFloodStory.getState().load(story);
    render(<FloodStoryOverlay />);
    expect(screen.getByTestId("flood-count")).toHaveTextContent("2");
    fireEvent.change(screen.getByRole("slider", { name: "River story time" }), {
      target: { value: "7" },
    });
    expect(screen.getByTestId("flood-count")).toHaveTextContent("1");
    expect(screen.getByTestId("path-count")).toHaveTextContent("1.5 km");
    expect(screen.getByText("Water look is illustrative; depth not modelled.")).toBeVisible();
    assertHonest(document.body.textContent ?? "");
  });
  it("shows a route gap instead of a fabricated resident; end card keeps the model limits", () => {
    useFloodStory.getState().load(story);
    render(<FloodStoryOverlay />);
    act(() => useFloodStory.getState().seek(RESIDENT_AT + 1));
    expect(screen.getByRole("status")).toHaveTextContent("No mapped connection (data gap).");
    expect(screen.queryByTestId("journey-hud")).toBeNull();
    act(() => useFloodStory.getState().seek(999));
    expect(screen.getByRole("region", { name: "River scenario limits" })).toHaveTextContent(
      "30 m surface model",
    );
    expect(screen.getByText("Drains are not modelled.")).toBeVisible();
    expect(screen.getByText("Flash floods from heavy rain are not shown.")).toBeVisible();
    for (const name of ["MBSA", "JPS", "NADMA"])
      expect(screen.getByRole("link", { name })).toHaveAttribute("href");
  });
  it("restores the assistant panel on exit and does not show fabricated counters after an error", () => {
    usePanel.setState({ open: true });
    useFloodStory.setState({ status: "error", error: "The scenario data is unavailable." });
    const view = render(<FloodStoryOverlay />);
    expect(usePanel.getState().open).toBe(false);
    expect(screen.queryByTestId("flood-count")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit story" }));
    expect(screen.queryByTestId("flood-story")).toBeNull();
    expect(usePanel.getState().open).toBe(true);
    view.unmount();
  });
});
