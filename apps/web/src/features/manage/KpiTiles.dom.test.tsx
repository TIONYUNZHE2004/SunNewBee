// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { KpiTiles } from "./KpiTiles";

const KPIS = { open_vrs: 4, median_hours_to_resolve: 5.25, journeys_confirmed_pct: 62.5 };

afterEach(() => vi.unstubAllGlobals());

describe("KpiTiles", () => {
  it("shows 'Data-gap share unavailable' when /simulations errors, keeping the other tiles", async () => {
    const fetchMock = stubFetch((url) =>
      url === "/api/kpis" ? json(KPIS) : json({ detail: "boom" }, 500),
    );
    renderWithClient(<KpiTiles />);
    expect(await screen.findByText("Data-gap share unavailable")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("63%")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("/api/simulations?limit=1");
  });

  it("does not claim the data gap is unavailable when /simulations succeeds with no runs", async () => {
    stubFetch((url) => (url === "/api/kpis" ? json(KPIS) : json([])));
    renderWithClient(<KpiTiles />);
    expect(await screen.findByText("63%")).toBeInTheDocument();
    expect(screen.queryByText("Data-gap share unavailable")).not.toBeInTheDocument();
  });

  it("shows 'Key figures unavailable.' when /kpis errors", async () => {
    stubFetch(() => json({}, 500));
    renderWithClient(<KpiTiles />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Key figures unavailable.");
  });
});
