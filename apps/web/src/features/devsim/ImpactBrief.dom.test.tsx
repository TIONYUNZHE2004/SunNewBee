// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { badgeTooltips, hoardingRows } from "./buildModel";
import { matrixCellText } from "./copy";
import elmina from "./fixtures/plan.elmina.json";
import { ImpactBrief } from "./ImpactBrief";
import type { DevelopmentPlan } from "./types";

const plan = elmina as unknown as DevelopmentPlan;
/** Banned in any brief copy (AGENTS.md honesty table, spec §3). */
const BANNED = /\bsafe\b|selamat|安全|\bdepth\b|\d+(\.\d+)? ?cm\b|not reachable|\bverified\b/i;

afterEach(cleanup);

const sections = () => screen.getAllByTestId("devsim-brief-section");
const section = (key: string) => sections().find((s) => s.dataset.section === key) as HTMLElement;

describe("ImpactBrief (AC-W6, AC-W9)", () => {
  it("sections During construction / At handover / Daily life, in order, titled from the plan", () => {
    render(<ImpactBrief plan={plan} />);
    const brief = screen.getByTestId("devsim-impact-brief");
    expect(brief).toHaveAttribute("data-beat", "impact-brief");
    expect(within(brief).getByRole("heading", { level: 2 })).toHaveTextContent(plan.brief.title);
    expect(brief).toHaveTextContent(plan.brief.subtitle);
    expect(sections().map((s) => s.dataset.section)).toEqual([
      "construction",
      "handover",
      "daily_life",
    ]);
    const titles = sections().map((s) => within(s).getByRole("heading").textContent);
    expect(titles[0]).toBe("During construction");
    expect(titles[1]).toBe("At handover");
    expect(titles[2]).toMatch(/^Daily life/);
    expect(titles).toEqual(plan.brief.sections.map((s) => s.title));
  });

  it("every row is the plan's label, badges and value, verbatim", () => {
    render(<ImpactBrief plan={plan} />);
    const rows = screen.getAllByTestId("devsim-brief-row");
    const all = plan.brief.sections.flatMap((s) => s.rows);
    expect(rows).toHaveLength(all.length);
    rows.forEach((el, i) => {
      const r = all[i] as (typeof all)[0];
      expect(el.dataset.key).toBe(r.key);
      expect(el).toHaveTextContent(r.label);
      expect(el).toHaveTextContent(r.value);
      expect(
        [...el.querySelectorAll("[data-badge]")].map((b) => (b as HTMLElement).dataset.badge),
      ).toEqual(r.badges);
    });
  });

  it("badges ROUTE, FLOOD, ESTIMATE and CALENDAR all appear, each with its source tooltip", () => {
    render(<ImpactBrief plan={plan} />);
    const tips = badgeTooltips(plan);
    const badges = [...document.querySelectorAll<HTMLElement>("[data-badge]")];
    const kinds = new Set(badges.map((b) => b.dataset.badge));
    for (const k of ["ROUTE", "FLOOD", "ESTIMATE", "CALENDAR"]) expect(kinds.has(k), k).toBe(true);
    for (const b of badges) {
      const k = b.dataset.badge as keyof typeof tips;
      expect(b.title, k).toBe(tips[k]);
      expect(b.title.length).toBeGreaterThan(10);
    }
    // ESTIMATE names the schedule's source line and marks assumptions
    expect(tips.ESTIMATE.startsWith(plan.schedule.source_line)).toBe(true);
    expect(tips.ESTIMATE).toContain("(assumption)");
    // CALENDAR counts the holidays and says which dates are expected
    expect(tips.CALENDAR).toContain(String(plan.schedule.holidays.length));
    if (plan.schedule.holidays.some((h) => h.status !== "gazetted"))
      expect(tips.CALENDAR).toMatch(/expected/);
    expect(tips.ROUTE).toContain(plan.impact.provenance);
    expect(tips.FLOOD).toContain("Indicative scenario, not a forecast.");
  });

  it('the flood line says "Indicative scenario, not a forecast." and keeps the evacuation label honest', () => {
    render(<ImpactBrief plan={plan} />);
    const h = section("handover");
    expect(h).toHaveTextContent("Indicative scenario, not a forecast.");
    expect(h.querySelector('[data-badge="FLOOD"]')).not.toBeNull();
    const ev = plan.flood.evacuation;
    if (ev?.source === "osm_candidate") expect(h.textContent ?? "").not.toMatch(/\bofficial PPS\b/);
  });

  it("the disclaimer is added if a plan's handover notes lack it", () => {
    const bare: DevelopmentPlan = {
      ...plan,
      brief: {
        ...plan.brief,
        sections: plan.brief.sections.map((s) => (s.key === "handover" ? { ...s, notes: [] } : s)),
      },
    };
    render(<ImpactBrief plan={bare} />);
    expect(section("handover")).toHaveTextContent(plan.flood.disclaimer);
  });

  it("daily life: the plan's matrix, targets by profile; ? reads Not checked yet", () => {
    render(<ImpactBrief plan={plan} />);
    const table = screen.getByTestId("devsim-brief-matrix");
    const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads.slice(1)).toEqual(["Walk", "Stroller", "Wheelchair"]);
    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(plan.access_matrix.rows.length);
    rows.forEach((tr, i) => {
      const r = plan.access_matrix.rows[i] as (typeof plan.access_matrix.rows)[0];
      expect(tr.querySelector("th")).toHaveTextContent(r.target.name);
      const cells = [...tr.querySelectorAll("td")];
      expect(cells.map((c) => c.dataset.value)).toEqual(r.cells.map((c) => String(c.value)));
    });
    const q = table.querySelector('td[data-value="?"]');
    if (q) expect(q).toHaveAttribute("title", "Not checked yet");
    expect(matrixCellText("gap").title).toBe("No mapped connection (data gap)");
    expect(matrixCellText("?").title).not.toMatch(/blocked|unsafe|not passable/i);
    expect(section("daily_life")).toHaveTextContent(
      plan.brief.sections[2]?.notes[0] ?? "did not count",
    );
  });

  it("no banned words in the brief's text or tooltips", () => {
    render(<ImpactBrief plan={plan} />);
    const brief = screen.getByTestId("devsim-impact-brief");
    expect(brief.textContent ?? "").not.toMatch(BANNED);
    for (const el of brief.querySelectorAll<HTMLElement>("[title]"))
      expect(el.title).not.toMatch(BANNED);
  });

  it("the hoarding card rows are the brief's own rows", () => {
    expect(hoardingRows(plan).map((r) => r.key)).toEqual([
      "homes_2min_plus",
      "wheelchair_links_cut",
      "best_side",
    ]);
  });
});
