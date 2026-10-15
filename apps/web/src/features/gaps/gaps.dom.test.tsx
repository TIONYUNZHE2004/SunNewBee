// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { GapLegend } from "./GapLegend";
import { GapMapLink } from "./GapMapLink";
import { GapsLensSection, GapsSection } from "./GapsSection";
import type { GapItem } from "./gapModel";

const item = (o: Partial<GapItem>): GapItem => ({
  id: "x",
  kind: "segment",
  name: "X",
  type: "footway",
  unknown: 1,
  stale: 0,
  relevant: 3,
  demand: 0,
  attributes: [],
  band: "some",
  coords: [],
  ...o,
});

beforeEach(() => {
  useScene.getState().reset();
  vi.unstubAllGlobals();
});

describe("GapsSection", () => {
  const items = [
    item({ id: "a", name: "Low path", unknown: 3 }),
    item({ id: "b", name: "Asked path", unknown: 1, demand: 4, attributes: ["incline_pct"] }),
    item({ id: "t", kind: "amenity", name: "Park toilet", type: "toilet", unknown: 1, demand: 2 }),
    item({ id: "ok", name: "Fine path", unknown: 0 }),
  ];

  it("lists the biggest gaps by demand then unknown count, as buttons", () => {
    render(<GapsSection items={items} onSelectPlace={() => {}} />);
    expect(screen.getByRole("heading", { name: "Biggest gaps" })).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names[0]).toContain("Asked path");
    expect(names[1]).toContain("Park toilet");
    expect(names[2]).toContain("Low path");
    expect(screen.queryByText("Fine path")).not.toBeInTheDocument();
  });

  it("opens the place card for a place row", async () => {
    const onSelectPlace = vi.fn();
    render(<GapsSection items={items} onSelectPlace={onSelectPlace} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Park toilet/ }));
    expect(onSelectPlace).toHaveBeenCalledWith("t");
  });

  it("opens a path card listing the facts not yet checked, closes on Escape", async () => {
    const user = userEvent.setup();
    render(<GapsSection items={items} onSelectPlace={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Asked path/ }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/Incline pct/)).toBeInTheDocument();
    expect(dlg).toHaveTextContent(/not a finding about the path/i);
    expect(screen.getByRole("heading", { name: /not yet checked on this path/i })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Asked path/ })).toHaveFocus();
  });

  it("never calls a gap unsafe or inaccessible, and shows an empty state", async () => {
    const { rerender } = render(<GapsSection items={items} onSelectPlace={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Asked path/ }));
    expect(document.body.textContent ?? "").not.toMatch(/unsafe|inaccessible/i);
    rerender(<GapsSection items={[]} onSelectPlace={() => {}} />);
    expect(screen.getByText(/No gaps to show/)).toBeInTheDocument();
  });
});

describe("GapsLensSection (connected)", () => {
  it("reads the gap layer for the chosen profile and opens a place via the store", async () => {
    useScene.getState().setProfile("stroller");
    const qc = newQueryClient();
    qc.setQueryData(["layer", "gaps", "stroller"], {
      type: "FeatureCollection",
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: {
            id: "toilet-1",
            kind: "amenity",
            type: "toilet",
            name: "Park toilet",
            unknown_count: 1,
            relevant_count: 1,
            stale_count: 0,
            demand: 2,
            unknown_attributes: ["wheelchair"],
          },
        },
      ],
    });
    renderWithClient(<GapsLensSection />, qc);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Park toilet/ }));
    expect(useScene.getState().selectedPlaceId).toBe("toilet-1");
  });

  it("offers a retry when the layer fails", async () => {
    stubFetch(() => json({ detail: "boom" }, 500));
    renderWithClient(<GapsLensSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/gap map is unavailable/i);
  });
});

describe("GapLegend and GapMapLink", () => {
  it("names the three bands in words", () => {
    render(<GapLegend />);
    const items = within(screen.getByRole("list", { name: "Gap map legend" })).getAllByRole(
      "listitem",
    );
    expect(items.map((i) => i.textContent)).toEqual([
      "Fully checked",
      "Some facts missing",
      "Many facts missing",
    ]);
  });

  it("links the queue to the gap map", () => {
    render(
      <MemoryRouter>
        <GapMapLink />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /gaps on the map/i })).toHaveAttribute(
      "href",
      "/?gaps=1",
    );
  });
});

describe("store", () => {
  it("is off by default and toggles", () => {
    expect(useScene.getState().gapsVisible).toBe(false);
    useScene.getState().toggleGaps();
    expect(useScene.getState().gapsVisible).toBe(true);
    useScene.getState().reset();
    expect(useScene.getState().gapsVisible).toBe(false);
  });
});
