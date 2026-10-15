// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../test/helpers";
import { routes } from "./routes";

describe("routes", () => {
  it("an unknown address shows a not-found page with a link back to the map", async () => {
    stubFetch(() => json([]));
    renderWithClient(
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/nope"] })} />,
    );
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to the map" })).toHaveAttribute("href", "/");
  });
});
