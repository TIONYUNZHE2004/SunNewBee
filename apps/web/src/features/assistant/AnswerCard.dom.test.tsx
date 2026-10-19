// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import type { AssistantMessage } from "../chat/chatReducer";
import { useScene } from "../scene/sceneStore";
import { AnswerCard } from "./AnswerCard";

// Show on map is offered only in the 3D view.
vi.mock("../scene/useMapStyle", async (orig) => ({
  ...(await orig<typeof import("../scene/useMapStyle")>()),
  useEffectiveView: () => "cesium",
}));

const cite = (i: number, demo: boolean) => ({
  type: "citation",
  ref: i,
  evidence_id: `e${i}`,
  element_id: `seg-${i}`,
  attribute: "step_count",
  status: "reported",
  source_type: demo ? "team_survey_placeholder" : "osm",
});

const msg = (over: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant",
  id: "a",
  text: "Route found.",
  draft: "",
  draftAttempt: 0,
  checks: [],
  done: true,
  vrs: [],
  tools: [
    { id: "t1", name: "find_place", done: true },
    { id: "t2", name: "plan_route", done: true },
  ],
  citations: [cite(1, true), cite(2, true), cite(3, false)] as never,
  uncertainty: {
    type: "uncertainty",
    level: "partial",
    items: [{ element_id: "seg-1", attribute: "step_count", note: "not checked" }],
  } as never,
  disclaimer: {
    type: "disclaimer",
    lens: "flood",
    text: "Indicative scenario, not a forecast.",
    links: [{ url: "https://www.mbsa.gov.my", label: "MBSA" }],
  } as never,
  route: { id: "r1", status: "partly_unverified", distanceM: 420, minutes: 6 },
  ...over,
});

const show = (m: AssistantMessage) => renderWithClient(<AnswerCard m={m} onRetry={() => {}} />);

describe("AnswerCard", () => {
  beforeEach(() => {
    useScene.setState({ route: null, focusRouteRequest: null });
    stubFetch(() => json([]));
  });

  it("Not verified: identical caveats collapse with a count, every distinct one is still shown", () => {
    const same = "Older adult: incline not checked yet (limit 8.3%) on an unnamed footway";
    const items = [
      ...Array.from({ length: 12 }, (_, i) => ({
        element_id: `seg-${i}`,
        attribute: "incline",
        note: same,
      })),
      {
        element_id: "seg-a",
        attribute: "width",
        note: "Older adult: width not checked yet on Jalan A",
      },
      {
        element_id: "seg-b",
        attribute: "incline",
        note: "Older adult: incline not checked yet (limit 8.3%) on Jalan B",
      },
    ];
    show(msg({ uncertainty: { type: "uncertainty", level: "partial", items } as never }));
    const note = screen.getByText(/^Not verified/).closest('[role="note"]') as HTMLElement;
    expect(note.textContent?.split(same).length).toBe(2); // shown once
    expect(note).toHaveTextContent(`${same} (x12)`);
    expect(note).toHaveTextContent("width not checked yet on Jalan A");
    expect(note).toHaveTextContent("(limit 8.3%) on Jalan B");
  });

  it("summary strip shows status with its label, distance, time and Show on map", () => {
    useScene.setState({ route: { id: "r1", geojson: { type: "LineString", coordinates: [] } } });
    show(msg());
    expect(screen.getByText("Some parts not checked yet")).toBeInTheDocument();
    expect(screen.getByText("420 m")).toBeInTheDocument();
    expect(screen.getByText("6 min")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show on map" }));
    expect(useScene.getState().focusRouteRequest).toBe("r1");
  });
  it("strip carries the demo-value chip when any citation is placeholder evidence", () => {
    show(msg({ route: { id: "r1", status: "confirmed" } }));
    expect(screen.getByText("No known barrier")).toBeInTheDocument();
    const strip = screen.getByText("No known barrier").parentElement as HTMLElement;
    expect(within(strip).getByText(/Demo value · not surveyed/)).toBeInTheDocument();
  });
  it("no demo chip when no citation is placeholder", () => {
    show(msg({ route: { id: "r1", status: "confirmed" }, citations: [cite(3, false)] as never }));
    expect(screen.queryByText(/Demo value · not surveyed/)).toBeNull();
  });
  it("no strip for a legacy answer without a route summary", () => {
    show(msg({ route: { id: "r1" } }));
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
  });
  it("finished checks collapse to one line and expand", () => {
    show(msg());
    const toggle = screen.getByRole("button", { name: /2 checks/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("list", { name: "Checks the assistant ran" })).toBeInTheDocument();
  });
  it("evidence is collapsed to a summary that states the demo-value count", () => {
    show(msg());
    const btn = screen.getByRole("button", {
      name: /Evidence · 3 sources · 2 with demo values \(not surveyed\)/,
    });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(screen.getAllByText("Demo value · not surveyed").length).toBeGreaterThan(0);
  });
  it("honesty notes are visible and never inside a collapsible region", () => {
    show(msg());
    const notes = screen.getAllByRole("note");
    expect(notes.some((n) => /Not verified/.test(n.textContent ?? ""))).toBe(true);
    expect(notes.some((n) => /not a forecast/.test(n.textContent ?? ""))).toBe(true);
    for (const n of notes) {
      expect(n.closest("[data-collapsible]")).toBeNull();
      expect(n).toBeVisible();
    }
    const fc = notes.find((n) => /forecast/.test(n.textContent ?? "")) as HTMLElement;
    expect(within(fc).getByRole("link", { name: "MBSA" })).toBeInTheDocument();
  });
});
