// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { VerificationQueue } from "./VerificationQueue";

const vr = (o: Record<string, unknown>) => ({
  id: "vr-1",
  element_id: "seg-cf",
  attribute: "incline_pct",
  reason: "no_route_unverified_segment",
  status: "open",
  demand: 2,
  created_at: "2026-10-15T00:00:00Z",
  current_value: null,
  ...o,
});
const ACCESS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: { id: "seg-cf", type: "footway", name: null },
    },
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: { id: "seg-mr", type: "major_road", name: "Jalan Utama" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [101, 3] },
      properties: { id: "pl-k", type: "kiosk", name: "Kiosk" },
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// openapi-fetch binds fetch at import time, so serve the access layer by mocking the hook.
vi.mock("../../lib/api", () => ({ useLayer: () => ({ data: ACCESS }) }));

function stub(rows: unknown[]) {
  stubFetch((url) => (url.includes("/verification-requests") ? json(rows) : json([])));
}

describe("VerificationQueue rows", () => {
  it("shows catalogue label, element name, muted raw id and reason in words", async () => {
    stub([
      vr({}),
      vr({ id: "vr-2", element_id: "seg-mr", attribute: "sidewalk", reason: "stale" }),
      vr({ id: "vr-3", element_id: "pl-k", attribute: "wheelchair", reason: "unknown" }),
    ]);
    renderWithClient(
      <MemoryRouter>
        <VerificationQueue />
      </MemoryRouter>,
    );
    const row1 = (await screen.findByText("Unnamed footway")).closest("tr") as HTMLElement;
    expect(within(row1).getByText("Incline (%)")).toBeInTheDocument();
    expect(within(row1).getByText("seg-cf")).toHaveClass("text-ink-soft");
    expect(within(row1).getByText("incline_pct")).toBeInTheDocument();
    expect(within(row1).getByText("No route: unverified segment")).toBeInTheDocument();
    const row2 = screen.getByText("Jalan Utama").closest("tr") as HTMLElement;
    expect(within(row2).getByText("Stale")).toBeInTheDocument();
    const row3 = screen.getByText("Kiosk").closest("tr") as HTMLElement;
    expect(within(row3).getByText("Wheelchair")).toBeInTheDocument();
  });

  it("filter dropdown shows words but keeps raw values", async () => {
    stub([vr({})]);
    renderWithClient(
      <MemoryRouter>
        <VerificationQueue />
      </MemoryRouter>,
    );
    await screen.findByText("Incline (%)");
    const opt = screen.getByRole("option", { name: "No route: unverified segment" });
    expect(opt).toHaveValue("no_route_unverified_segment");
  });
});

describe("VerificationQueue filters", () => {
  it("sends a typed attribute once after a pause, not per keystroke", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      if (url.includes("/verification-requests")) urls.push(url);
      return url.includes("/verification-requests") ? json([vr({})]) : json([]);
    });
    renderWithClient(
      <MemoryRouter>
        <VerificationQueue />
      </MemoryRouter>,
    );
    await screen.findByText("Unnamed footway");
    await userEvent.type(screen.getByLabelText("Attribute"), "incl");
    await waitFor(() => expect(urls.some((u) => u.includes("attribute=incl"))).toBe(true));
    expect(urls.filter((u) => u.includes("attribute="))).toHaveLength(1);
  });

  it("explains that rejected requests sit under All", async () => {
    stub([]);
    renderWithClient(
      <MemoryRouter>
        <VerificationQueue />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Resolved" }));
    expect(screen.getByText("Rejected requests are listed under All.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Request status" })).toBeInTheDocument();
  });
});
