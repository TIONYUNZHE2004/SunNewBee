// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { DemoBar } from "../demo/DemoBar";
import { useScene } from "../scene/sceneStore";
import { PlaceCard } from "./PlaceCard";

beforeEach(() => {
  useScene.getState().reset();
  stubFetch(() => json({}));
  document.documentElement.style.removeProperty("--demo-bar-h");
});

describe("PlaceCard during the demo", () => {
  it("Escape closes the card but does not exit the demo", async () => {
    const user = userEvent.setup();
    useScene.getState().selectPlace("p1");
    renderWithClient(
      <MemoryRouter initialEntries={["/?demo=hero"]}>
        <PlaceCard />
        <DemoBar />
      </MemoryRouter>,
    );
    screen.getByRole("dialog").focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useScene.getState().selectedPlaceId).toBeNull();
    expect(screen.getByRole("region", { name: "Demo walkthrough" })).toBeInTheDocument();
  });

  it("offsets its bottom by the demo bar height", () => {
    useScene.getState().selectPlace("p1");
    renderWithClient(
      <MemoryRouter>
        <PlaceCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog").className).toContain("bottom-[var(--demo-bar-h,0px)]");
    expect(screen.getByRole("dialog").className).toContain(
      "lg:bottom-[calc(var(--demo-bar-h,0px)+1rem)]",
    );
  });
});
