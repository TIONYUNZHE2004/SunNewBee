// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDevsim } from "../../devsim/devsimStore";
import elmina from "../../devsim/fixtures/plan.elmina.json";
import { NOT_AVAILABLE } from "../../devsim/intent";
import type { DevelopmentPlan } from "../../devsim/types";
import { DevsimListSection } from "./DevsimListSection";
import { devsimListModel } from "./devsimListModel";

const plan = elmina as unknown as DevelopmentPlan;
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
    ]);
    expect(devsimListModel(plan, 45).acts.every((a) => a.state === "done")).toBe(true);
  });

  it("every bubble is a quote with speaker, role and tag, in order", () => {
    const { quotes } = devsimListModel(plan, 6);
    const b1 = plan.bubbles[0] as DevelopmentPlan["bubbles"][0];
    expect(quotes.map((q) => q.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(quotes[0]).toMatchObject({
      speaker: "Pak Cik Halim",
      role: "existing resident",
      text: b1.text,
      tag: b1.tag,
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

  it("text version: labels, HUD, acts, quotes, banners and, from 33 s, the Impact Brief and residents", () => {
    d().start(plan, "b");
    render(<DevsimListSection />);
    act(() => d().seek(12));
    const list = screen.getByTestId("devsim-list");
    expect(within(list).getByText("Simulation · illustrative")).toBeInTheDocument();
    expect(within(list).getByTestId("devsim-hypothetical")).toHaveAccessibleName(
      plan.labels.hypothetical,
    );
    expect(within(list).getByTestId("devsim-estimate-hud")).toBeInTheDocument();
    expect(within(list).getByTestId("devsim-schedule-bar")).toBeInTheDocument();
    const raya = plan.banners.find((b) => b.kind === "raya");
    if (raya) expect(within(list).getByTestId("devsim-banner")).toHaveTextContent(raya.title);
    expect(within(list).queryByTestId("devsim-impact-brief")).toBeNull();
    act(() => d().seek(35));
    expect(within(list).getByRole("listitem", { current: "step" })).toHaveTextContent("Daily Life");
    const quotes = within(list).getAllByTestId("devsim-quote");
    expect(quotes).toHaveLength(7);
    const z = plan.bubbles.find((b) => b.who === "zainab") as DevelopmentPlan["bubbles"][0];
    const zq = quotes[z.n - 1] as HTMLElement;
    expect(zq).toHaveTextContent(`“${z.text}”`);
    expect(zq).toHaveTextContent("Mak Cik Zainab, new resident");
    expect(zq).toHaveAttribute("data-speaking", "true");
    const brief = within(list).getByTestId("devsim-impact-brief");
    expect(brief).toHaveTextContent("During construction");
    expect(brief).toHaveTextContent("Indicative scenario, not a forecast.");
    expect(within(list).getByRole("button", { name: /Simulated residents · 40/ })).toBeVisible();
    expect(within(list).queryByTestId("devsim-end-card")).toBeNull();
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
