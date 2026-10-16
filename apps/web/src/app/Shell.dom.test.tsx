// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
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
});
