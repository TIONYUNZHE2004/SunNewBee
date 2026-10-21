// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProbe, useDevsimAnchors } from "./anchors";
import { bubbleViews, DevsimOverlay } from "./DevsimOverlay";
import { useDevsim } from "./devsimStore";
import provisional from "./fixtures/plan.provisional.json";
import { NOT_AVAILABLE } from "./intent";
import { RouteTag } from "./RouteTag";
import type { DevelopmentPlan } from "./types";

const plan = provisional as unknown as DevelopmentPlan;
const vp = { w: 1000, h: 700, top: 120, avoid: [] };
const d = () => useDevsim.getState();
const at = (t: number) => act(() => d().seek(t));

beforeEach(() => {
  d().stop();
  useDevsimAnchors.getState().clear();
});
afterEach(cleanup);

describe("DevsimOverlay", () => {
  it("shows nothing while idle", () => {
    const { container } = render(<DevsimOverlay viewport={vp} />);
    expect(container.textContent).toBe("");
  });

  it("badge, HUD and labels are present (D8, D3)", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(10);
    expect(screen.getByTestId("devsim-sim-badge")).toHaveTextContent("Simulation · illustrative");
    expect(screen.getByTestId("devsim-hypothetical")).toHaveAccessibleName(
      "Hypothetical development · not an SDP project · 30 storeys · ~500 homes",
    );
    expect(screen.getByTestId("devsim-hypothetical")).toHaveTextContent(
      "Hypothetical developmentnot an SDP project · 30 storeys · ~500 homes",
    );
    expect(screen.getByText("Decorative details are illustrative.")).toBeInTheDocument();
    const hud = screen.getByTestId("devsim-hud");
    expect(within(hud).getByTestId("devsim-hud-act")).toHaveTextContent("Construction");
    expect(within(hud).getByTestId("devsim-hud-when")).toHaveTextContent(/^Month \d+ of 24$/);
    expect(within(hud).getByText("Homes occupied")).toBeInTheDocument();
    expect(screen.getByTestId("devsim-controls")).toBeInTheDocument();
  });

  it("the decorative note can be left to the renderer", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} decorativeNote={false} />);
    expect(screen.queryByText("Decorative details are illustrative.")).toBeNull();
  });

  it("the hypothetical label follows the 3D tower anchor when there is one", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(12);
    act(() => useDevsimAnchors.getState().set({ towerTop: [500, 300] }));
    const label = screen.getByTestId("devsim-hypothetical");
    expect(label.style.left).toBe("500px");
    expect(label.style.top).toBe("300px");
  });

  it("bubbles: the plan's text and speaker, in a fixed stack without 3D, with the ROUTE ENGINE tag", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(19);
    const stack = screen.getByTestId("devsim-bubble-stack");
    const b = within(stack).getByTestId("devsim-bubble");
    expect(b).toHaveTextContent("Pak Cik Halim");
    expect(b).toHaveTextContent("Footpath closed lah, must walk the other side now");
    expect(within(b).getByTestId("devsim-route-tag")).toHaveTextContent(
      "ROUTE ENGINE+3 min walk · 2,516 → 2,754 m",
    );
    at(24);
    expect(screen.getByTestId("devsim-bubble")).toHaveTextContent("So noisy lah");
    expect(screen.queryByTestId("devsim-route-tag")).toBeNull();
    at(30);
    expect(screen.queryByTestId("devsim-bubble")).toBeNull();
  });

  it("each new bubble is announced once to screen readers, labelled simulated (Minor 6)", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(19);
    const live = screen.getByTestId("devsim-bubble-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent(
      "Simulated reaction, Pak Cik Halim: Footpath closed lah, must walk the other side now",
    );
    at(30);
    expect(live.textContent).toBe("");
  });

  it("bubbles sit by the speaker when 3D gives them, inside the map area and off the speaker", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(54);
    act(() =>
      useDevsimAnchors.getState().set({
        speaker: { x: 480, y: 400, w: 30, h: 90 },
        speakerHead: [495, 400],
      }),
    );
    const b = screen.getByTestId("devsim-bubble");
    // jsdom has no layout: the estimated 240 x 110 box, above the speaker and their name tag
    expect(b.dataset.side).toBe("above");
    expect(b.style.left).toBe("375px");
    expect(Number.parseFloat(b.style.top) + 110).toBeLessThanOrEqual(400 - 28);
    expect(Number.parseFloat(b.style.top)).toBeGreaterThanOrEqual(120);
  });

  it("AC-F5: the envelope flies and Resident feedback goes 0 -> 1", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(49);
    expect(screen.getByTestId("devsim-feedback-count")).toHaveTextContent("0");
    expect(screen.queryByTestId("devsim-envelope")).toBeNull();
    at(51);
    expect(screen.getByTestId("devsim-envelope")).toBeInTheDocument();
    expect(screen.getByTestId("devsim-feedback-count")).toHaveTextContent("0");
    at(52);
    expect(screen.queryByTestId("devsim-envelope")).toBeNull();
    expect(screen.getByTestId("devsim-feedback-count")).toHaveTextContent("1");
    expect(screen.getByRole("status", { name: "Resident feedback: 1" })).toBeInTheDocument();
  });

  it("the end card copy equals spec §4.5", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(62);
    expect(screen.queryByTestId("devsim-end-card")).toBeNull();
    at(66);
    const card = screen.getByTestId("devsim-end-card");
    expect(within(card).getByRole("heading", { name: "What residents raised" })).toBeVisible();
    expect(card).toHaveTextContent(
      "Simulated reactions · Hypothetical development · not an SDP project",
    );
    const items = within(card).getAllByTestId("devsim-end-item");
    expect(items.map((li) => li.textContent)).toEqual([
      "Building work closes the footpath beside the site: the walk to the mall gets about 3 min longer (2,516 m → 2,754 m).ROUTE ENGINE",
      "Parents complain about the morning school-run jam at the junction.SIMULATED",
      "Residents like having Urban Park 9 min and the mall 10 min away on foot.ROUTE ENGINESIMULATED",
    ]);
    // §4.5 layout: numbered items, key phrases in bold
    expect(card.querySelector("ol")?.className).toMatch(/list-decimal/);
    expect([...card.querySelectorAll("strong")].map((b) => b.textContent)).toEqual([
      "about 3 min longer",
      "morning school-run jam",
      "Urban Park 9 min",
      "the mall 10 min",
    ]);
    expect(card).toHaveTextContent(
      "ROUTE ENGINE numbers come from the mapped walk network. SIMULATED marks invented reactions.",
    );
  });

  it("playback bar: pause, play, restart, scrub, close", () => {
    d().start(plan, "b");
    d().play();
    let closed = 0;
    render(<DevsimOverlay viewport={vp} onClose={() => closed++} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(d().playing).toBe(false);
    fireEvent.change(screen.getByRole("slider", { name: "Simulation timeline" }), {
      target: { value: "500" },
    });
    expect(d().t).toBe(33);
    expect(screen.getByTestId("devsim-act")).toHaveTextContent("Handover");
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(d()).toMatchObject({ t: 0, playing: true });
    fireEvent.click(screen.getByRole("button", { name: "Close simulation" }));
    expect(closed).toBe(1);
  });

  it("not available: the message, no player (AC-H6)", () => {
    d().start(null, "b");
    act(() => d().setStatus("unavailable"));
    render(<DevsimOverlay viewport={vp} />);
    expect(screen.getByRole("alert")).toHaveTextContent(NOT_AVAILABLE);
    expect(screen.queryByTestId("devsim-controls")).toBeNull();
  });

  it("not available or failed: Close ends it, so the place markers and the map come back (I2)", () => {
    for (const status of ["unavailable", "error"] as const) {
      d().start(null, "b");
      act(() => d().setStatus(status));
      const { container, unmount } = render(<DevsimOverlay viewport={vp} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close simulation" }));
      // idle is what the 3D scene keys the hidden markers and the camera controls on
      expect(d().status).toBe("idle");
      expect(container.textContent).toBe("");
      unmount();
    }
    // a host's own close handler is used when given
    d().start(null, "b");
    act(() => d().setStatus("unavailable"));
    let closed = 0;
    render(<DevsimOverlay viewport={vp} onClose={() => closed++} />);
    fireEvent.click(screen.getByRole("button", { name: "Close simulation" }));
    expect(closed).toBe(1);
  });

  it("failed: Try again fetches the same brief again and plays (I2)", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify(plan), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchFn);
    try {
      d().start(null, "the brief");
      act(() => d().setStatus("error"));
      render(<DevsimOverlay viewport={vp} />);
      expect(screen.queryByRole("button", { name: "Try again" })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(fetchFn).toHaveBeenCalledWith(
        "/api/developments/simulate",
        expect.objectContaining({ body: JSON.stringify({ brief_text: "the brief" }) }),
      );
      expect(d()).toMatchObject({ status: "ready", playing: true });
      expect(screen.getByTestId("devsim-controls")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("unavailable offers no retry (the world has no parcel)", () => {
    d().start(null, "b");
    act(() => d().setStatus("unavailable"));
    render(<DevsimOverlay viewport={vp} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("registers the DOM part of the probe", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(19);
    // jsdom has no layout: rects are all zero, so none are reported, but the part is registered
    expect(collectProbe(19).rects).toEqual({});
  });
});

describe("RouteTag", () => {
  it("splits the plan's tag into its source and its numbers", () => {
    render(<RouteTag tag="ROUTE ENGINE · 659 m · 9 min walk" />);
    const tag = screen.getByTestId("devsim-route-tag");
    expect(tag).toHaveAccessibleName("ROUTE ENGINE · 659 m · 9 min walk");
    expect(tag.firstElementChild).toHaveTextContent("ROUTE ENGINE");
    expect(tag.lastElementChild).toHaveTextContent("659 m · 9 min walk");
  });
});

describe("pure placement", () => {
  it("bubbleViews names the speaker from the cast", () => {
    expect(bubbleViews(plan, 59)).toEqual([
      expect.objectContaining({
        n: 7,
        tone: "pos",
        speaker: expect.objectContaining({ name: "Arjun" }),
      }),
    ]);
  });
});
