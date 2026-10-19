// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { honestyViolations } from "../../test/honesty";
import {
  DEMO_CHIP,
  journeyCardContent,
  NOT_CHECKED,
  VR_FILED,
  withVerificationRequest,
} from "./cardContent";
import demoPlan from "./fixtures/demoPlan.json";
import { JourneyOverlay } from "./JourneyOverlay";
import { useJourney } from "./journeyStore";
import { SIM_LABEL } from "./SimulationLabel";
import { buildTimeline, type JourneyEvent, type JourneyPlan } from "./timeline";

/**
 * AC-D6 (UI part): no journey UI string says "safe" / "selamat" / "安全" or states a water depth,
 * and "Verified" appears only for a verified claim that is not a demo value.
 */
const plan = demoPlan as unknown as JourneyPlan;
const tl = buildTimeline(plan);
const here = dirname(fileURLToPath(import.meta.url));
const VERIFIED = /\bverified\b/i;

afterEach(() => useJourney.getState().clear());

describe("AC-D6 journey UI wording", () => {
  it("fixed strings are honest", () => {
    for (const s of [SIM_LABEL, DEMO_CHIP, NOT_CHECKED, VR_FILED])
      expect(honestyViolations(s)).toEqual([]);
  });

  it("every card text, for every kind x status x demo x VR, is honest; no Verified on demo or unverified", () => {
    const kinds: JourneyEvent["kind"][] = [
      "covered",
      "unknown",
      "gap",
      "verified",
      "rest",
      "arrive",
    ];
    const statuses: JourneyEvent["status"][] = [
      "unknown",
      "reported",
      "verified",
      "stale",
      "contested",
      "unverified",
      "route",
    ];
    for (const kind of kinds)
      for (const status of statuses)
        for (const demo of [true, false])
          for (const vr of [true, false]) {
            const e: JourneyEvent = {
              kind,
              status,
              demo,
              at_m: 0,
              element_id: "seg-x",
              evidence_id: "ev",
              title: "",
              body: "",
              hold_s: 3,
            };
            const c = withVerificationRequest(journeyCardContent(e), e, vr);
            for (const s of [c.source, c.statusLabel]) {
              expect(honestyViolations(s)).toEqual([]);
              if (demo || status !== "verified") expect(s).not.toMatch(VERIFIED);
            }
          }
  });

  it("the rendered overlay at every hold of the demo plan is honest", () => {
    act(() => {
      useJourney.getState().load(plan);
      useJourney.getState().noteVr("seg-1306543755-2", "incline_pct");
    });
    const { container } = render(
      <JourneyOverlay project={() => ({ x: 400, y: 300 })} viewport={{ w: 1200, h: 800 }} />,
    );
    for (const p of tl.phases) {
      act(() => useJourney.getState().seek((p.t0 + p.t1) / 2));
      const text = container.textContent ?? "";
      expect(honestyViolations(text)).toEqual([]);
      expect(text).toContain(SIM_LABEL);
      if (p.event) {
        const card = screen.getByTestId("journey-card").textContent ?? "";
        if (p.event.demo || p.event.status !== "verified") expect(card).not.toMatch(VERIFIED);
        expect(card.includes(DEMO_CHIP)).toBe(p.event.demo);
      }
    }
  });

  it("no string literal in the journey UI source says safe / selamat / 安全 or a depth", () => {
    const files = readdirSync(here).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = readFileSync(join(here, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const literals = [...code.matchAll(/"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)].map(
        (m) => m[1] ?? m[2] ?? m[3] ?? "",
      );
      for (const s of literals) expect(honestyViolations(s), `${f}: ${s}`).toEqual([]);
    }
  });
});
