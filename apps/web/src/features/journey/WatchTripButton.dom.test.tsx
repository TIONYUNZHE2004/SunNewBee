// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useScene } from "../scene/sceneStore";
import demoPlan from "./fixtures/demoPlan.json";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";
import { WatchTripButton } from "./WatchTripButton";

const plan = demoPlan as unknown as JourneyPlan;

beforeEach(() => useScene.setState({ profile: "default", route: null }));
afterEach(() => useJourney.getState().clear());

describe("WatchTripButton persona", () => {
  it("names the plan's persona, not the selector's", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WatchTripButton plan={plan} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("planned-for")).toHaveTextContent(
      "Planned for: Older adult (rest stops)",
    );
  });
  it("syncs the chip to the plan's persona when the trip is watched", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WatchTripButton plan={plan} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useScene.getState().profile).toBe("older_adult_rest");
    expect(useJourney.getState().plan).toBe(plan);
  });
});
