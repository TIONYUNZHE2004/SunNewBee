// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyAssistant, reduceIntent } from "../chat/chatReducer";
import { useScene } from "../scene/sceneStore";
import { ClosureResult } from "./ClosureResult";
import { SIM_RESULT } from "./fixtures";

beforeEach(() => useScene.getState().reset());

describe("ClosureResult (T-027 card, shown under a management answer since T-028)", () => {
  it("shows the engine's numbers and pressure, each suggestion once, its basis in words", () => {
    render(<ClosureResult r={SIM_RESULT} />);
    const card = screen.getByTestId("closure-result");
    expect(card).toHaveTextContent("7 of 63 sample trips change route");
    expect(card).toHaveTextContent("3 trips newly without a mapped route");
    expect(card).toHaveTextContent("data gaps, not the closure");
    expect(card).toHaveTextContent("High detour pressure");
    expect(card).toHaveTextContent("Review signposting the detour via Jalan Dillenia");
    // the basis in plain words for managers, never the engine's raw field path
    expect(card).toHaveTextContent("Based on: 8 weighted sample trips on Persiaran Tamarind");
    expect(card.textContent).not.toContain("detour_roads[");
    // a suggestion text that comes back twice shows once
    expect(card.textContent?.match(/Consider a marshal/g)).toHaveLength(1);
    expect(card).toHaveTextContent("not traffic counts");
    expect(card).toHaveTextContent("Peak weights are an assumed travel pattern, not measured.");
    expect(card.textContent).not.toMatch(/\bsafe\b|minutes? of delay|vehicles/i);
  });

  it("a closure.show intent puts the result on the answer and on the map", () => {
    const intent = { kind: "closure.show", closure: SIM_RESULT } as never;
    expect(reduceIntent(emptyAssistant("a"), intent).closure).toBe(SIM_RESULT);
    useScene.getState().applyIntent(intent);
    expect(useScene.getState().closureSim?.result).toBe(SIM_RESULT);
    // a later route answer is never drawn under the older closure lines
    useScene.getState().applyIntent({
      kind: "route.highlight",
      route_id: "r1",
      geojson: { type: "LineString", coordinates: [] },
    } as never);
    expect(useScene.getState().closureSim).toBeNull();
  });
});
