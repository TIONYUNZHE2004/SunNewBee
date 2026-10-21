// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { AssistantPanel } from "./AssistantPanel";
import { DEVSIM_BRIEF } from "./starters";

const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
const done = { type: "done", message_id: "m", answer_status: "answered", model: "mock" };
const chatStub = () =>
  stubFetch((url) =>
    url.includes("/chat") ? sse([{ type: "text.delta", delta: "ok" }, done]) : json([]),
  );
const pdf = () =>
  new File(["%PDF secret body"], "Elmina_Tower_Brief.pdf", { type: "application/pdf" });
const choose = (file: File) =>
  fireEvent.change(screen.getByTestId("attach-brief-input"), { target: { files: [file] } });

beforeEach(() => useMode.setState({ mode: "management" }));

describe("composer paperclip (developer lens)", () => {
  it("choosing a file shows a removable chip with a PDF badge", () => {
    chatStub();
    renderWithClient(<AssistantPanel />);
    expect(screen.queryByTestId("brief-chip")).toBeNull();
    choose(pdf());
    const chip = screen.getByTestId("brief-chip");
    expect(chip).toHaveTextContent("PDF");
    expect(chip).toHaveTextContent("Elmina_Tower_Brief.pdf");
    fireEvent.click(within(chip).getByRole("button", { name: "Remove Elmina_Tower_Brief.pdf" }));
    expect(screen.queryByTestId("brief-chip")).toBeNull();
  });

  it("send with a chip sends the fixed brief, shows the chip in the user bubble, never uploads the file", async () => {
    const fetchFn = chatStub();
    renderWithClient(<AssistantPanel />);
    choose(pdf());
    const ask = screen.getByRole("button", { name: "Ask" });
    expect(ask).toBeEnabled();
    fireEvent.click(ask);
    await waitFor(() =>
      expect(fetchFn.mock.calls.some(([u]) => String(u).includes("/chat"))).toBe(true),
    );
    const chat = fetchFn.mock.calls.find(([u]) => String(u).includes("/chat"));
    expect(JSON.parse(String(chat?.[1]?.body)).message).toBe(DEVSIM_BRIEF);
    for (const [, init] of fetchFn.mock.calls) {
      expect(init?.body instanceof FormData).toBe(false);
      expect(init?.body instanceof Blob).toBe(false);
      expect(String(init?.body ?? "")).not.toContain("secret body");
      expect(String(init?.body ?? "")).not.toContain("Elmina_Tower_Brief");
    }
    const bubble = await screen.findByText(DEVSIM_BRIEF, { selector: "p" });
    expect(bubble.parentElement).toHaveTextContent("Elmina_Tower_Brief.pdf");
    // the composer chip is gone once sent
    expect(screen.getAllByTestId("brief-chip")).toHaveLength(1);
  });

  it("the development brief starter is in Management and sends the same text", async () => {
    const fetchFn = chatStub();
    renderWithClient(<AssistantPanel />);
    fireEvent.click(screen.getByRole("button", { name: DEVSIM_BRIEF }));
    await waitFor(() =>
      expect(fetchFn.mock.calls.some(([u]) => String(u).includes("/chat"))).toBe(true),
    );
    const chat = fetchFn.mock.calls.find(([u]) => String(u).includes("/chat"));
    expect(JSON.parse(String(chat?.[1]?.body)).message).toBe(DEVSIM_BRIEF);
  });

  it("no paperclip and no development starter for residents", () => {
    useMode.setState({ mode: "resident" });
    chatStub();
    renderWithClient(<AssistantPanel />);
    expect(screen.queryByRole("button", { name: "Attach a brief" })).toBeNull();
    expect(screen.queryByRole("button", { name: DEVSIM_BRIEF })).toBeNull();
  });
});
