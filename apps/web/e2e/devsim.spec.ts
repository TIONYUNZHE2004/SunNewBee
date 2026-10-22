/**
 * Building impact: the 45 s Development Simulation in the List view (demo polish spec 2026-10-21
 * §6.2, §6.3, §7; AC-W2, W6, W7, W8, W9; developer lens AC-F4, AC-H6).
 * Tiny fixture + mock LLM: the mock's brief branch emits `development.play` without a plan (the
 * tiny world has no parcel), so the web fetches POST /api/developments/simulate, stubbed here with
 * `fixtures/devsim-plan.json` (the Elmina build). Expected values are read from that fixture, so
 * the spec holds whichever plan it contains. The playback is driven through `window.__tl.demo`
 * ("bld") and `window.__devsim`.
 */

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { DEVSIM_BRIEF } from "../src/features/assistant/starters";
import type { DevelopmentPlan } from "../src/features/devsim/types";

const plan = JSON.parse(
  readFileSync(new URL("./fixtures/devsim-plan.json", import.meta.url), "utf8"),
) as DevelopmentPlan;

const NOT_AVAILABLE = "Development simulation is not available for this map.";
const HYPOTHETICAL = "Hypothetical tower · not an SDP project";

async function open(page: Page) {
  await page.goto("/");
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeVisible();
  await page.getByRole("radio", { name: "Management" }).click();
}

const stubPlan = (page: Page) =>
  page.route("**/api/developments/simulate", (r) => r.fulfill({ json: plan }));

/** The newest assistant answer once its stream has finished. */
async function lastAnswer(page: Page) {
  const last = page.getByRole("log").getByRole("article").last();
  await expect(last).toHaveAttribute("data-done", "true");
  return last;
}

type Bld = {
  set: (k: string) => void;
  seek: (x: number) => void;
  play: () => void;
  pause: () => void;
  state: () => Record<string, unknown>;
};

/** Pauses and seeks the building playback through `window.__tl.demo` ("bld"). */
async function seek(page: Page, t: number) {
  await page.evaluate((s) => {
    const d = (window as unknown as { __tl: { demo: Bld } }).__tl.demo;
    d.set("bld");
    d.pause();
    d.seek(s);
  }, t);
}

const bldState = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __tl: { demo: Bld } }).__tl.demo;
    d.set("bld");
    return d.state() as {
      registered: boolean;
      t: number;
      playing: boolean;
      total: number;
      beats: string[];
      bubbles: number[];
      hud: { monthIndex: number; floors: number; costRm: number; daysLost: number } | null;
    };
  });

/** Starts the simulation from the starter and waits until the List view shows it. */
async function startFromStarter(page: Page) {
  await stubPlan(page);
  await open(page);
  await page.getByRole("button", { name: DEVSIM_BRIEF }).click();
  await expect(await lastAnswer(page)).toContainText("illustrative");
  const list = page.getByTestId("devsim-list");
  await expect(list).toBeVisible();
  return list;
}

test("starter: the reply is illustrative, the 45 s playback starts, the Impact Brief shows from 33 s", async ({
  page,
}) => {
  const list = await startFromStarter(page);
  await expect(list.getByText(plan.labels.simulation)).toBeVisible();
  await expect(page.getByTestId("devsim-hypothetical")).toHaveAccessibleName(
    plan.labels.hypothetical,
  );
  // playing: the clock moves on its own, and the hook drives the building playback
  const t0 = (await bldState(page)).t;
  await expect.poll(async () => (await bldState(page)).t).toBeGreaterThan(t0);
  const st = await bldState(page);
  expect(st.registered).toBe(true);
  expect(st.total).toBe(45);
  await seek(page, 32.5);
  await expect(page.getByTestId("devsim-impact-brief")).toHaveCount(0);
  await seek(page, 34);
  const brief = page.getByTestId("devsim-impact-brief");
  await expect(brief).toBeVisible();
  await expect(brief.getByRole("heading", { name: plan.brief.title })).toBeVisible();
  // every bubble is listed as a quote with its speaker; no end card any more
  await expect(page.getByTestId("devsim-quote")).toHaveCount(plan.bubbles.length);
  await expect(page.getByTestId("devsim-end-card")).toHaveCount(0);
});

