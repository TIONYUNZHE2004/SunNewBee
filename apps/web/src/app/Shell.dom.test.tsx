// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanel } from "../features/main/panelStore";
import { json, renderWithClient, stubFetch } from "../test/helpers";
import { useMode } from "./modeStore";
import { Shell } from "./Shell";

const routes = [
  {
    element: <Shell />,
    children: [
      { path: "/", element: <p>main</p> },
      { path: "/tickets", element: <p>tickets</p> },
    ],
  },
];

function setup(path = "/") {
  stubFetch((url) => {
    if (url.includes("/verification-requests"))
      return json([
        { id: "v1", status: "open" },
        { id: "v2", status: "open" },
      ]);
    return json({ name: "City of Elmina", attribution: ["© OpenStreetMap contributors (ODbL)"] });
  });
  return renderWithClient(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />,
  );
}

describe("Shell", () => {
  it("bounds the root height on desktop so main can size its children", () => {
    setup();
    expect(screen.getByRole("main").parentElement).toHaveClass("lg:h-dvh");
  });
  beforeEach(() => useMode.setState({ mode: "resident" }));

  it("shows the mode switch on the main screen and no Tickets button for residents", async () => {
    setup();
    const group = await screen.findByRole("radiogroup", { name: "Perspective" });
    expect(within(group).getByRole("radio", { name: "Resident" })).toBeChecked();
    expect(screen.queryByRole("button", { name: /Tickets/ })).toBeNull();
  });
  it("management shows a Tickets link with the open count", async () => {
    setup();
    await userEvent.click(await screen.findByRole("radio", { name: "Management" }));
    expect(await screen.findByRole("link", { name: /Tickets.*2 open/ })).toBeVisible();
  });
  it("tickets screen has Back to map and no mode switch", async () => {
    setup("/tickets");
    expect(await screen.findByRole("link", { name: "Back to map" })).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Perspective" })).toBeNull();
  });
  it("attribution strip keeps the OpenStreetMap attribution", async () => {
    setup();
    expect(await screen.findByText(/OpenStreetMap contributors/)).toBeVisible();
  });
  it("has a skip link and a theme toggle with a name", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme|day|night/i })).toBeInTheDocument();
  });

  describe("attribution strip width", () => {
    const strip = () => screen.getByText(/OpenStreetMap contributors/);
    beforeEach(() => {
      vi.stubGlobal("matchMedia", () => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }));
      vi.stubGlobal("innerWidth", 1200);
      usePanel.setState({ open: true });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("excludes the open panel on the map route", async () => {
      setup("/");
      await screen.findByText(/OpenStreetMap contributors/);
      // panel = clamp(360, 360, 440) = 360, plus 2 x 16 inset
      expect(strip().style.maxWidth).toContain("392px");
    });
    it("uses the full width on /tickets", async () => {
      setup("/tickets");
      await screen.findByText(/OpenStreetMap contributors/);
      expect(strip().style.maxWidth).toContain("(0px");
    });
  });

  describe("attribution on phones", () => {
    afterEach(() => vi.unstubAllGlobals());
    const narrow = () =>
      vi.stubGlobal("matchMedia", () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }));
    const strip = () => screen.getByText(/OpenStreetMap contributors/);

    it("rides above the bottom sheet at every height", async () => {
      narrow();
      setup("/");
      await screen.findByText(/OpenStreetMap contributors/);
      for (const [sheet, h] of [
        ["peek", "10rem"],
        ["half", "55dvh"],
        ["full", "100%"],
      ] as const) {
        act(() => usePanel.setState({ sheet }));
        expect(strip().style.bottom).toContain(h);
        expect(strip().style.bottom).not.toBe("");
      }
    });
    it("stays at the bottom edge on /tickets", async () => {
      narrow();
      setup("/tickets");
      await screen.findByText(/OpenStreetMap contributors/);
      expect(strip().style.bottom).toBe("");
    });
  });
});
