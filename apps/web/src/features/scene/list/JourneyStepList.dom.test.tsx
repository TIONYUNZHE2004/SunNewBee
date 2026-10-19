// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_CHIP,
  journeyCardContent,
  SIMULATION_LABEL,
  VR_FILED,
} from "../../journey/cardContent";
import { EventCard } from "../../journey/EventCard";
import demo from "../../journey/fixtures/demoPlan.json";
import { useJourney } from "../../journey/journeyStore";
import type { JourneyPlan } from "../../journey/timeline";
import { JourneyStepList } from "./JourneyStepList";

const plan = demo as unknown as JourneyPlan;
/** Rendered markup (jsdom: the zustand store is read live, unlike server rendering). */
const renderToStaticMarkup = (el: ReactElement) => {
  const html = render(el).container.innerHTML;
  cleanup();
  return html;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const items = (html: string) => html.split("<li").slice(1);
/** Text of the `data-testid="card-source"` element in an HTML fragment. */
const sourceOf = (html: string) => /data-testid="card-source"[^>]*>([^<]*)</.exec(html)?.[1];

afterEach(() => useJourney.setState({ vrs: [] }));

describe("JourneyStepList (AC-D14)", () => {
  it("numbers every event in order with the card title, status, source line and element id", () => {
    const lis = items(renderToStaticMarkup(<JourneyStepList plan={plan} />));
    expect(lis).toHaveLength(plan.events.length);
    plan.events.forEach((e, i) => {
      const c = journeyCardContent(e);
      const li = lis[i] ?? "";
      expect(li).toContain(`${i + 1}.`);
      expect(li).toContain(esc(c.title));
      expect(li).toContain(esc(c.statusLabel));
      expect(sourceOf(li)).toBe(esc(c.source));
      if (e.element_id) expect(li).toContain(e.element_id);
    });
  });

  it("the source line is the same text the 3D event card shows, for every event", () => {
    useJourney.setState({ vrs: [{ element_id: "seg-1306543755-2", attribute: "incline_pct" }] });
    const lis = items(renderToStaticMarkup(<JourneyStepList plan={plan} />));
    plan.events.forEach((e, i) => {
      const card = renderToStaticMarkup(
        <EventCard
          event={e}
          anchor={null}
          viewport={{ w: 1200, h: 800 }}
          vrFiled={e.title === "Ramp"}
        />,
      );
      expect(sourceOf(lis[i] ?? "")).toBe(sourceOf(card));
    });
    const ramp = plan.events.findIndex((e) => e.title === "Ramp");
    expect(sourceOf(lis[ramp] ?? "")).toContain(VR_FILED);
  });

  it("shows the simulation label, the demo chip only on demo events, never Verified on demo", () => {
    const html = renderToStaticMarkup(<JourneyStepList plan={plan} />);
    expect(html).toContain(SIMULATION_LABEL);
    items(html).forEach((li, i) => {
      const e = plan.events[i] as JourneyPlan["events"][number];
      expect(li.includes(DEMO_CHIP)).toBe(e.demo);
      if (e.demo) expect(li).not.toMatch(/\bverified\b/i);
    });
    expect(html).toContain("Not checked yet");
  });
});
