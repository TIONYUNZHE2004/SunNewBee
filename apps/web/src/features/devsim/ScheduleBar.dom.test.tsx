// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { honestyViolations } from "../../test/honesty";
import { ESTIMATE_FOOTNOTE, formatDays, formatRmMillions } from "./copy";
import { ESTIMATE_STYLE, EstimateHud, estimateTooltip } from "./DevsimHud";
import estimates from "./fixtures/plan.elmina.json";
import type { EstimateSource, Schedule } from "./planTypes";
import { ScheduleBar } from "./ScheduleBar";
import { buildPlayback, daysLostByMonth, monthAt, scheduleAt } from "./schedulePlayback";

const schedule = estimates.schedule as unknown as Schedule;
const sources = estimates.estimate_sources as unknown as EstimateSource[];
const playback = buildPlayback(schedule);
const lost = daysLostByMonth(schedule);

/** The bar and HUD as the building overlay will compose them at screen second t. */
function Frame({ t, s = schedule }: { t: number; s?: Schedule }) {
  const m = monthAt(t, buildPlayback(s).keys);
  return (
    <div>
      <EstimateHud schedule={s} at={scheduleAt(s, m, daysLostByMonth(s))} sources={sources} />
      <ScheduleBar schedule={s} month={m} />
    </div>
  );
}

afterEach(cleanup);

describe("ScheduleBar (AC-W1)", () => {
  it("one tick per holidays entry; the tooltip is the name, plus expected when not gazetted", () => {
    render(<Frame t={12} />);
    const ticks = screen.getAllByTestId("devsim-holiday-tick");
    expect(ticks).toHaveLength(schedule.holidays.length);
    for (const [i, h] of schedule.holidays.entries()) {
      const tick = ticks[i] as HTMLElement;
      expect(tick.dataset.date).toBe(h.date);
      const title = tick.getAttribute("title") as string;
      expect(title.startsWith(h.name)).toBe(true);
      expect(title.includes("expected")).toBe(h.status !== "gazetted");
    }
    expect(schedule.holidays.some((h) => h.status === "expected")).toBe(true);
    expect(schedule.holidays.some((h) => h.status === "gazetted")).toBe(true);
  });

  it("emphasises exactly the one Hari Raya set-piece tick", () => {
    render(<Frame t={12} />);
    const big = screen
      .getAllByTestId("devsim-holiday-tick")
      .filter((el) => el.dataset.emphasis === "raya");
    expect(big).toHaveLength(1);
    expect(big[0]?.dataset.date).toBe(schedule.raya_set_piece?.date);
    expect(big[0]?.getAttribute("title")).toMatch(/^Hari Raya Aidilfitri/);
    expect(big[0]?.className).toMatch(/\bw-1\b/);
    // the other Raya days are plain ticks
    const others = screen
      .getAllByTestId("devsim-holiday-tick")
      .filter((el) => el.title.startsWith("Hari Raya Aidilfitri") && !el.dataset.emphasis);
    expect(others.length).toBeGreaterThan(0);
  });

  it("monsoon bands come from monsoon_bands", () => {
    render(<Frame t={12} />);
    const bands = screen.getAllByTestId("devsim-monsoon-band");
    expect(bands.map((b) => [Number(b.dataset.start), Number(b.dataset.end)])).toEqual(
      schedule.monsoon_bands.map((b) => [b.start_index, b.end_index]),
    );
    const n = schedule.months_total;
    const b1 = schedule.monsoon_bands[1];
    expect((bands[1] as HTMLElement).style.left).toBe(`${((b1?.start_index ?? 0) / n) * 100}%`);
  });

  it("legend: holiday, Raya, monsoon months, progress and the expected-dates note", () => {
    render(<Frame t={12} />);
    const legend = screen.getByTestId("devsim-schedule-legend");
    expect(legend).toHaveTextContent("Public holiday");
    expect(legend).toHaveTextContent("Hari Raya Aidilfitri · site closed");
    expect(legend).toHaveTextContent("Northeast monsoon (Nov–Mar)");
    expect(legend).toHaveTextContent("Progress");
    expect(legend).toHaveTextContent("Holidays not yet gazetted show expected dates");
  });

  it.each([8, 12, 21, 30])("the now-marker month equals the HUD month at t = %s s", (t) => {
    render(<Frame t={t} />);
    const now = screen.getByTestId("devsim-schedule-now");
    const hud = screen.getByTestId("devsim-estimate-hud");
    expect(now.dataset.monthIndex).toBe(hud.dataset.monthIndex);
    const m = monthAt(t, playback.keys);
    const want = (m / schedule.months_total) * 100;
    expect(Number.parseFloat(now.style.left.replace("calc(", ""))).toBeCloseTo(want, 3);
    const fill = screen.getByTestId("devsim-schedule-fill");
    expect(Number.parseFloat(fill.style.width)).toBeCloseTo(want, 3);
  });

  it("two holidays on one date are two ticks (key is date + name)", () => {
    const h0 = schedule.holidays[3] as Schedule["holidays"][number];
    const s: Schedule = {
      ...schedule,
      holidays: [...schedule.holidays, { ...h0, name: `${h0.name} (state)` }],
    };
    render(<ScheduleBar schedule={s} month={5} />);
    const same = screen
      .getAllByTestId("devsim-holiday-tick")
      .filter((el) => el.dataset.date === h0.date);
    expect(same).toHaveLength(2);
  });

  it("start and handover labels", () => {
    render(<Frame t={0} />);
    const bar = screen.getByTestId("devsim-schedule-bar");
    expect(bar).toHaveTextContent("Jan 2027 · start");
    expect(bar).toHaveTextContent("Mar 2029 · handover");
    expect(bar).toHaveTextContent("Jan 2028");
  });
});

