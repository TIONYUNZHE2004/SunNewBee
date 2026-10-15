// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { STARTERS } from "../assistant/starters";
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
    view(t("Stroller route from A to B"));
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByText("Verified on 1 Oct 2026: 2")).toBeInTheDocument();
  });
  it("shows the replay button only for known starters", () => {
    const { unmount } = view(t("Stroller route from A to B"));
    expect(screen.getByRole("button", { name: "Ask the question again" })).toBeInTheDocument();
    expect(screen.getByText("The next answer uses the checked fact.")).toBeInTheDocument();
    unmount();
    view(t("Resident question"));
    expect(
      screen.queryByRole("button", { name: "Ask the question again" }),
    ).not.toBeInTheDocument();
  });

  describe("replay", () => {
    beforeEach(() => {
      useMode.setState({ mode: "management" });
      useChatDraft.getState().clearAsk();
    });
    it("sets resident mode, queues the starter and goes to the map", async () => {
      const router = createMemoryRouter(
        [
          { path: "/tickets", element: <BeforeAfter ticket={t("Stroller route from A to B")} /> },
          { path: "/", element: <p>map screen</p> },
        ],
        { initialEntries: ["/tickets"] },
      );
      render(<RouterProvider router={router} />);
      await userEvent.click(screen.getByRole("button", { name: "Ask the question again" }));
      expect(useMode.getState().mode).toBe("resident");
      const starter = STARTERS.resident[0];
      expect(useChatDraft.getState().pendingAsk).toEqual({
        text: starter.text,
        profile: starter.profile,
      });
      expect(router.state.location.pathname).toBe("/");
      expect(await screen.findByText("map screen")).toBeInTheDocument();
    });
  });
});
