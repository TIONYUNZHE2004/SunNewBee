// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { DemoBar } from "./DemoBar";

const root = document.documentElement;
beforeEach(() => {
  useScene.getState().reset();
  stubFetch(() => json({}));
  root.style.removeProperty("--demo-bar-h");
});

describe("DemoBar", () => {
  it("exposes --demo-bar-h while active and removes it on unmount", () => {
    const { unmount } = renderWithClient(
      <MemoryRouter initialEntries={["/?demo=hero"]}>
        <DemoBar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("region", { name: "Demo walkthrough" })).toBeInTheDocument();
    expect(root.style.getPropertyValue("--demo-bar-h")).toBe("9rem");
    unmount();
    expect(root.style.getPropertyValue("--demo-bar-h")).toBe("");
  });

  it("sets nothing when the demo is not active", () => {
    renderWithClient(
      <MemoryRouter>
        <DemoBar />
      </MemoryRouter>,
    );
    expect(root.style.getPropertyValue("--demo-bar-h")).toBe("");
  });
});
