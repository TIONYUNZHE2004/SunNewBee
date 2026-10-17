// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeMenu } from "./ThemeMenu";
import { useTheme } from "./theme";

describe("ThemeMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    useTheme.getState().setChoice("auto");
  });

  it("names the current choice and opens a menu of four options", () => {
    render(<ThemeMenu />);
    const btn = screen.getByRole("button", { name: /^Theme: Auto/ });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Auto", "Day", "Dusk", "Night"]);
    expect(screen.getByRole("menuitemradio", { name: "Auto" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("picking Dusk sets the choice and closes the menu", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dusk" }));
    expect(useTheme.getState().choice).toBe("dusk");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: Dusk" })).toBeInTheDocument();
  });

  it("Escape closes and returns focus to the button", () => {
    render(<ThemeMenu />);
    const btn = screen.getByRole("button", { name: /^Theme:/ });
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("clicking the icon inside the open button closes the menu (no reopen)", () => {
    render(<ThemeMenu />);
    const btn = screen.getByRole("button", { name: /^Theme:/ });
    fireEvent.click(btn);
    const icon = btn.querySelector("span") as HTMLElement;
    fireEvent.mouseDown(icon);
    fireEvent.click(icon);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("a mousedown outside closes the menu", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
