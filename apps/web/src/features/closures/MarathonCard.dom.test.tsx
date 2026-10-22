// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyAssistant, reduceIntent } from "../chat/chatReducer";
import { useScene } from "../scene/sceneStore";
import { MARATHON } from "./fixtures";
import { MarathonCard } from "./MarathonCard";

beforeEach(() => useScene.getState().reset());

describe("MarathonCard (T-028)", () => {
  it("shows the proposed course, its roads in order with lengths, then the impact", () => {
    render(<MarathonCard m={MARATHON} />);
    const card = screen.getByTestId("marathon-course");
    expect(card).toHaveTextContent("Proposed 5.1 km loop course");
    expect(card).toHaveTextContent("Proposed course on mapped roads, not an approved route.");
    const roads = within(screen.getByRole("list", { name: "Course roads in order" }));
    expect(roads.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1. Persiaran Tamarind377 m",
      "2. Persiaran Dillenia489 m",
    ]);
    expect(within(card).getByTestId("closure-result")).toHaveTextContent(
      "4 sample trips start or end on the closed road: plan access for them",
    );
  });

  it("a marathon.show intent puts the course on the answer and its lines on the map", () => {
    const intent = { kind: "marathon.show", marathon: MARATHON } as never;
    expect(reduceIntent(emptyAssistant("a"), intent).marathon).toBe(MARATHON);
    useScene.getState().applyIntent(intent);
    expect(useScene.getState().closureSim?.result).toBe(MARATHON.impact);
  });
});
