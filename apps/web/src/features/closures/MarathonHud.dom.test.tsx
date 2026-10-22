// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MARATHON } from "./fixtures";
import { MarathonEndCard, MarathonHud, MarathonMiniMap } from "./MarathonHud";
import { shotStart, TOTAL_S } from "./marathonCinematic";

describe("T-031 marathon HUD, mini-map and end card", () => {
  it("the HUD counts only the engine's numbers", () => {
    render(<MarathonHud m={MARATHON} t={shotStart("run") + 9} />);
    const hud = screen.getByTestId("marathon-hud");
    expect(hud).toHaveTextContent("The lead runner");
    expect(hud).toHaveTextContent("Lead runner 2.6 of 5.1 km");
    expect(hud).toHaveTextContent("Roads closed 2");
    expect(hud).toHaveTextContent("Sample trips rerouted 7 of 63");
  });

  it("the mini-map draws the course and a dot for whoever the camera follows", () => {
    render(<MarathonMiniMap m={MARATHON} t={shotStart("run")} />);
    expect(screen.getByTestId("marathon-minimap-dot")).toBeInTheDocument();
  });

  it("the end card: the course, the window, counts, suggestions, labels; replay and exit", () => {
    const replay = vi.fn();
    const exit = vi.fn();
    render(<MarathonEndCard m={MARATHON} onReplay={replay} onExit={exit} />);
    const card = screen.getByTestId("marathon-end-card");
    expect(card).toHaveTextContent("Proposed 5.1 km loop course · Closed 06:00–10:00");
    expect(card).toHaveTextContent("2 named roads closed; 7 of 63 sample trips change route");
    expect(card).toHaveTextContent(
      "Detour (median of rerouted trips): +82.5 m · +0.2 min at walking pace",
    );
    expect(card).toHaveTextContent("Review signposting the detour via Jalan Dillenia");
    expect(card).toHaveTextContent("not crowd sizes, vehicle counts or delays");
    expect(card).toHaveTextContent("not an approved route");
    expect(card.textContent).not.toMatch(/\bsafe\b/i);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit simulation" }));
    expect(replay).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(TOTAL_S).toBeGreaterThan(0);
  });
});
