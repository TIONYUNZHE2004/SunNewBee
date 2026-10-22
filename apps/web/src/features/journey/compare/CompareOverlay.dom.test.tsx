// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { honestyViolations } from "../../../test/honesty";
import { BottomStack, TopStack } from "../../map-ui/mapSlots";
import { type CompareScreen, compareTimelineOf, EMPTY_SCREEN, useCompare } from "../compareStore";
import type { CompareIntent } from "../compareTypes";
import { handCompare } from "../fixtures/compareHand";
import { CompareListSection } from "./CompareListSection";
import { CompareOverlay, pillTop, reasonsWidth } from "./CompareOverlay";
import {
  GREETINGS,
  greetingFor,
  poiTag,
  reasonRows,
  SIMULATED_RESIDENT,
  toastText,
  uncheckedTagText,
} from "./copy";
import { stackTags, tagSizeEstimate } from "./PoiTag";

vi.mock("../../scene/useMapStyle", async (orig) => ({
  ...(await orig<typeof import("../../scene/useMapStyle")>()),
  useEffectiveView: () => "three",
}));

let qc: QueryClient;
function show(c: CompareIntent = handCompare()) {
  useCompare.getState().load(c);
  return render(
    <QueryClientProvider client={qc}>
      <CompareOverlay />
    </QueryClientProvider>,
  );
}
const at = (t: number) => act(() => useCompare.getState().seek(t));
const beat = (id: string) => document.querySelector(`[data-beat="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  qc = new QueryClient();
  useCompare.getState().clear();
});
afterEach(() => {
  cleanup();
  useCompare.getState().clear();
});

describe("split pills (AC-N2)", () => {
  it("reads the minutes from the payload; step-free only with 0 known steps", () => {
    show();
    at(5);
    expect(beat("split-pill-fastest")).toHaveTextContent("Fastest route · 5.7 min walking");
    expect(beat("split-pill-recommended")).toHaveTextContent("Recommended · step-free · 7.4 min");
    expect(beat("split-divider")).not.toBeNull();
    cleanup();
    const base = handCompare();
    show(
      handCompare({
        reasons: {
          fastest: base.reasons.fastest,
          recommended: { ...(base.reasons.recommended ?? ({} as never)), steps: null },
        },
      }),
    );
    at(5);
    expect(beat("split-pill-recommended")).toHaveTextContent("Recommended · 7.4 min");
    expect(beat("split-pill-recommended")?.textContent).not.toMatch(/step-free/);
  });

  it("uses the renderer's halves when it gives them (equal widths)", () => {
    show();
    act(() =>
      useCompare.getState().setScreen({
        ...EMPTY_SCREEN,
        viewports: { left: { x: 0, w: 600 }, right: { x: 600, w: 600 } },
      }),
    );
    at(5);
    expect(beat("split-divider")?.style.left).toBe("600px");
    const halves = [beat("split-pill-fastest"), beat("split-pill-recommended")].map(
      (p) => (p?.parentElement as HTMLElement | null)?.style.width,
    );
    expect(halves).toEqual(["600px", "600px"]);
  });

  it("merges at 31.5 s: no pills, no divider, no route tags", () => {
    show();
    at(31.6);
    expect(beat("split")).toBeNull();
    expect(beat("tag-stop")).toBeNull();
  });
});

describe("tags from pois (AC-N4)", () => {
  it("demo values say so; the unchecked tag reads exactly", () => {
    show();
    at(4);
    expect(beat("tag-kerb")).toHaveTextContent("Flush kerb");
    expect(beat("tag-kerb")).toHaveTextContent("Demo value · not surveyed");
    at(15);
    const u = beat("tag-unchecked");
    expect(u?.textContent).toBe(
      "? Not checked yet · Incline on this 40 m · Not counted for or against",
    );
    expect(uncheckedTagText(handCompare())).toBe(u?.textContent);
    at(20);
    expect(beat("tag-stop")).toHaveTextContent("Not passable3 steps");
    expect(beat("tag-rest")).toHaveTextContent("Bench");
    at(30);
    expect(beat("arrive")).toHaveTextContent("Playground · step-free");
  });

  it("anchors a tag at the renderer's screen point, else stacks it in its half", () => {
    show();
    at(4);
    expect(beat("tag-kerb")?.style.left).toBe(""); // no screen yet: in the column
    act(() =>
      useCompare
        .getState()
        .setScreen({ ...EMPTY_SCREEN, pois: { "tag-kerb": { x: 410, y: 220 } } }),
    );
    expect(beat("tag-kerb")?.style.left).toBe("410px");
    expect(beat("tag-kerb")?.style.top).toBe("220px");
  });

  it("two anchored tags on top of each other stack, neither covers the other (R28 kerb + covered)", () => {
    const c = handCompare();
    show(c);
    const w = (id: string) => compareTimelineOf(c).beats.find((b) => b.id === id);
    const k = w("tag-kerb");
    const v = w("tag-covered");
    expect(k && v).toBeTruthy();
    const t = Math.max(k?.t0 ?? 0, v?.t0 ?? 0) + 0.1;
    expect(t).toBeLessThan(Math.min(k?.t1 ?? 0, v?.t1 ?? 0));
    at(t);
    act(() =>
      useCompare.getState().setScreen({
        ...EMPTY_SCREEN,
        pois: { "tag-kerb": { x: 410, y: 300 }, "tag-covered": { x: 430, y: 305 } },
      }),
    );
    const kerb = beat("tag-kerb") as HTMLElement;
    const cov = beat("tag-covered") as HTMLElement;
    expect(kerb.style.top).toBe("300px"); // the first stays on its point
    expect(kerb.dataset.lift).toBeUndefined();
    const lift = Number(cov.dataset.lift);
    expect(lift).toBeGreaterThan(0);
    expect(cov.style.top).toBe(`${305 - lift}px`);
    // the covered tag's box (lifted) ends above the kerb tag's box top
    const kerbSize = tagSizeEstimate(poiCopy(c, "tag-kerb"));
    const covSize = tagSizeEstimate(poiCopy(c, "tag-covered"));
    const kerbTop = 300 - 12 - kerbSize.h;
    expect(305 - lift - 12).toBeLessThanOrEqual(kerbTop);
    expect(covSize.h).toBeGreaterThan(0);
  });

  it("every beat with an element shows at its midpoint and is gone 0.5 s outside (AC-N3 ids)", () => {
    const c = handCompare();
    show(c);
    const withElement = new Set([
      "intro",
      "split",
      "tag-kerb",
      "tag-covered",
      "greeting",
      "tag-fastest",
      "tag-incline",
      "tag-unchecked",
      "tag-stop",
      "ticket-flight",
      "tickets-chip",
      "ticket-toast",
      "tag-rest",
      "arrive",
      "reasons",
    ]);
    for (const b of compareTimelineOf(c).beats) {
      if (!withElement.has(b.id)) continue;
      at((b.t0 + b.t1) / 2);
      expect(beat(b.id), `${b.id} at mid`).not.toBeNull();
      if (b.t0 - 0.5 >= 0) {
        at(b.t0 - 0.5);
        expect(beat(b.id), `${b.id} before`).toBeNull();
      }
      if (b.t1 + 0.5 <= 45) {
        at(b.t1 + 0.5);
        expect(beat(b.id), `${b.id} after`).toBeNull();
      }
    }
  });
});

describe("ticket (AC-N5)", () => {
  it("flies 17.6–19.4 s, counter 0 → 1 at 19.4 s, toast text, tickets refetched once", () => {
    const inval = vi.spyOn(qc, "invalidateQueries");
    show();
    at(17.5);
    expect(beat("ticket-flight")).toBeNull();
    at(18.5);
    expect(beat("ticket-flight")).toHaveTextContent("Survey queued");
    at(19.3);
    expect(screen.getByTestId("tickets-count")).toHaveTextContent("0");
    expect(inval).not.toHaveBeenCalled();
    at(19.5);
    expect(screen.getByTestId("tickets-count")).toHaveTextContent("1");
    expect(beat("ticket-flight")).toBeNull();
    expect(beat("ticket-toast")?.textContent).toBe(
      "Survey ticket queued for staff · Incline on 40 m of the recommended path is not checked yet. Checking it would confirm 7 wheelchair trips.",
    );
    at(22);
    expect(inval).toHaveBeenCalledTimes(1);
    expect(inval).toHaveBeenCalledWith({ queryKey: ["tickets"] });
  });

  it("the card lands on the measured chip counter, not a guessed point", () => {
    const orig = HTMLElement.prototype.getBoundingClientRect;
    const rect = (x: number, y: number, w: number, h: number) =>
      ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "tickets-count") return rect(500, 40, 22, 22);
        if (this.dataset.testid === "compare-stage") return rect(100, 10, 1000, 700);
        return orig.call(this);
      });
    try {
      show();
      at(17.7); // the chip is measured once the flight starts
      at(19.399); // the flight's last frame: at the chip
      const el = beat("ticket-flight");
      expect(Number.parseFloat(el?.style.left ?? "")).toBeCloseTo(411, 0);
      expect(Number.parseFloat(el?.style.top ?? "")).toBeCloseTo(41, 0);
    } finally {
      spy.mockRestore();
    }
  });

  it("no ticket (vr null): no flight, chip or toast at any time", () => {
    show(handCompare({ vr: null }));
    for (let t = 0; t <= 45; t += 0.5) {
      at(t);
      expect(beat("ticket-flight")).toBeNull();
      expect(beat("tickets-chip")).toBeNull();
      expect(beat("ticket-toast")).toBeNull();
    }
  });

  it("no N (confirm_n null): the toast keeps only its first sentence", () => {
    const c = handCompare({ confirm_n: null });
    expect(toastText(c)).toBe(
      "Survey ticket queued for staff · Incline on 40 m of the recommended path is not checked yet.",
    );
    show(c);
    at(20);
    expect(beat("ticket-toast")?.textContent).toBe(toastText(c));
    expect(beat("ticket-flight") ?? beat("tickets-chip")).not.toBeNull();
  });
});

describe("coordinator rulings on the corridor (R29, R30)", () => {
  it("R30: N = 0 also keeps only the toast's first sentence", () => {
    const c = handCompare({ confirm_n: 0 });
    expect(toastText(c)).toBe(
      "Survey ticket queued for staff · Incline on 40 m of the recommended path is not checked yet.",
    );
  });

  it("R29: no seating POI: no rest tag at any time; a null rest count reads Not checked yet", () => {
    const base = handCompare();
    const c = handCompare({
      pois: base.pois.filter((p) => p.kind !== "seating"),
      reasons: {
        fastest: base.reasons.fastest ? { ...base.reasons.fastest, rest_stops: null } : null,
        recommended: base.reasons.recommended
          ? { ...base.reasons.recommended, rest_stops: null }
          : null,
      },
    });
    expect(reasonRows(c).find((r) => r.label === "Rest stop on the way")).toEqual({
      label: "Rest stop on the way",
      fastest: "Not checked yet",
      recommended: "Not checked yet",
    });
    show(c);
    for (let t = 0; t <= 45; t += 0.5) {
      at(t);
      expect(beat("tag-rest")).toBeNull();
    }
  });

  it("the stop tag is labelled demo from the POIs when the payload has no route-level flag", () => {
    const base = handCompare();
    const strip = (r: typeof base.fastest) => (r ? { ...r, demo_evidence: undefined } : null);
    show(handCompare({ fastest: strip(base.fastest), recommended: strip(base.recommended) }));
    at(20);
    expect(beat("tag-stop")).toHaveTextContent("3 steps");
    expect(beat("tag-stop")).toHaveTextContent("Demo value · not surveyed");
  });
});

describe("the compare's chrome never covers its pills (V2 fix N-a, N-c)", () => {
  function showInMap() {
    useCompare.getState().load(handCompare());
    return render(
      <QueryClientProvider client={qc}>
        <div data-testid="map">
          <CompareOverlay />
          <TopStack />
          <BottomStack />
        </div>
      </QueryClientProvider>,
    );
  }

  it("label, player and reasons card sit in the bottom stack, the top stack stays empty", () => {
    showInMap();
    at(5);
    const top = screen.getByTestId("top-stack");
    const bottom = screen.getByTestId("bottom-stack");
    expect(top.querySelector('[data-slot="sim"]')?.childElementCount).toBe(0);
    const overlay = screen.getByTestId("compare-overlay");
    expect(bottom.contains(overlay)).toBe(true);
    // one player on the map: one Exit trip, no separate trip bar
    expect(screen.getAllByRole("button", { name: "Exit trip" })).toHaveLength(1);
    expect(screen.queryByTestId("journey-trip-bar")).toBeNull();
    expect(
      within(overlay).getByRole("note", {
        name: "Simulation · indicative times, not a prediction",
      }),
    ).toBeInTheDocument();
    at(1.5);
    expect(bottom.contains(beat("intro"))).toBe(true);
    at(33);
    const card = beat("reasons") as HTMLElement;
    expect(bottom.contains(card)).toBe(true);
    // the card comes before the player: the dock is under it, above the decorative note
    const dock = screen.getByTestId("compare-dock");
    expect(card.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the pills sit below the map's top stack; the card fits the visible map", () => {
    expect(pillTop(0)).toBe(64);
    expect(pillTop(65)).toBe(73);
    expect(reasonsWidth(922)).toBe(760);
    expect(reasonsWidth(600)).toBe(568);
    showInMap();
    at(5);
    const pill = beat("split-pill-fastest")?.parentElement as HTMLElement;
    expect(pill.style.top).toBe("64px"); // jsdom: no layout, the top stack measures 0
  });
});

describe("reasons card (AC-N6, AC-N7)", () => {
  it("title, rows, null cells, footer in order; reports its top edge", () => {
    const base = handCompare();
    show(
      handCompare({
        reasons: {
          fastest: { ...(base.reasons.fastest ?? ({} as never)), covered_share: null },
          recommended: base.reasons.recommended,
        },
      }),
    );
    at(31);
    expect(beat("reasons")).toBeNull();
    expect(useCompare.getState().screen?.cardTop ?? null).toBeNull();
    at(33);
    const card = beat("reasons") as HTMLElement;
    expect(card.querySelector("h3")).toHaveTextContent(
      "Recommended: the step-free route (+1.7 min)",
    );
    const rows = [...card.querySelectorAll("tbody tr")].map((r) => r.textContent);
    expect(rows).toEqual([
      "Steps3 stepsNone",
      "Steepest slope6%4%",
      "Narrowest point0.9 m1.2 m",
      "Covered from sun and rainNot checked yet45%",
      "Rest stop on the wayNone1 on the way",
    ]);
    const foot = [...card.querySelectorAll("div p")].map((p) => p.textContent);
    expect(foot).toEqual([
      "Reasons use checked facts only.",
      "? Not checked yet: incline on 40 m of the recommended path (survey queued; it did not count for or against).",
      "Demo values · not surveyed",
    ]);
    expect(useCompare.getState().screen?.cardTop).not.toBeNull();
  });

  it("the renderer's frame keeps the overlay's cardTop", () => {
    useCompare.getState().load(handCompare());
    useCompare.getState().setCardTop(500);
    useCompare.getState().setScreen({ ...EMPTY_SCREEN } satisfies CompareScreen);
    expect(useCompare.getState().screen?.cardTop).toBe(500);
  });
});

describe("greeting (AC-N8)", () => {
  it("comes from the fixed list, has no digits and says Simulated resident", () => {
    for (const g of GREETINGS) expect(g).not.toMatch(/\d/);
    expect(GREETINGS).toContain(greetingFor("a>b"));
    show();
    at(8.5);
    const b = beat("greeting");
    expect(b).toHaveTextContent(SIMULATED_RESIDENT);
    expect(GREETINGS.some((g) => b?.textContent?.startsWith(g))).toBe(true);
    expect(b?.textContent?.replace(SIMULATED_RESIDENT, "")).not.toMatch(/\d/);
  });
});

describe("honesty scan (AC-N11)", () => {
  it("no banned or depth wording anywhere in the compare copy, at every beat", () => {
    const texts: string[] = [...GREETINGS];
    show();
    for (let t = 0; t <= 45; t += 0.5) {
      at(t);
      texts.push(document.body.textContent ?? "");
    }
    cleanup();
    useCompare.getState().load(handCompare());
    render(
      <QueryClientProvider client={qc}>
        <CompareListSection />
      </QueryClientProvider>,
    );
    texts.push(document.body.textContent ?? "");
    for (const s of texts) expect(honestyViolations(s), s).toEqual([]);
  });
});

describe("frame driver lives with the overlay (review minor 5)", () => {
  it("plays with only the map overlay mounted (no answer-card controls)", () => {
    vi.useFakeTimers();
    try {
      show();
      act(() => useCompare.getState().play());
      act(() => vi.advanceTimersByTime(1000));
      expect(useCompare.getState().t).toBeGreaterThan(0.5);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The copy a beat's POI tag shows (`poiTag` on the beat's poi index). */
function poiCopy(c: CompareIntent, id: string) {
  const b = compareTimelineOf(c).beats.find((x) => x.id === id);
  return poiTag(c, b?.poi as number) ?? { key: "", text: "", tone: "ok" as const };
}

describe("stackTags (pure)", () => {
  const size = { w: 200, h: 30 };
  it("leaves apart tags alone and lifts a later overlapping one above the first", () => {
    expect(
      stackTags([
        { id: "a", at: { x: 100, y: 300 }, size },
        { id: "b", at: { x: 600, y: 300 }, size },
      ]),
    ).toEqual({ a: 0, b: 0 });
    const l = stackTags([
      { id: "a", at: { x: 100, y: 300 }, size },
      { id: "b", at: { x: 120, y: 300 }, size },
      { id: "c", at: { x: 110, y: 302 }, size },
    ]);
    expect(l.a).toBe(0);
    expect(l.b).toBe(36); // 30 high + 6 gap
    expect(l.c).toBe(74); // above b: 300-42-6-30 = 222 top; base 302-42 = 260
  });
  it("stacks below when there is no room above", () => {
    const l = stackTags(
      [
        { id: "a", at: { x: 100, y: 50 }, size },
        { id: "b", at: { x: 120, y: 50 }, size },
      ],
      0,
    );
    expect(l.b).toBe(-36); // under the first (8 + 30 + 6 = 44 top) instead of off the top
  });
});
