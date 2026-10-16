// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { TicketList } from "./TicketList";
import { TicketsPage } from "./TicketsPage";
import type { Ticket } from "./ticketModel";

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
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((x) => x.textContent)).toEqual(["To check2", "Checked1"]);
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
    expect(screen.getByRole("group", { name: "What did you find on site?" })).toBeInTheDocument();
  });
});

const tk = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  attribute: "step_count",
  fact: `Fact ${id}`,
  place: `Place ${id}`,
  reason: "unknown",
  reasonLabel: "Unknown",
  kind: "k",
  asked: 1,
  ago: "just now",
  current: null,
  hasCurrent: false,
  isOpen: true,
  isRejected: false,
  isChecked: false,
  resolution: null,
  createdMs: 0,
  resolvedMs: 0,
  ...over,
});

describe("TicketList tabs and meter", () => {
  const t1 = tk("t1");
  const t2 = tk("t2");
  const t3 = tk("t3", { isOpen: false, isChecked: true });
  it("To check and Checked are tabs with counts", () => {
    render(<TicketList toCheck={[t1, t2]} checked={[t3]} selectedId={null} onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["To check2", "Checked1"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[1] as HTMLElement);
    expect(screen.getByRole("tabpanel")).toHaveTextContent(t3.fact);
  });
  it("opens on Checked when nothing is left to check", () => {
    render(<TicketList toCheck={[]} checked={[t3]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });
  it("each open ticket shows how often it was asked as a meter", () => {
    render(
      <TicketList
        toCheck={[
          { ...t1, asked: 3 },
          { ...t2, asked: 1 },
        ]}
        checked={[]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const m = screen.getAllByRole("meter");
    expect(m[0]).toHaveAttribute("aria-valuenow", "3");
    expect(m[0]).toHaveAttribute("aria-valuemax", "3");
    expect(m[0]).toHaveAccessibleName("Asked 3 times");
    expect(m[1]).toHaveAccessibleName("Asked 1 time");
  });
  it("tabs use roving tabindex and arrow, Home and End keys", () => {
    render(<TicketList toCheck={[t1]} checked={[t3]} selectedId={null} onSelect={() => {}} />);
    const [a, b] = screen.getAllByRole("tab") as HTMLElement[];
    expect([a?.tabIndex, b?.tabIndex]).toEqual([0, -1]);
    fireEvent.keyDown(a as HTMLElement, { key: "ArrowRight" });
    expect(b).toHaveAttribute("aria-selected", "true");
    expect(b).toHaveFocus();
    expect([a?.tabIndex, b?.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(b as HTMLElement, { key: "ArrowRight" });
    expect(a).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(a as HTMLElement, { key: "ArrowLeft" });
    expect(b).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(b as HTMLElement, { key: "Home" });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a as HTMLElement, { key: "End" });
    expect(b).toHaveFocus();
  });
  it("follows the selected ticket when it moves to Checked", () => {
    const p = { selectedId: "t1", onSelect: () => {}, checked: [] as Ticket[] };
    const { rerender } = render(<TicketList toCheck={[t1]} {...p} />);
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    rerender(<TicketList toCheck={[]} {...p} checked={[{ ...t1, isChecked: true }]} />);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });
});
