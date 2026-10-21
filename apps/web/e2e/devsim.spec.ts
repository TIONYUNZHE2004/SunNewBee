/**
 * Developer lens: Development Simulation in the List view (spec 2026-10-21 §5.3, §6; AC-F4, AC-H6).
 * Tiny fixture + mock LLM: the mock's brief branch emits `development.play` without a plan (the
 * tiny world has no parcel), so the web fetches POST /api/developments/simulate, stubbed here with
 * `fixtures/devsim-plan.json` (the Elmina build). Expected values are read from that fixture, so
 * the spec holds whichever plan it contains.
 */

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { DEVSIM_BRIEF } from "../src/features/assistant/starters";
import type { DevelopmentPlan } from "../src/features/devsim/types";

const plan = JSON.parse(
  readFileSync(new URL("./fixtures/devsim-plan.json", import.meta.url), "utf8"),
) as DevelopmentPlan;

const NOT_AVAILABLE = "Development simulation is not available for this map.";

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

async function seek(page: Page, t: number) {
  await page.evaluate((s) => {
    const h = (window as unknown as { __devsim: { pause: () => void; seek: (x: number) => void } })
      .__devsim;
    h.pause();
    h.seek(s);
  }, t);
}

async function expectEndCard(page: Page) {
  const card = page.getByTestId("devsim-end-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: plan.end_card.title })).toBeVisible();
  await expect(card).toContainText(plan.end_card.subtitle);
  await expect(card.getByTestId("devsim-end-item")).toHaveCount(plan.end_card.items.length);
  for (const it of plan.end_card.items) await expect(card).toContainText(it.text);
}

test("starter: the reply is illustrative, playback starts, the end card shows at 66 s", async ({
  page,
}) => {
  await stubPlan(page);
  await open(page);
  await page.getByRole("button", { name: DEVSIM_BRIEF }).click();
  await expect(await lastAnswer(page)).toContainText("illustrative");
  const list = page.getByTestId("devsim-list");
  await expect(list).toBeVisible();
  await expect(list.getByText(plan.labels.simulation)).toBeVisible();
  await expect(page.getByTestId("devsim-hypothetical")).toHaveAccessibleName(
    plan.labels.hypothetical,
  );
  // playing: the clock moves on its own
  const t0 = await page.evaluate(
    () => (window as unknown as { __devsim: { state: () => { t: number } } }).__devsim.state().t,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devsim: { state: () => { t: number } } }).__devsim.state().t,
      ),
    )
    .toBeGreaterThan(t0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __devsim: { total: number } }).__devsim.total,
    ),
  ).toBe(plan.total_s);
  await seek(page, 66);
  await expectEndCard(page);
  // every bubble is listed as a quote with its speaker
  await expect(page.getByTestId("devsim-quote")).toHaveCount(plan.bubbles.length);
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __devsim: { state: () => { playing: boolean } | null } }
          ).__devsim.state()?.playing ?? false,
      ),
    )
    .toBe(true);
});

test("no parcel in this world: the List view says the simulation is not available (AC-H6)", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: DEVSIM_BRIEF }).click();
  await lastAnswer(page);
  await expect(page.getByTestId("devsim-list").getByRole("alert")).toHaveText(NOT_AVAILABLE);
});

test("a development.play intent without a plan fetches it and plays to the end card", async ({
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
  await seek(page, 19);
  const first = plan.bubbles.find((b) => b.n === 1);
  await expect(page.getByTestId("devsim-quote").first()).toHaveAttribute("data-speaking", "true");
  if (first?.tag) await expect(page.getByTestId("devsim-quote").first()).toContainText(first.text);
  await seek(page, 66);
  await expectEndCard(page);
  // seeking back hides the end card again (AC-F6)
  await seek(page, 30);
  await expect(page.getByTestId("devsim-end-card")).toHaveCount(0);
});
