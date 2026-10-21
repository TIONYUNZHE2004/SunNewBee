// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { honestyViolations } from "../../../test/honesty";
import estimates from "../fixtures/estimates.preC7.elmina.json";
import type { SimResidents } from "../planTypes";
import { inkOn } from "./Avatar";
import { extraWalkText, walkValueText } from "./ResidentDetail";
import { ResidentsLayer } from "./ResidentsLayer";
import { RES_BUTTON_AT, RES_DETAIL_AT, RES_PANEL_AT, scriptStep } from "./residentsScript";

const data = estimates.residents as unknown as SimResidents;
const meiling = data.residents.find((r) => r.id === "meiling");

afterEach(cleanup);

/** Renders the layer and returns a function that moves the playhead. */
function setup(t0 = 0, playing = true) {
  const view = render(<ResidentsLayer data={data} t={t0} playing={playing} />);
  const to = (t: number, p = playing) =>
    act(() => view.rerender(<ResidentsLayer data={data} t={t} playing={p} />));
  return { ...view, to };
}
/** Plays from `a` to `b` in 0.25 s steps, as the driver does. */
function play(to: (t: number) => void, a: number, b: number) {
  for (let t = a; t <= b + 1e-9; t += 0.25) to(Math.round(t * 100) / 100);
}

describe("residents fixture (pre-C7 dump)", () => {
  it("has 40 residents, 20 tower then 20 neighbours, with Mei Ling", () => {
    expect(data.residents).toHaveLength(40);
    expect(data.residents.filter((r) => r.side === "tower")).toHaveLength(20);
    expect(meiling?.side).toBe("tower");
  });
});

describe("scriptStep", () => {
  it("opens at 39 s and Mei Ling at 41 s only while playing and untouched", () => {
    expect(scriptStep(38.9, 39, true, false)).toEqual([{ kind: "open-panel" }]);
    expect(scriptStep(40.9, 41, true, false)).toEqual([{ kind: "open-detail", id: "meiling" }]);
    expect(scriptStep(38.9, 41.1, true, false)).toHaveLength(2);
    expect(scriptStep(38.9, 39, false, false)).toEqual([]);
    expect(scriptStep(38.9, 39, true, true)).toEqual([]);
    expect(scriptStep(39.5, 38, false, false)).toEqual([{ kind: "close" }]);
    expect(scriptStep(34, 10, false, true)).toEqual([{ kind: "close" }, { kind: "reset" }]);
  });
});

