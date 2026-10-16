// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMode } from "../../app/modeStore";
import { useChatDraft } from "../chat/chatDraftStore";
import { BeforeAfter } from "./BeforeAfter";
import type { Ticket } from "./ticketModel";

const t = (kind: string): Ticket =>
  ({
    id: "a",
    attribute: "step_count",
    kind,
    current: "2",
    hasCurrent: true,
    resolution: { outcome: "correct", value: "2", date: "1 Oct 2026" },
  }) as Ticket;
const view = (ticket: Ticket) =>
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: "/", element: <BeforeAfter ticket={ticket} /> }])}
    />,
  );

describe("BeforeAfter", () => {
  it("Before never repeats the post-resolution value", () => {
    view(t("stroller route Car Park B -> Kiosk"));
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByText("Verified on 1 Oct 2026: 2")).toBeInTheDocument();
  });
  it("shows the replay button only for known starters", () => {
    const { unmount } = view(t("stroller route Car Park B -> Kiosk"));
    expect(screen.getByRole("button", { name: "Ask the question again" })).toBeInTheDocument();
    expect(screen.getByText("The next answer uses the checked fact.")).toBeInTheDocument();
    unmount();
    view(t("Resident question"));
    expect(
      screen.queryByRole("button", { name: "Ask the question again" }),
    ).not.toBeInTheDocument();
  });

  it("hides the replay when the summary is not a parseable route", () => {
    view(t("Wheelchair route to the mall"));
    expect(
      screen.queryByRole("button", { name: "Ask the question again" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("The next answer uses the checked fact.")).not.toBeInTheDocument();
  });
  it("Now falls back to the ticket's current value for a plain confirm", () => {
    view({ ...t("x"), resolution: { outcome: "verify", value: null, date: "1 Oct 2026" } });
    expect(screen.getByText("Verified on 1 Oct 2026: 2")).toBeInTheDocument();
  });

  describe("highlight", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("highlights the after side for 1.2 s", () => {
      view(t("x"));
      const after = screen.getByText(/Verified on/).closest("section");
      expect(after).toHaveAttribute("data-highlight", "true");
      // The focus ring with an offset stays visible on the accent-filled card.
      expect(after).toHaveClass("ring-2", "ring-focus", "ring-offset-2");
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(after).toHaveAttribute("data-highlight", "false");
      expect(after).not.toHaveClass("ring-2");
    });
  });

  describe("replay", () => {
    beforeEach(() => {
      useMode.setState({ mode: "management" });
      useChatDraft.getState().clearAsk();
    });
    it("sets resident mode, queues the starter and goes to the map", async () => {
      const router = createMemoryRouter(
        [
          {
            path: "/tickets",
            element: <BeforeAfter ticket={t("stroller route Car Park B -> Kiosk")} />,
          },
          { path: "/", element: <p>map screen</p> },
        ],
        { initialEntries: ["/tickets"] },
      );
      render(<RouterProvider router={router} />);
      await userEvent.click(screen.getByRole("button", { name: "Ask the question again" }));
      expect(useMode.getState().mode).toBe("resident");
      expect(useChatDraft.getState().pendingAsk).toEqual({
        text: "Stroller route from Car Park B to Kiosk",
        profile: "stroller",
      });
      expect(router.state.location.pathname).toBe("/");
      expect(await screen.findByText("map screen")).toBeInTheDocument();
    });
  });
});