test("HUD at 8, 21 and 30 s equals the plan's schedule row for that month (AC-W2)", async ({
  page,
}) => {
  await startFromStarter(page);
  const sch = plan.schedule;
  for (const t of [8, 21, 30]) {
    await seek(page, t);
    const hud = (await bldState(page)).hud;
    expect(hud, `t=${t}`).not.toBeNull();
    const i = hud?.monthIndex as number;
    expect(hud?.floors).toBe(sch.floors_by_month[i]);
    expect(hud?.costRm).toBe(sch.cost_by_month[i]);
    expect(hud?.daysLost).toBe(sch.days_lost_by_month[i]);
    const el = page.getByTestId("devsim-estimate-hud");
    await expect(el.getByTestId("devsim-hud-floors")).toHaveText(
      `${sch.floors_by_month[i]}/${sch.storeys}`,
    );
    await expect(el.getByTestId("devsim-hud-cost")).toHaveText(
      `RM ${Math.round((sch.cost_by_month[i] as number) / 1_000_000)} M`,
    );
    await expect(el.getByTestId("devsim-hud-lost")).toHaveText(
      `${Math.round(sch.days_lost_by_month[i] as number)} d`,
    );
    await expect(el).toContainText("Estimate from published benchmarks");
  }
});

test("bubbles, banners and tags follow the plan's windows (AC-W8); the label stays throughout (AC-W9)", async ({
  page,
}) => {
  await startFromStarter(page);
  for (const b of plan.bubbles) {
    await seek(page, b.t0 + 0.05);
    expect((await bldState(page)).bubbles, `bubble ${b.n} on`).toContain(b.n);
    // bubbles may overlap (4 and 5): the one with this text is speaking
    await expect(
      page
        .locator('[data-testid="devsim-quote"][data-speaking="true"]')
        .filter({ hasText: b.text }),
    ).toHaveCount(1);
    await seek(page, b.t1 + 0.05);
    expect((await bldState(page)).bubbles, `bubble ${b.n} off`).not.toContain(b.n);
  }
  for (const bn of plan.banners) {
    await seek(page, (bn.t0 + bn.t1) / 2);
    const el = page.locator(`[data-testid="devsim-banner"][data-kind="${bn.kind}"]`);
    await expect(el).toContainText(bn.title);
    await expect(el).toContainText(bn.text);
    expect((await bldState(page)).beats).toContain(`banner-${bn.kind}`);
  }
  const lorry = plan.tags.find((g) => g.kind === "lorry");
  if (lorry) {
    await seek(page, lorry.t0 + 0.5);
    await expect(page.locator('[data-testid="devsim-tag"][data-kind="lorry"]')).toContainText(
      lorry.text,
    );
  }
  for (const t of [0.5, 6, 12, 21, 28, 34, 44.9]) {
    await seek(page, t);
    await expect(page.getByTestId("devsim-hypothetical"), `t=${t}`).toBeVisible();
    await expect(page.getByTestId("devsim-hypothetical")).toHaveAccessibleName(
      new RegExp(`^${HYPOTHETICAL}`),
    );
  }
});

test("Impact Brief: sections and badges from the plan; flood line indicative (AC-W6)", async ({
  page,
}) => {
  await startFromStarter(page);
  await seek(page, 36);
  const brief = page.getByTestId("devsim-impact-brief");
  const sections = brief.getByTestId("devsim-brief-section");
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toContainText("During construction");
  await expect(sections.nth(1)).toContainText("At handover");
  await expect(sections.nth(2)).toContainText("Daily life");
  for (const k of ["ROUTE", "FLOOD", "ESTIMATE", "CALENDAR"])
    await expect(brief.locator(`[data-badge="${k}"]`).first()).toHaveAttribute("title", /\S/);
  await expect(sections.nth(1)).toContainText("Indicative scenario, not a forecast.");
  for (const s of plan.brief.sections)
    for (const r of s.rows) await expect(brief).toContainText(r.value);
  await expect(brief).not.toContainText(/\bsafe\b|selamat/i);
});