describe("ResidentsLayer (AC-W7)", () => {
  it("the button appears from 33 s, labelled and pulsing", () => {
    const { to } = setup(32.9);
    expect(screen.queryByTestId("devsim-residents-button")).toBeNull();
    to(RES_BUTTON_AT);
    const btn = screen.getByRole("button", { name: "Simulated residents · 40" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    expect(btn.className).toContain("animate-[tl-pulse");
  });

  it("scripted taps: the panel opens at 39 s and Mei Ling's detail at 41 s while playing", () => {
    const { to } = setup(33);
    play(to, 33, 38.75);
    expect(screen.queryByRole("dialog")).toBeNull();
    to(RES_PANEL_AT);
    const dialog = screen.getByRole("dialog", { name: "Simulated residents · 40" });
    expect(within(dialog).getAllByTestId("devsim-resident-item")).toHaveLength(40);
    // a scripted open never steals focus
    expect(dialog.contains(document.activeElement)).toBe(false);
    play(to, 39.25, 40.75);
    expect(screen.queryByTestId("devsim-resident-detail")).toBeNull();
    to(RES_DETAIL_AT);
    const detail = screen.getByTestId("devsim-resident-detail");
    expect(detail).toHaveAttribute("data-resident", "meiling");
    expect(within(detail).getByRole("heading", { name: "Mei Ling" })).toBeInTheDocument();
  });

  it("no scripted tap while paused (a seek past 39/41 s)", () => {
    const { to } = setup(33, false);
    to(42, false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("skips the scripted taps once the user has opened (and closed) it", () => {
    const { to } = setup(34);
    fireEvent.click(screen.getByTestId("devsim-residents-button"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    play(to, 34, 42);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a user open while scripted stays where the user is (41 s does not jump to Mei Ling)", () => {
    const { to } = setup(36);
    fireEvent.click(screen.getByTestId("devsim-residents-button"));
    const other = data.residents[5];
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^.?${other?.name}`) }));
    play(to, 36, 42);
    expect(screen.getByTestId("devsim-resident-detail")).toHaveAttribute(
      "data-resident",
      other?.id,
    );
  });

  it("detail shows the facts block, three phase lines, Simulated reactions and the footnote", () => {
    const { to } = setup(40.75);
    to(41);
    const d = screen.getByTestId("devsim-resident-detail");
    const facts = within(d).getByTestId("devsim-resident-facts");
    expect(facts).toHaveTextContent("From the world model");
    for (const w of meiling?.facts.walks ?? [])
      expect(facts).toHaveTextContent(`${w.label}: ${walkValueText(w.value)}`);
    const phases = within(d).getAllByTestId("devsim-resident-phase");
    expect(phases.map((p) => p.dataset.phase)).toEqual(["construction", "handover", "daily_life"]);
    expect(phases[0]).toHaveTextContent(`During construction${meiling?.lines.construction}`);
    expect(phases[1]).toHaveTextContent(`Handover${meiling?.lines.handover}`);
    expect(phases[2]).toHaveTextContent(`Daily life${meiling?.lines.daily_life}`);
    expect(within(d).getByTestId("devsim-resident-label")).toHaveTextContent("Simulated reactions");
    expect(within(d).getByTestId("devsim-resident-note")).toHaveTextContent(
      "Lines are written for the simulation; every number comes from the world model.",
    );
  });

  it("keyboard: Tab + Enter open, items are buttons, Back returns, Escape closes, focus returns", async () => {
    const user = userEvent.setup();
    setup(35);
    const btn = screen.getByTestId("devsim-residents-button");
    await user.tab();
    expect(document.activeElement).toBe(btn);
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Simulated residents · 40" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveAttribute("aria-controls", dialog.id);
    // focus moves into the dialog, to its heading
    expect(document.activeElement).toBe(
      within(dialog).getByRole("heading", { name: "Simulated residents · 40" }),
    );
    const items = within(dialog).getAllByTestId("devsim-resident-item");
    expect(items).toHaveLength(40);
    for (const it of items) expect(it.tagName).toBe("BUTTON");
    // Tab: Close, then the first resident
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    await user.tab();
    expect(document.activeElement).toBe(items[0]);
    // open a neighbour with Enter: focus goes to Back
    const n = data.residents.find((r) => r.side === "neighbour");
    (items.find((el) => el.dataset.resident === n?.id) as HTMLElement).focus();
    await user.keyboard("{Enter}");
    const back = screen.getByRole("button", { name: /All 40 residents/ });
    expect(document.activeElement).toBe(back);
    expect(screen.getByTestId("devsim-resident-detail")).toHaveTextContent(
      extraWalkText(n as never) as string,
    );
    // Back (Enter) returns to the list, focus on the item that was opened
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("devsim-resident-detail")).toBeNull();
    expect(screen.getAllByTestId("devsim-resident-item")).toHaveLength(40);
    expect((document.activeElement as HTMLElement).dataset.resident).toBe(n?.id);
    // Escape closes, focus returns to the button
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape closes a scripted-open panel when focus is outside it; focus returns to the button", async () => {
    const user = userEvent.setup();
    const { to } = setup(40.75);
    to(41);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(false);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("devsim-residents-button"));
    // a user close counts as a touch: no re-open on the next scripted beat
    play(to, 41, 42);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close works from the detail and returns focus to the button", () => {
    const { to } = setup(40.75);
    to(41);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("devsim-residents-button"));
  });

  it("seeking back before 33 s hides everything and a replay runs the script again", () => {
    const { to } = setup(40.75);
    to(41);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    to(5, false);
    expect(screen.queryByTestId("devsim-residents")).toBeNull();
    to(38.9);
    to(39);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("honesty and contrast", () => {
  it("no banned wording in the list, any resident's detail or the copy", () => {
    const { to } = setup(35);
    to(35);
    fireEvent.click(screen.getByTestId("devsim-residents-button"));
    const texts = [screen.getByRole("dialog").textContent ?? ""];
    // A text match over the dialog's buttons (none has an aria-label, so the text is the name):
    // getByRole computes every accessible name, and 80 such lookups timed out once under load.
    const button = (re: RegExp) => {
      const b = [...screen.getByRole("dialog").querySelectorAll("button")].find((x) =>
        re.test(x.textContent ?? ""),
      );
      if (!b) throw new Error(`no button ${re}`);
      return b;
    };
    for (const r of data.residents) {
      fireEvent.click(button(new RegExp(`^.?${r.name}(New tower|Neighbour)`)));
      texts.push(screen.getByTestId("devsim-resident-detail").textContent ?? "");
      fireEvent.click(button(/All 40 residents/));
    }
    expect(texts).toHaveLength(data.residents.length + 1);
    expect(honestyViolations(texts.join("\n"))).toEqual([]);
    expect(texts.join("\n")).not.toMatch(/\bblocked\b|not reachable/i);
  }, 20_000);

  it("avatar initials pick the more readable ink", () => {
    expect(inkOn("#ffffff")).toBe("#1c1b19");
    expect(inkOn("#1c1b19")).toBe("#ffffff");
    expect(inkOn("#4dcba6")).toBe("#1c1b19");
  });
});
