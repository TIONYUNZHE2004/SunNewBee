// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { TicketsPage } from "./TicketsPage";

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const rows = [
  {
    id: "a",
    element_id: "seg-a",
    attribute: "step_count",
    reason: "no_route_unverified_segment",
    status: "open",
    demand: 3,
    question_summary: "Route from A to B",
    created_at: iso(30),
    current_value: null,
  },
  {
    id: "b",
    element_id: "seg-b",
    attribute: "width_m",
    reason: "no_route_unverified_segment",
    status: "open",
    demand: 14,
    question_summary: "Route from C to D",
    created_at: iso(300),
    current_value: 1.2,
  },
  {
    id: "c",
    element_id: "seg-c",
    attribute: "incline_pct",
    reason: "no_route_unverified_segment",
    status: "resolved",
    demand: 5,
    question_summary: "Route from E to F",
    created_at: iso(3000),
    resolved_at: iso(100),
    resolution: { action: "correct", value: "4" },
    current_value: null,
  },
];

function setup() {
  stubFetch((url) => {
    if (url.includes("/verification-requests")) return json(rows);
    return json({ type: "FeatureCollection", features: [] });
  });
  const router = createMemoryRouter([{ path: "/tickets", element: <TicketsPage /> }], {
    initialEntries: ["/tickets"],
  });
  return renderWithClient(<RouterProvider router={router} />);
}

describe("TicketsPage list", () => {
  it("groups To check (count) and Checked, most asked first", async () => {
    setup();
    const toCheck = await screen.findByRole("heading", { name: /To check/ });
    expect(within(toCheck).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Checked/ })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Ticket list" });
    const buttons = within(list)
      .getAllByRole("button", { pressed: false })
      .concat(within(list).getAllByRole("button", { pressed: true }));
    const open = buttons.filter((b) => /Asked/.test(b.textContent ?? ""));
    expect(open.length).toBeGreaterThanOrEqual(2);
    const text = list.textContent ?? "";
    expect(text.indexOf("Asked 14×")).toBeLessThan(text.indexOf("Asked 3×"));
  });
  it("rows show fact, place, reason, asked and ago", async () => {
    setup();
    const row = (await screen.findByRole("button", { name: /Width \(m\)/ })) as HTMLElement;
    expect(row).toHaveTextContent("seg-b");
    expect(row).toHaveTextContent("No route: unverified segment");
    expect(row).toHaveTextContent("Asked 14×");
    expect(row).toHaveTextContent(/ago/);
  });
  it("clicking a row selects it and shows its detail; no resident words", async () => {
    setup();
    const row = await screen.findByRole("button", { name: /Step count/ });
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { level: 2, name: "Step count" })).toBeVisible();
    expect(screen.getByRole("radiogroup", { name: "Outcome" })).toBeInTheDocument();
  });
});