test("simulated residents: the button from 33 s; scripted taps open the panel at 39 s and Mei Ling at 41 s (AC-W7)", async ({
  page,
}) => {
  await startFromStarter(page);
  await seek(page, 32.5);
  await expect(page.getByRole("button", { name: /Simulated residents · 40/ })).toHaveCount(0);
  await seek(page, 38.4);
  await expect(page.getByRole("button", { name: /Simulated residents · 40/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // while playing, seek just past each scripted tap (deterministic: no waiting on real time)
  const playAndSeek = (s: number) =>
    page.evaluate((x) => {
      const d = (window as unknown as { __tl: { demo: Bld } }).__tl.demo;
      d.set("bld");
      d.play();
      d.seek(x);
    }, s);
  await playAndSeek(39.05);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(40);
  await expect(page.getByRole("button", { name: /All 40 residents/ })).toHaveCount(0);
  await playAndSeek(41.05);
  await expect(page.getByRole("button", { name: /All 40 residents/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Mei Ling");
  await expect(page.getByRole("dialog")).toContainText("Simulated reactions");
  // Escape closes it and focus returns to the button
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Simulated residents · 40/ })).toBeFocused();
});

test("paperclip: attach a file and send, the fixed brief plays (AC-F4)", async ({ page }) => {
  await stubPlan(page);
  await open(page);
  await page.getByTestId("attach-brief-input").setInputFiles({
    name: "Elmina_Tower_Brief.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 demo"),
  });
  await expect(page.getByTestId("brief-chip")).toContainText("Elmina_Tower_Brief.pdf");
  const chat = page.waitForRequest((r) => r.url().includes("/api/chat"));
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  expect((await chat).postDataJSON().message).toBe(DEVSIM_BRIEF);
  await expect(page.getByRole("log").getByTestId("brief-chip")).toContainText(
    "Elmina_Tower_Brief.pdf",
  );
  await lastAnswer(page);
  await expect(page.getByTestId("devsim-controls")).toBeVisible();
  await expect.poll(async () => (await bldState(page)).playing).toBe(true);
});

test("no parcel in this world: the List view says the simulation is not available (AC-H6)", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: DEVSIM_BRIEF }).click();
  await lastAnswer(page);
  await expect(page.getByTestId("devsim-list").getByRole("alert")).toHaveText(NOT_AVAILABLE);
});

test("a development.play intent without a plan fetches it and plays to the Impact Brief", async ({
  page,
}) => {
  // The chat is stubbed here so this checks the web's own intent path (plan: null -> fetch),
  // independent of the mock's wording.
  await stubPlan(page);
  await page.route("**/api/chat", (r) =>
    r.fulfill({
      headers: { "Content-Type": "text/event-stream" },
      body: [
        { type: "text.delta", delta: "Playing an illustrative development simulation." },
        {
          type: "scene.intent",
          intent: { kind: "development.play", plan: null, brief_text: DEVSIM_BRIEF },
        },
        { type: "done", message_id: "m", answer_status: "answered", model: "stub" },
      ]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join(""),
    }),
  );
  await open(page);
  await page.getByRole("button", { name: DEVSIM_BRIEF }).click();
  await expect(page.getByTestId("devsim-controls")).toBeVisible();
  const first = plan.bubbles.find((b) => b.n === 1);
  if (first) {
    await seek(page, first.t0 + 0.5);
    await expect(page.getByTestId("devsim-quote").first()).toHaveAttribute("data-speaking", "true");
    await expect(page.getByTestId("devsim-quote").first()).toContainText(first.text);
  }
  await seek(page, 45);
  await expect(page.getByTestId("devsim-impact-brief")).toBeVisible();
  // seeking back hides the brief again (AC-F6)
  await seek(page, 20);
  await expect(page.getByTestId("devsim-impact-brief")).toHaveCount(0);
});
