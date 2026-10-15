// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../test/helpers";
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
