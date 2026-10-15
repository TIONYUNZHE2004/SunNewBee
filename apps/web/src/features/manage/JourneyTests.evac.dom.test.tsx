// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { EvacuationTable, JourneyTests } from "./JourneyTests";
import type { SimReport } from "./manageApi";

const counts = (o: Partial<Record<string, number>>) => ({
  reachable_confirmed: 0,
  reachable_partly_unverified: 0,
  blocked_by_flood: 0,
  no_mapped_connection: 0,
  no_centre: 0,
  ...o,
});

const REPORT: SimReport = {
  run_id: "sim-0123456789abcdef",
  created_at: "2026-10-15T00:00:00Z",
  scenario_id: null,
  counts: { stroller: { success: 2 } },
  results: [],
  gaps: [],
  invariant_violations: [],
  gaps_truncated: false,
  rest_long_segments: 0,
  world_version: 0,
  evacuation: {
    origins_sampled: 50,
    origins_available: 192,
    origins_excluded_centres: 15,
    seed: 47,
    violations: [],
    rows: [
      {
        profile: "stroller",
        scenario_id: "baseline",
        total: 50,
        counts: counts({
          reachable_confirmed: 40,
          reachable_partly_unverified: 6,
          no_mapped_connection: 4,
        }),
      },
      {
        profile: "stroller",
        scenario_id: "stage_p3m",
        total: 50,
        counts: counts({
          reachable_confirmed: 20,
          blocked_by_flood: 12,
          no_mapped_connection: 4,
          reachable_partly_unverified: 14,
        }),
      },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("EvacuationTable", () => {
  it("shows profile x river level with counts per result, in plain words", () => {
    renderWithClient(<EvacuationTable report={REPORT} />);
    const table = screen.getByRole("table", { name: /Evacuation journey results/ });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    for (const h of [
      "Reachable (confirmed)",
      "Reachable (some parts unverified)",
      "Blocked (known barrier or flood)",
      "No mapped connection (data gap)",
      "No evacuation centre mapped",
    ])
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    const r3 = rows[2] as HTMLElement;
    expect(within(r3).getByRole("rowheader")).toHaveTextContent("Stroller");
    expect(r3).toHaveTextContent("River +3 m (indicative)");
    expect(r3).toHaveTextContent("12 of 50");
    expect(screen.getByText(/50 of 192 mapped starting places/)).toBeInTheDocument();
    expect(
      screen.getByText(/15 places that are an evacuation centre themselves are left out/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not forecasts/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bsafe\b|not reachable/i);
  });

  it("says so for an older run without evacuation journeys", () => {
    const { evacuation: _e, ...old } = REPORT;
    renderWithClient(<EvacuationTable report={old as SimReport} />);
    expect(screen.getByText(/no evacuation journeys/i)).toBeInTheDocument();
  });
});

describe("JourneyTests async run", () => {
  it("starts with a 202, polls, shows progress, and stops polling when done", async () => {
    let polls = 0;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/scenarios") return json([]);
      if (url.startsWith("/api/simulations?")) return json([]);
      if (url === "/api/simulations" && init?.method === "POST")
        return json({ run_id: "sim-abc", status: "queued" }, 202);
      if (url === "/api/simulations/sim-abc") {
        polls++;
        return polls < 3
          ? json({
              run_id: "sim-abc",
              status: "running",
              progress: `Evacuation journeys: ${polls * 100} of 1000`,
            })
          : json({ run_id: "sim-abc", status: "done", report: REPORT });
      }
      return json({}, 404);
    });
    const user = userEvent.setup();
    renderWithClient(<JourneyTests pollMs={20} />);
    await user.click(screen.getByRole("button", { name: "Run journey tests" }));
    expect(await screen.findByText(/Evacuation journeys: 100 of 1000/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running journey tests…" })).toBeDisabled();
    expect(await screen.findByText(/finished/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Evacuation journey results/ })).toBeInTheDocument();
    const seen = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/simulations/sim-abc").length;
    const n = seen();
    expect(n).toBe(3);
    await new Promise((r) => setTimeout(r, 120));
    expect(seen()).toBe(n); // polling stopped
    expect(screen.getByRole("button", { name: "Run journey tests" })).toBeEnabled();
  });

  it("follows the run already in progress when the server answers 409", async () => {
    let polls = 0;
    stubFetch((url, init) => {
      if (url === "/api/scenarios") return json([]);
      if (url.startsWith("/api/simulations?")) return json([]);
      if (url === "/api/simulations" && init?.method === "POST")
        return json(
          { detail: "a simulation is already running (sim-old)", run_id: "sim-old" },
          409,
        );
      if (url === "/api/simulations/sim-old") {
        polls++;
        return polls < 2
          ? json({ run_id: "sim-old", status: "running", progress: "Planning journeys: 5 of 9" })
          : json({ run_id: "sim-old", status: "done", report: REPORT });
      }
      return json({}, 404);
    });
    const user = userEvent.setup();
    renderWithClient(<JourneyTests pollMs={20} />);
    await user.click(screen.getByRole("button", { name: "Run journey tests" }));
    expect(await screen.findByText(/already in progress; following it/)).toBeInTheDocument();
    expect(await screen.findByText(/finished/)).toBeInTheDocument();
  });

  it("ends the wait with a message and Retry when the status check keeps failing", async () => {
    stubFetch((url, init) => {
      if (url === "/api/scenarios") return json([]);
      if (url.startsWith("/api/simulations?")) return json([]);
      if (url === "/api/simulations" && init?.method === "POST")
        return json({ run_id: "sim-gone", status: "queued" }, 202);
      return json({ detail: "unknown" }, 404);
    });
    const user = userEvent.setup();
    renderWithClient(<JourneyTests pollMs={20} />);
    await user.click(screen.getByRole("button", { name: "Run journey tests" }));
    expect(await screen.findByText(/progress could not be checked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run journey tests" })).toBeEnabled();
  });

  it("sends all four profiles, default included", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/scenarios") return json([]);
      if (url.startsWith("/api/simulations?")) return json([]);
      if (url === "/api/simulations" && init?.method === "POST")
        return json({ run_id: "sim-x", status: "queued" }, 202);
      return json({ run_id: "sim-x", status: "running" });
    });
    const user = userEvent.setup();
    renderWithClient(<JourneyTests pollMs={20} />);
    await user.click(screen.getByRole("button", { name: "Run journey tests" }));
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse(String(((post as unknown[])[1] as RequestInit).body)).profiles).toEqual([
      "default",
      "stroller",
      "wheelchair",
      "older_adult_rest",
    ]);
  });

  it("shows a failed run as an error with Retry and stops polling", async () => {
    stubFetch((url, init) => {
      if (url === "/api/scenarios") return json([]);
      if (url.startsWith("/api/simulations?")) return json([]);
      if (url === "/api/simulations" && init?.method === "POST")
        return json({ run_id: "sim-bad", status: "queued" }, 202);
      return json({
        run_id: "sim-bad",
        status: "failed",
        error: "The simulation failed. Please try again.",
      });
    });
    const user = userEvent.setup();
    renderWithClient(<JourneyTests pollMs={20} />);
    await user.click(screen.getByRole("button", { name: "Run journey tests" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The simulation failed. Please try again.",
      ),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
