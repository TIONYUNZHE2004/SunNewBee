// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { GapLegend, GapProfileNote } from "./GapLegend";
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
  reported: 0,
  relevant: 3,
  demand: 0,
  journey: 0,
  named: true,
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
    render(<GapsSection profile="stroller" items={items} onSelectPlace={() => {}} />);
    expect(screen.getByRole("heading", { name: "Biggest gaps" })).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names[0]).toContain("Asked path");
    expect(names[1]).toContain("Park toilet");
    expect(names[2]).toContain("Low path");
    expect(screen.queryByText("Fine path")).not.toBeInTheDocument();
  });

  it("opens the place card for a place row", async () => {
    const onSelectPlace = vi.fn();
    render(<GapsSection profile="stroller" items={items} onSelectPlace={onSelectPlace} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Park toilet/ }));
    expect(onSelectPlace).toHaveBeenCalledWith("t");
  });

  it("opens a path card listing the facts not yet checked, closes on Escape", async () => {
    const user = userEvent.setup();
    render(<GapsSection profile="stroller" items={items} onSelectPlace={() => {}} />);
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
    const { rerender } = render(
      <GapsSection profile="stroller" items={items} onSelectPlace={() => {}} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Asked path/ }));
    expect(document.body.textContent ?? "").not.toMatch(/unsafe|inaccessible/i);
    rerender(<GapsSection profile="stroller" items={[]} onSelectPlace={() => {}} />);
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
    useScene.getState().setProfile("stroller");
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

describe("profiles with no route-deciding facts", () => {
  const NOTE =
    "The gap map shows facts that matter for stroller, wheelchair and older-adult travel. Pick one of those profiles to see gaps.";

  it.each(["default", "drive"] as const)("shows the note for %s and draws no list", (p) => {
    useScene.getState().setProfile(p);
    useScene.getState().setGaps(true);
    renderWithClient(
      <>
        <GapProfileNote />
        <GapsLensSection />
      </>,
    );
    expect(screen.getByRole("note")).toHaveTextContent(NOTE);
    expect(screen.queryByText("Biggest gaps")).not.toBeInTheDocument();
    expect(screen.queryByText(/Fully checked/)).not.toBeInTheDocument();
  });

  it("stays quiet for a profile with facts, or when the toggle is off", () => {
    useScene.getState().setProfile("stroller");
    useScene.getState().setGaps(true);
    const { container, rerender } = renderWithClient(<GapProfileNote />);
    expect(container).toBeEmptyDOMElement();
    useScene.getState().setProfile("default");
    useScene.getState().setGaps(false);
    rerender(<GapProfileNote />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("street and unnamed rows", () => {
  const seg = (id: string, name: string, named: boolean) =>
    item({
      id,
      name,
      named,
      unknown: 3,
      attributes: ["step_count", "incline_pct", "width_m"],
      coords: [
        [101.5, 3.1],
        [101.51, 3.11],
      ],
    });
  const items = [
    seg("s1", "Jalan Hopea U15/17D", true),
    seg("s2", "Jalan Hopea U15/17D", true),
    seg("u1", "Unnamed footway", false),
    seg("u2", "Unnamed footway", false),
    seg("u3", "Unnamed footway", false),
  ];

  it("shows one row per street and one for all unnamed paths, plus the summary", () => {
    render(<GapsSection profile="wheelchair" items={items} onSelectPlace={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /3 unnamed path segments/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jalan Hopea U15\/17D.*2 path segments, 3 facts each/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("gap-summary")).toHaveTextContent(
      "Most paths are not yet checked: 5 of 5 for wheelchair travel.",
    );
  });

  it("locating a street flies to its first segment and opens the card", async () => {
    const onLocate = vi.fn();
    render(
      <GapsSection
        profile="wheelchair"
        items={items}
        onSelectPlace={() => {}}
        onLocate={onLocate}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Jalan Hopea/ }));
    expect(onLocate).toHaveBeenCalledWith(
      expect.objectContaining({ firstId: "s1", at: [101.51, 3.11] }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/Step count, Incline pct, Width m/);
  });
});
