// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { AssistantPanel } from "./AssistantPanel";

const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const done = (status: string) => ({
  type: "done",
  message_id: "m",
  answer_status: status,
  model: "mock",
});

beforeEach(() => useMode.setState({ mode: "resident" }));

describe("AssistantPanel", () => {
  it("empty state shows the heading, sub line and resident starters", () => {
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    expect(screen.getByRole("heading", { name: "Ask about getting around" })).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /route|evacuation|recycling/i }).length,
    ).toBeGreaterThanOrEqual(3);
  });
  it("management mode swaps heading, starters and placeholder", () => {
    useMode.setState({ mode: "management" });
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    expect(screen.getByRole("heading", { name: "Ask about the township" })).toBeVisible();
    expect(screen.getByPlaceholderText("Describe your plan or ask about an area")).toBeVisible();
  });
  it("starter questions are icon cards in a grid and one tap sends", () => {
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    const cards = screen.getAllByRole("button", {
      name: /route|evacuation|recycling|cut off|isolated|place/i,
    });
    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(cards[0]?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });
  it("the starter card lift only runs when motion is allowed", () => {
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    const card = screen.getAllByRole("button", { name: /route/i })[0] as HTMLElement;
    const classes = card.className.split(/\s+/);
    expect(classes).toContain("motion-safe:hover:-translate-y-px");
    expect(classes).not.toContain("hover:-translate-y-px");
    expect(classes).not.toContain("transition");
  });
  it("tapping a starter card sends it", async () => {
    const fetchFn = stubFetch((url) =>
      url.includes("/chat")
        ? sse([{ type: "text.delta", delta: "ok" }, done("answered")])
        : json([]),
    );
    renderWithClient(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Where to drop off recycling/ }));
    expect(await screen.findByText("Where to drop off recycling", { selector: "p" })).toBeVisible();
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes("/chat"))).toBe(true);
  });
  it("the suggestion chips row scrolls sideways without a visible scrollbar; chips stay tabbable", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([{ type: "text.delta", delta: "ok" }, done("answered")])
        : json([]),
    );
    renderWithClient(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Where to drop off recycling/ }));
    await screen.findByText("Where to drop off recycling", { selector: "p" });
    const chip = screen
      .getAllByRole("button", { name: /Where to drop off recycling/ })
      .find((b) => b.className.includes("rounded-full")) as HTMLElement;
    const row = chip.parentElement as HTMLElement;
    expect(row.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["overflow-x-auto", "no-scrollbar"]),
    );
    expect(chip.tabIndex).toBe(0);
  });
  describe("Travelling-as keyboard pattern", () => {
    const openChip = () => {
      stubFetch(() => json([]));
      useScene.getState().setProfile("default");
      renderWithClient(
        <>
          <AssistantPanel />
          <button type="button">outside</button>
        </>,
      );
      const chip = screen.getByRole("button", { name: /^Travelling as:/ });
      fireEvent.click(chip);
      return chip;
    };
    it("arrows, Home and End move focus with wrapping", () => {
      openChip();
      const o = screen.getAllByRole("option");
      expect(o[0]).toHaveFocus();
      fireEvent.keyDown(o[0] as HTMLElement, { key: "ArrowDown" });
      expect(o[1]).toHaveFocus();
      fireEvent.keyDown(o[1] as HTMLElement, { key: "End" });
      expect(o[o.length - 1]).toHaveFocus();
      fireEvent.keyDown(o[o.length - 1] as HTMLElement, { key: "ArrowDown" });
      expect(o[0]).toHaveFocus();
      fireEvent.keyDown(o[0] as HTMLElement, { key: "ArrowUp" });
      expect(o[o.length - 1]).toHaveFocus();
      fireEvent.keyDown(o[o.length - 1] as HTMLElement, { key: "Home" });
      expect(o[0]).toHaveFocus();
      expect(o.filter((x) => x.tabIndex === 0)).toHaveLength(1);
    });
    it("Enter selects and returns focus to the chip", () => {
      const chip = openChip();
      const o = screen.getAllByRole("option");
      fireEvent.keyDown(o[0] as HTMLElement, { key: "ArrowDown" });
      fireEvent.keyDown(o[1] as HTMLElement, { key: "Enter" });
      expect(useScene.getState().profile).toBe("stroller");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(screen.getByRole("button", { name: "Travelling as: Stroller" })).toHaveFocus();
      expect(chip).toBeDefined();
    });
    it("Escape closes and returns focus to the chip", () => {
      openChip();
      fireEvent.keyDown(screen.getAllByRole("option")[0] as HTMLElement, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(screen.getByRole("button", { name: /^Travelling as:/ })).toHaveFocus();
    });
    it("tabbing away closes the list", () => {
      openChip();
      const outside = screen.getByRole("button", { name: "outside" });
      fireEvent.blur(screen.getAllByRole("option")[0] as HTMLElement, { relatedTarget: outside });
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    it("a mousedown outside closes the list", () => {
      openChip();
      fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });
  it("resident mode shows a Travelling-as chip that changes the shared profile", () => {
    useMode.setState({ mode: "resident" });
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Travelling as:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Wheelchair" }));
    expect(useScene.getState().profile).toBe("wheelchair");
    expect(screen.getByRole("button", { name: "Travelling as: Wheelchair" })).toBeInTheDocument();
  });
  it("management mode has no Travelling-as chip", () => {
    useMode.setState({ mode: "management" });
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    expect(screen.queryByRole("button", { name: /^Travelling as:/ })).toBeNull();
  });
  it("send button is named Ask", () => {
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
  });
  it("renders a refusal as a calm 'Can't answer that yet', not an error", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([
            { type: "text.delta", delta: "I don't have checked data about that yet." },
            done("cannot_answer"),
          ])
        : json([]),
    );
    renderWithClient(<AssistantPanel />);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "something odd");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Can't answer that yet")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("a transport failure shows an alert with Try again", async () => {
    stubFetch((url) => (url.includes("/chat") ? new Response("no", { status: 500 }) : json([])));
    renderWithClient(<AssistantPanel />);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
  it("orders the answer: text, uncertainty, disclaimer, ticket line; log is polite", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([
            { type: "text.delta", delta: "Take the east walk." },
            {
              type: "uncertainty",
              level: "partial",
              items: [{ note: "Step count not checked yet" }],
            },
            {
              type: "disclaimer",
              lens: "flood",
              text: "Indicative scenario, not a forecast.",
              links: [],
            },
            {
              type: "verification.requested",
              request_id: "vr-1",
              element_id: "x",
              attribute: "step_count",
              created: true,
              demand: 1,
              reason: "unknown",
            },
            done("partial"),
          ])
        : json([]),
    );
    renderWithClient(<AssistantPanel />);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "route");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const card = await screen.findByRole("article");
    const text = card.textContent ?? "";
    expect(text.indexOf("Take the east walk.")).toBeLessThan(text.indexOf("Not verified"));
    expect(text.indexOf("Not verified")).toBeLessThan(text.indexOf("not a forecast"));
    expect(text.indexOf("not a forecast")).toBeLessThan(text.indexOf("A check has been requested"));
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });
  it("invalidates the tickets cache when a ticket is filed from chat", async () => {
    const fetchFn = stubFetch((url) =>
      url.includes("/chat")
        ? sse([
            {
              type: "verification.requested",
              request_id: "vr-1",
              element_id: "x",
              attribute: "step_count",
              created: true,
              demand: 1,
              reason: "unknown",
            },
            done("partial"),
          ])
        : json([]),
    );
    const qc = newQueryClient();
    qc.setQueryData(["tickets", "all"], []);
    renderWithClient(<AssistantPanel />, qc);
    const before = fetchFn.mock.calls.length;
    expect(qc.getQueryState(["tickets", "all"])?.isInvalidated).toBe(false);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "route");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("article");
    await waitFor(() => expect(qc.getQueryState(["tickets", "all"])?.isInvalidated).toBe(true));
    expect(fetchFn.mock.calls.length).toBeGreaterThan(before);
  });
});
