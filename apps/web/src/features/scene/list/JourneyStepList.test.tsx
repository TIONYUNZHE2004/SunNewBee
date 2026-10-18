import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import demo from "../../journey/fixtures/demoPlan.json";
import type { JourneyPlan } from "../../journey/timeline";
import { JourneyStepList } from "./JourneyStepList";

const plan = demo as unknown as JourneyPlan;

describe("JourneyStepList", () => {
  const html = renderToStaticMarkup(<JourneyStepList plan={plan} />);
  it("numbers every event in order with title and source", () => {
    const lis = html.split("<li").slice(1);
    expect(lis).toHaveLength(plan.events.length);
    plan.events.forEach((e, i) => {
      expect(lis[i] ?? "").toContain(`${i + 1}.`);
      expect(lis[i] ?? "").toContain(e.title.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
      if (e.element_id ?? e.source)
        expect(lis[i] ?? "").toContain(String(e.element_id ?? e.source));
    });
  });
  it("shows the simulation label, the demo chip only on demo events, never Verified on demo", () => {
    expect(html).toContain("Simulation · indicative times, not a prediction");
    const lis = html.split("<li").slice(1);
    plan.events.forEach((e, i) => {
      expect((lis[i] ?? "").includes("Demo value · not surveyed")).toBe(e.demo);
      if (e.demo) expect(lis[i] ?? "").not.toMatch(/>Verified</);
    });
    expect(html).toContain("Not checked yet");
  });
});
