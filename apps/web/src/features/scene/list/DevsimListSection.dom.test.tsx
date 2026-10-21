// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDevsim } from "../../devsim/devsimStore";
import provisional from "../../devsim/fixtures/plan.provisional.json";
import { NOT_AVAILABLE } from "../../devsim/intent";
import type { DevelopmentPlan } from "../../devsim/types";
import { DevsimListSection } from "./DevsimListSection";
import { devsimListModel } from "./devsimListModel";

const plan = provisional as unknown as DevelopmentPlan;
const d = () => useDevsim.getState();

beforeEach(() => d().stop());
afterEach(cleanup);

describe("devsimListModel", () => {
  it("acts progress with t", () => {
    expect(devsimListModel(plan, 20).acts.map((a) => a.state)).toEqual([
      "done",
      "on",
      "todo",
      "todo",
      "todo",
    ]);
    expect(devsimListModel(plan, 66).acts.every((a) => a.state === "done")).toBe(true);
  });

  it("every bubble is a quote with speaker, role and tag, in order", () => {
    const { quotes } = devsimListModel(plan, 19);
    expect(quotes.map((q) => q.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(quotes[0]).toMatchObject({
      speaker: "Pak Cik Halim",
      role: "existing resident",
      text: "Footpath closed lah, must walk the other side now",
      tag: "ROUTE ENGINE · +3 min walk · 2,516 → 2,754 m",
      speaking: true,
      heard: true,
    });
    expect(quotes[1]).toMatchObject({ speaker: "Farid", tag: null, speaking: false, heard: false });
  });
});

describe("DevsimListSection", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<DevsimListSection />);
    expect(container.textContent).toBe("");
  });

  it("text version: labels, acts, quotes and, at the end, the end card", () => {
    d().start(plan, "b");
    render(<DevsimListSection />);
    act(() => d().seek(54));
    const list = screen.getByTestId("devsim-list");
    expect(within(list).getByText("Simulation · illustrative")).toBeInTheDocument();
    expect(within(list).getByTestId("devsim-hypothetical")).toHaveAccessibleName(
      "Hypothetical development · not an SDP project · 30 storeys · ~500 homes",
    );
    expect(within(list).getByRole("listitem", { current: "step" })).toHaveTextContent("Daily Life");
    const quotes = within(list).getAllByTestId("devsim-quote");
    expect(quotes).toHaveLength(7);
    expect(quotes[5]).toHaveTextContent("“Park in 9 min, love it”");
    expect(quotes[5]).toHaveTextContent("Mak Cik Zainab, new resident");
    expect(quotes[5]).toHaveTextContent("659 m · 9 min walk");
    expect(quotes[5]).toHaveAttribute("data-speaking", "true");
    expect(within(list).queryByTestId("devsim-end-card")).toBeNull();
    act(() => d().seek(66));
    const card = within(list).getByTestId("devsim-end-card");
    expect(within(card).getAllByTestId("devsim-end-item")).toHaveLength(3);
    expect(card).toHaveTextContent("What residents raised");
  });

  it("AC-H6: shows the not-available message on a 404", () => {
    d().start(null, "b");
    act(() => d().setStatus("unavailable"));
    render(<DevsimListSection />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Development simulation is not available for this map.",
    );
    expect(NOT_AVAILABLE).toBe("Development simulation is not available for this map.");
  });

  it("the not-available alert can be dismissed (I2)", () => {
    d().start(null, "b");
    act(() => d().setStatus("unavailable"));
    const { container } = render(<DevsimListSection />);
    fireEvent.click(screen.getByRole("button", { name: "Close simulation" }));
    expect(d().status).toBe("idle");
    expect(container.textContent).toBe("");
  });

  it("loading says so politely", () => {
    d().start(null, "b");
    render(<DevsimListSection />);
    expect(screen.getByRole("status")).toHaveTextContent(/Preparing the development simulation/);
  });
});
