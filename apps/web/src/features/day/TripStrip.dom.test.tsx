// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { TripStrip } from "./TripStrip";
import type { TripMeta } from "./tripModel";

const META: TripMeta = {
  day: "storm",
  day_label: "Storm at the school run",
  profile: "drive",
  from: "Car Park B",
  to: "SK Denai Alam",
  from_id: "park-b",
  to_id: "sk",
  leave: "07:30",
  outcome: "no_way",
  sweep: [
    { leave: "06:40", outcome: "clear", arrive: "06:48" },
    { leave: "06:50", outcome: "no_way", arrive: null },
    { leave: "07:00", outcome: "no_way", arrive: null },
    { leave: "07:30", outcome: "no_way", arrive: null },
  ],
};

const post = vi.fn();
// Node cannot fetch the relative /api URL: the client's POST is replaced, the rest is real.
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: { POST: (...a: unknown[]) => post(...a) },
}));

beforeEach(() => {
  useScene.getState().reset();
  post.mockReset();
});

describe("TripStrip", () => {
  it("shows every rehearsed departure with words, not colour alone", () => {
    renderWithClient(<TripStrip meta={META} />);
    expect(screen.getByRole("region", { name: "Your trip in the rehearsal" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Leaving at 06:40: got there at 06:48 (rehearsal)." }),
    ).toBeVisible();
    const asked = screen.getByRole("button", {
      name: "Leaving at 07:30: found no way through (rehearsal). The time you asked about.",
    });
    expect(asked).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/not a forecast/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\b(?:safe|should|leave by)\b/i);
  });

  it("tapping a departure rehearses it again and plays it on the map", async () => {
    post.mockResolvedValue({
      response: { status: 200 },
      data: {
        status: "rehearsed",
        scenario: { id: "storm", label: "Storm at the school run" },
        from: { id: "park-b", name: "Car Park B" },
        to: { id: "sk", name: "SK Denai Alam" },
        profile: "drive",
        leave: "06:40",
        asked: { outcome: "clear", arrive: "06:48", minutes: 8 },
        normal_route: [
          [101.5, 3.18],
          [101.51, 3.18],
        ],
        track: [
          {
            t0: 400,
            t1: 408,
            wait: false,
            coords: [
              [101.5, 3.18],
              [101.51, 3.18],
            ],
          },
        ],
        sweep: META.sweep,
        disclaimer: "Rehearsal … not a forecast",
      },
    });
    renderWithClient(<TripStrip meta={META} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Leaving at 06:40: got there at 06:48 (rehearsal)." }),
    );
    await waitFor(() => expect(useScene.getState().myTrip).not.toBeNull());
    expect(post).toHaveBeenCalledWith("/day/{scenario_id}/trip", {
      params: { path: { scenario_id: "storm" } },
      body: {
        from_id: "park-b",
        to_id: "sk",
        from_point: null,
        to_point: null,
        profile: "drive",
        leave_at: "06:40",
      },
    });
    expect(useScene.getState().day).toMatchObject({ on: true, t: 400, scenario: "storm" });
  });

  it("a trip from a tapped point is rehearsed again with that point", async () => {
    post.mockResolvedValue({ response: { status: 200 }, data: { status: "rehearsed", sweep: [] } });
    renderWithClient(
      <TripStrip
        meta={{ ...META, from_id: null }}
        ends={{ from_point: "101.5,3.18", to_id: "sk" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Leaving at 06:40: got there at 06:48 (rehearsal)." }),
    );
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]?.body).toMatchObject({ from_point: "101.5,3.18", to_id: "sk" });
  });

  it("one tab stop for the strip; arrow keys move between departures", () => {
    renderWithClient(<TripStrip meta={META} />);
    const cells = screen.getAllByRole("button", { name: /Leaving at/ });
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    const asked = cells.find((c) => c.getAttribute("aria-pressed") === "true") as HTMLElement;
    fireEvent.keyDown(asked, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: /Leaving at 07:00/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
