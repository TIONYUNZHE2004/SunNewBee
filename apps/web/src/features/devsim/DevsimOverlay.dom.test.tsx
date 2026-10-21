// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProbe, useDevsimAnchors } from "./anchors";
import { briefViewShift, bubbleViews, DevsimOverlay } from "./DevsimOverlay";
import { useDevsim } from "./devsimStore";
import elmina from "./fixtures/plan.elmina.json";
import { NOT_AVAILABLE } from "./intent";
import { RouteTag } from "./RouteTag";
import type { DevelopmentPlan } from "./types";

const plan = elmina as unknown as DevelopmentPlan;
const vp = { w: 1000, h: 700, top: 120, avoid: [] };
const d = () => useDevsim.getState();
const at = (t: number) => act(() => d().seek(t));
const bubble = (n: number) => plan.bubbles.find((b) => b.n === n) as DevelopmentPlan["bubbles"][0];
const banner = (k: string) =>
  plan.banners.find((b) => b.kind === k) as DevelopmentPlan["banners"][0];
const tag = (k: string) => plan.tags.find((b) => b.kind === k) as DevelopmentPlan["tags"][0];

beforeEach(() => {
  d().stop();
  useDevsimAnchors.getState().clear();
});
afterEach(cleanup);

describe("DevsimOverlay (45 s building plan)", () => {
  it("shows nothing while idle", () => {
    const { container } = render(<DevsimOverlay viewport={vp} />);
    expect(container.textContent).toBe("");
  });

  it("badge, estimate HUD, schedule bar and labels are present (D8, AC-W2)", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(8);
    expect(screen.getByTestId("devsim-sim-badge")).toHaveTextContent("Simulation · illustrative");
    expect(screen.getByText("Decorative details are illustrative.")).toBeInTheDocument();
    const hud = screen.getByTestId("devsim-estimate-hud");
    expect(within(hud).getByTestId("devsim-hud-cost")).toHaveTextContent(/^RM \d+ M$/);
    expect(within(hud).getByTestId("devsim-hud-lost")).toHaveTextContent(/^\d+ d$/);
    expect(within(hud).getByTestId("devsim-hud-footnote")).toHaveTextContent(
      "Estimate from published benchmarks",
    );
    expect(within(hud).queryByTestId("devsim-hud-homes")).toBeNull();
    expect(screen.getByTestId("devsim-schedule-bar")).toBeInTheDocument();
    expect(screen.getByTestId("devsim-controls")).toBeInTheDocument();
  });

  it('"Hypothetical tower · not an SDP project" is visible throughout (AC-W9)', () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    for (let t = 0; t <= plan.total_s; t += 0.5) {
      at(t);
      const labels = screen.getAllByTestId("devsim-hypothetical");
      expect(labels, `t=${t}`).toHaveLength(1);
      expect(labels[0]).toHaveAccessibleName(plan.labels.hypothetical);
      expect(plan.labels.hypothetical.startsWith("Hypothetical tower · not an SDP project")).toBe(
        true,
      );
    }
  });

  it("the HUD counts homes occupied from handover: lit share × homes", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(26.9);
    expect(screen.queryByTestId("devsim-hud-homes")).toBeNull();
    at(27.5);
    expect(screen.getByTestId("devsim-hud-homes")).toHaveTextContent(`0/${plan.site.homes}`);
    at(33);
    expect(screen.getByTestId("devsim-hud-homes")).toHaveTextContent(
      `${Math.round(0.9 * plan.site.homes)}/${plan.site.homes}`,
    );
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

  it("hoarding impact card 4–9.5 s: the plan's rows, with the hoarded side row", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(3.9);
    expect(screen.queryByTestId("devsim-hoarding-card")).toBeNull();
    at(4);
    const card = screen.getByTestId("devsim-hoarding-card");
    const rows = plan.brief.sections[0]?.rows ?? [];
    const pick = (k: string) => rows.find((r) => r.key === k);
    for (const k of ["homes_2min_plus", "wheelchair_links_cut", "best_side"]) {
      const r = pick(k);
      expect(r, k).toBeTruthy();
      const el = card.querySelector(`[data-key="${k}"]`);
      expect(el).toHaveTextContent(`${r?.label}${r?.value}`);
    }
    expect(card).toHaveTextContent(plan.impact.provenance);
    at(9.5);
    expect(screen.queryByTestId("devsim-hoarding-card")).toBeNull();
  });

  it("detour and lorry tags at the plan's windows; the lorry tag names the first sensitive place (R16)", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    const lorry = tag("lorry");
    at(lorry.t0 - 0.05);
    expect(document.querySelector('[data-kind="lorry"]')).toBeNull();
    at(lorry.t0);
    const el = document.querySelector('[data-kind="lorry"]');
    expect(el).toHaveTextContent(lorry.text);
    const first = plan.lorry_route.sensitive[0];
    if (first) {
      expect(el).toHaveTextContent(first.name);
      const isSchool = first.type === "school" || first.type === "kindergarten";
      if (!isSchool) expect(el?.textContent ?? "").not.toMatch(/school/i);
    }
    at(tag("detour").t0 + 0.1);
    expect(document.querySelector('[data-kind="detour"]')).toHaveTextContent(tag("detour").text);
  });

  it("a tag the 3D view projects is anchored at its point", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(tag("lorry").t0 + 0.5);
    act(() => useDevsimAnchors.getState().set({ tagPoints: { lorry: [420, 260] } }));
    const el = document.querySelector('[data-kind="lorry"]') as HTMLElement;
    expect(el.style.left).toBe("420px");
    expect(el.style.top).toBe("260px");
  });

  it("Raya, monsoon and handover banners: the plan's windows, title, text and badges (R25)", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    for (const k of ["raya", "monsoon", "handover"]) {
      const b = banner(k);
      at(b.t0 - 0.05);
      expect(document.querySelector(`[data-kind="${k}"]`), `${k} before`).toBeNull();
      at((b.t0 + b.t1) / 2);
      const el = document.querySelector(`[data-kind="${k}"]`) as HTMLElement;
      expect(el).toHaveTextContent(b.title);
      expect(el).toHaveTextContent(b.text);
      expect(
        [...el.querySelectorAll("[data-badge]")].map((x) => (x as HTMLElement).dataset.badge),
      ).toEqual(b.badges);
      at(b.t1);
      expect(document.querySelector(`[data-kind="${k}"]`), `${k} after`).toBeNull();
    }
    // the monsoon text states the days the plan says were lost, never more
    const mon = plan.schedule.monsoon_set_piece;
    if (mon && mon.months.every((m) => m.days_lost === 0))
      expect(banner("monsoon").text).not.toMatch(/days lost a month|per month lost/i);
  });

  it("bubbles at the plan's windows (±0.05 s; AC-W8), stacked without 3D, with the ROUTE ENGINE tag", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    for (const b of plan.bubbles) {
      at(b.t0 - 0.05);
      const before = screen.queryAllByTestId("devsim-bubble").map((e) => e.textContent ?? "");
      expect(
        before.some((x) => x.includes(b.text)),
        `bubble ${b.n} before`,
      ).toBe(false);
      at(b.t0 + 0.05);
      const on = screen
        .getAllByTestId("devsim-bubble")
        .find((e) => e.textContent?.includes(b.text));
      expect(on, `bubble ${b.n} on`).toBeTruthy();
      if (b.tag) expect(on?.textContent).toContain(b.tag.split(" · ").slice(1).join(" · "));
      at(b.t1);
      const after = screen.queryAllByTestId("devsim-bubble").map((e) => e.textContent ?? "");
      expect(
        after.some((x) => x.includes(b.text)),
        `bubble ${b.n} after`,
      ).toBe(false);
    }
    at(bubble(1).t0 + 0.1);
    expect(screen.getByTestId("devsim-bubble-stack")).toBeInTheDocument();
  });

  it("each new bubble is announced once to screen readers, labelled simulated (Minor 6)", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(bubble(2).t0 + 0.1);
    const live = screen.getByTestId("devsim-bubble-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent(`Simulated reaction, Farid: ${bubble(2).text}`);
    at(17);
    expect(live.textContent).toBe("");
  });

  it("bubbles sit by the speaker when 3D gives them, inside the map area and off the speaker", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(bubble(6).t0 + 0.2);
    act(() =>
      useDevsimAnchors.getState().set({
        speaker: { x: 480, y: 400, w: 30, h: 90 },
        speakerHead: [495, 400],
      }),
    );
    const b = screen.getByTestId("devsim-bubble");
    expect(b.dataset.side).toBe("above");
    expect(Number.parseFloat(b.style.top) + 110).toBeLessThanOrEqual(400 - 28);
    expect(Number.parseFloat(b.style.top)).toBeGreaterThanOrEqual(120);
  });

  it("from 33 s: the Impact Brief and the residents button (AC-W6, AC-W7); no end card, no feedback envelope", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(32.9);
    expect(screen.queryByTestId("devsim-impact-brief")).toBeNull();
    expect(screen.queryByRole("button", { name: /Simulated residents/ })).toBeNull();
    at(33.6);
    expect(screen.getByRole("button", { name: /Simulated residents · 40/ })).toBeInTheDocument();
    expect(screen.queryByTestId("devsim-end-card")).toBeNull();
    expect(screen.queryByTestId("devsim-feedback")).toBeNull();
    expect(screen.queryByTestId("devsim-envelope")).toBeNull();
    // seeking back hides it again
    at(20);
    expect(screen.queryByTestId("devsim-impact-brief")).toBeNull();
  });

  it("the residents panel opens by the script at 39 s and Mei Ling at 41 s while playing", () => {
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    act(() => {
      d().seek(38.5);
      d().play();
    });
    for (let t = 38.5; t <= 41.25; t += 0.25) at(t);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Mei Ling");
  });

  it("the view shift eases from 0 at 33 s to the brief width by 34.5 s and is published to the store", () => {
    expect(briefViewShift(32.9, 400)).toBe(0);
    expect(briefViewShift(33, 400)).toBe(0);
    expect(briefViewShift(33.75, 400)).toBeCloseTo(200, 5);
    expect(briefViewShift(34.5, 400)).toBe(400);
    expect(briefViewShift(45, 400)).toBe(400);
    d().start(plan, "b");
    render(<DevsimOverlay viewport={vp} />);
    at(20);
    expect(d().viewShiftPx).toBe(0);
    at(40);
    // jsdom has no layout: the estimated brief width is used
    expect(d().viewShiftPx).toBe(416);
    at(10);
    expect(d().viewShiftPx).toBe(0);
  });

  it("playback bar: pause, play, restart, scrub, close", () => {
    d().start(plan, "b");
    d().play();
    let closed = 0;
    render(<DevsimOverlay viewport={vp} onClose={() => closed++} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(d().playing).toBe(false);
    fireEvent.change(screen.getByRole("slider", { name: "Simulation timeline" }), {
      target: { value: "600" },
    });
    expect(d().t).toBeCloseTo(27, 5);
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
      expect(d().status).toBe("idle");
      expect(container.textContent).toBe("");
      unmount();
    }
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
    const t = screen.getByTestId("devsim-route-tag");
    expect(t).toHaveAccessibleName("ROUTE ENGINE · 659 m · 9 min walk");
    expect(t.firstElementChild).toHaveTextContent("ROUTE ENGINE");
    expect(t.lastElementChild).toHaveTextContent("659 m · 9 min walk");
  });
});

describe("pure placement", () => {
  it("bubbleViews names the speaker from the cast", () => {
    expect(bubbleViews(plan, bubble(7).t0 + 1.5)).toEqual([
      expect.objectContaining({
        n: 7,
        tone: "pos",
        speaker: expect.objectContaining({ name: "Arjun" }),
      }),
    ]);
  });
});