describe("EstimateHud (AC-W2 unit level)", () => {
  it.each([8, 21, 30])("at t = %s s shows the plan's month, floors, cost and days lost", (t) => {
    render(<Frame t={t} />);
    const at = scheduleAt(schedule, monthAt(t, playback.keys), lost);
    const hud = screen.getByTestId("devsim-estimate-hud");
    const [y, mo] = at.ym.split("-");
    expect(within(hud).getByTestId("devsim-hud-month").textContent).toMatch(
      new RegExp(`^[A-Z][a-z]{2} ${y}$`),
    );
    expect(Number(mo)).toBeGreaterThan(0);
    expect(hud).toHaveTextContent(`Month ${at.monthIndex + 1} of ${schedule.months_total}`);
    expect(within(hud).getByTestId("devsim-hud-floors")).toHaveTextContent(
      `${schedule.floors_by_month[at.monthIndex]}/${schedule.storeys}`,
    );
    expect(within(hud).getByTestId("devsim-hud-cost")).toHaveTextContent(
      formatRmMillions(schedule.cost_by_month[at.monthIndex] as number),
    );
    expect(within(hud).getByTestId("devsim-hud-cost").textContent).toMatch(/^RM \d+ M$/);
    expect(within(hud).getByTestId("devsim-hud-lost")).toHaveTextContent(
      formatDays(lost[at.monthIndex] as number),
    );
    expect(within(hud).getByTestId("devsim-hud-lost").textContent).toMatch(/^\d+ d$/);
    expect(within(hud).getByTestId("devsim-hud-footnote")).toHaveTextContent(ESTIMATE_FOOTNOTE);
  });

  it("known values at the end: RM 133 M, 30/30 floors, 39 d", () => {
    render(<Frame t={30} />);
    expect(screen.getByTestId("devsim-hud-cost")).toHaveTextContent("RM 133 M");
    expect(screen.getByTestId("devsim-hud-floors")).toHaveTextContent("30/30");
    expect(screen.getByTestId("devsim-hud-lost")).toHaveTextContent("39 d");
    expect(screen.getByTestId("devsim-hud-month")).toHaveTextContent("Mar 2029");
  });

  it("the ESTIMATE badge carries the source line and the source rows (AC-W9)", () => {
    render(<Frame t={8} />);
    const badge = screen.getByTestId("devsim-estimate-badge");
    expect(badge.firstChild?.textContent).toBe("ESTIMATE");
    const tip = badge.getAttribute("title") as string;
    expect(tip).toBe(estimateTooltip(schedule, sources));
    expect(tip.split("\n")[0]).toBe(schedule.source_line);
    expect(tip).toContain("Arcadis");
    expect(tip).toContain("(assumption)");
    expect(tip.split("\n")).toHaveLength(1 + schedule.source_ids.length);
  });

  it("the badge colours reach 4.5:1", () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (l[0] as number) + 0.7152 * (l[1] as number) + 0.0722 * (l[2] as number);
    };
    const r = (lum(ESTIMATE_STYLE.bg) + 0.05) / (lum(ESTIMATE_STYLE.fg) + 0.05);
    expect(r).toBeGreaterThanOrEqual(4.5);
  });
});

describe("honesty (AC-W9)", () => {
  it("no banned wording in the bar, HUD or tooltips", () => {
    const { container } = render(<Frame t={21} />);
    const titles = [...container.querySelectorAll("[title]")].map((e) => e.getAttribute("title"));
    const text = [container.textContent, ...titles].join("\n");
    expect(honestyViolations(text)).toEqual([]);
  });
});
