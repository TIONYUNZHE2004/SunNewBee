// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { TicketsPage } from "./TicketsPage";
import { useStaffTokenStore } from "./useStaffToken";

const vr = (id: string, demand: number, over: object = {}) => ({
  id,
  element_id: `e-${id}`,
  attribute: "step_count",
  reason: "unknown",
  status: "open",
  demand,
  created_at: "2026-10-01T00:00:00Z",
  resolved_at: null,
  current_value: null,
  question_summary: "stroller route A -> B",
  resolution: null,
  ...over,
});

beforeEach(() => useStaffTokenStore.setState({ token: "tok" }));

describe("TicketsPage", () => {
  it("leaves room at the bottom for the attribution strip", async () => {
    stubFetch((url) => json(url.includes("verification-requests") ? [vr("one", 5)] : []));
    const { container } = renderWithClient(
      <MemoryRouter>
        <TicketsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Gaps to close" });
    expect(container.firstElementChild).toHaveClass("pb-10");
  });
  it("keeps the auto-selected ticket after Save instead of jumping to the next", async () => {
    let first: object = vr("one", 5);
    stubFetch((url, init) => {
      if (init?.method === "POST" && url.includes("/resolve")) {
        first = vr("one", 5, {
          status: "resolved",
          resolved_at: "2026-10-02T00:00:00Z",
          current_value: "2",
          resolution: { action: "correct", value: 2 },
        });
        return json({});
      }
      if (url.includes("verification-requests")) return json([first, vr("two", 1)]);
      return json([]);
    });
    renderWithClient(
      <MemoryRouter>
        <TicketsPage />
      </MemoryRouter>,
    );
    await screen.findByRole("group", { name: "What did you find on site?" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /Record what you found/ }));
    await user.type(screen.getByLabelText("Value found on site"), "2");
    await user.click(screen.getByRole("button", { name: "Save result" }));
    expect(await screen.findByText(/Verified on/)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "What did you find on site?" }),
    ).not.toBeInTheDocument();
  });
});
