import { expect, type Locator, type Page, test } from "@playwright/test";
import { journeyCardContent } from "../src/features/journey/cardContent";
import type { JourneyEvent } from "../src/features/journey/timeline";

const KIOSK = "Can I push a stroller from Car Park B to the kiosk without stairs?";

async function ask(page: Page, question: string) {
  await page.getByRole("textbox", { name: "Your question" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

/** The newest assistant message, and a wait until its stream has finished (data-done marker). */
async function lastAnswer(page: Page) {
  const last = page.getByRole("log").getByRole("article").last();
  await expect(last).toHaveAttribute("data-done", "true");
  return last;
}

async function open(page: Page) {
  await page.goto("/");
  // Wide screens can start with the panel closed; below lg the composer is always visible in the sheet.
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeVisible();
}

test("list fallback keeps the product working as text", async ({ page }) => {
  await open(page);
  await expect(page.getByText(/3D map couldn't load/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Map settings" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Camera" })).toHaveCount(0);
});

test("access hero shows a route status and honest demo evidence", async ({ page }) => {
  await open(page);
  await ask(page, "Can I push a stroller from Car Park B to the playground without stairs?");
  const last = await lastAnswer(page);
  await expect(last).toContainText(/Route status: confirmed/);
  await expect(last).toContainText(/Demo value · not surveyed/);
  await expect(last).not.toContainText(/(?<!not |un)verified/i);
  await last.getByRole("button", { name: /^Evidence/ }).click();
  await expect(last.getByRole("list", { name: "Evidence" })).toContainText(
    /Demo value · not surveyed/,
  );
});

test("flood answer carries the disclaimer and never says safe", async ({ page }) => {
  await open(page);
  await ask(
    page,
    "Priya uses a wheelchair at Lakeside Mall. If the river rises 3 m, where can she go?",
  );
  const last = await lastAnswer(page);
  await expect(last.getByText(/not a forecast/i).first()).toBeVisible();
  await expect(last).not.toContainText(/(?<![a-z])safe(?![a-z])/i);
});

test("settings popover sets a river level and shows the flood note", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Map settings" }).click();
  await page.getByRole("radio", { name: "+3 m" }).click();
  await expect(page.getByRole("note")).toContainText(/indicative scenario, not a forecast/i);
});

test("map view switch: the list view is always offered (demo recovery)", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Map settings" }).click();
  const views = page.getByRole("radiogroup", { name: "Map view" });
  // e2e runs keyless on the tiny fixture: no buildings, no keys, so the list is the only view.
  await expect(views.getByRole("radio", { name: "List (text)" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(views.getByRole("radio", { name: "3D" })).toBeDisabled();
});

test("Escape closes the settings popover and returns focus to its button", async ({ page }) => {
  await open(page);
  const btn = page.getByRole("button", { name: "Map settings" });
  await btn.click();
  const dialog = page.getByRole("dialog", { name: "Map settings" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(btn).toBeFocused();
});

test("theme menu switches the app theme", async ({ page }) => {
  await open(page);
  const attrs = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      skin: document.documentElement.dataset.skin,
    }));
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("menuitemradio", { name: "Night" }).click();
  expect(await attrs()).toEqual({ theme: "night", skin: "dark" });
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("menuitemradio", { name: "Day" }).click();
  expect(await attrs()).toEqual({ theme: "day", skin: "light" });
});

test("Tickets is reachable by keyboard Tab order from the rail", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Management" }).click();
  const tickets = page.getByRole("link", { name: /Tickets/ });
  await expect(tickets).toBeVisible();
  // The rail comes first in the page: skip link, home, Map, Assistant, then Tickets.
  await page.getByRole("link", { name: "Skip to content" }).focus();
  let reached = false;
  for (let i = 0; i < 8 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await tickets.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Gaps to close" })).toBeVisible();
});

test("mobile: the assistant input is reachable without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const input = page.getByRole("textbox", { name: "Your question" });
  await input.scrollIntoViewIfNeeded();
  await expect(input).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

/** The element's box once it has stopped moving (the sheet animates its height); no fixed sleeps. */
async function settledBox(locator: Locator) {
  let prev = "";
  await expect
    .poll(async () => {
      const b = await locator.boundingBox();
      const key = b ? JSON.stringify(b) : "none";
      const same = b !== null && key === prev;
      prev = key;
      return same;
    })
    .toBe(true);
  const box = await locator.boundingBox();
  if (!box) throw new Error("no layout box");
  return box;
}

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The settings gear's box never overlaps the visible attribution strip (AGENTS.md: always shown). */
async function expectGearClearOfAttribution(page: Page, text: string | RegExp = "Test fixture") {
  const gear = await settledBox(page.getByRole("button", { name: "Map settings" }));
  const attr = await settledBox(
    page.getByText(text, { exact: typeof text === "string" }).filter({ visible: true }),
  );
  expect(intersects(gear, attr), JSON.stringify({ gear, attr })).toBe(false);
  expect(gear.y + gear.height).toBeLessThanOrEqual(attr.y);
  return attr;
}

/** A multi-source attribution like a real world's (OSM, Copernicus, …); the fixture's is one word. */
const LONG_ATTRIBUTION = [
  "Test fixture",
  "© OpenStreetMap contributors (ODbL)",
  "Contains modified Copernicus Sentinel data, Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018",
  "Long attribution line for the wrap check",
];

test("desktop: the settings gear sits above a long, wrapping attribution strip", async ({
  page,
}) => {
  // Lengthen only this page's /site response; the tiny fixture's data stays as it is.
  await page.route("**/api/site", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, attribution: LONG_ATTRIBUTION } });
  });
  await open(page);
  const strip = /Long attribution line for the wrap check/;
  await expectGearClearOfAttribution(page, strip);
  await page.setViewportSize({ width: 1024, height: 768 });
  const attr = await expectGearClearOfAttribution(page, strip);
  // It really wraps at 1024 (one line of 0.68rem text is ~17 px), so --attr-h is exercised.
  expect(attr.height).toBeGreaterThan(28);
});

test("phone 390x844: the sheet sits at the bottom with a usable composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const header = await page.getByRole("banner").boundingBox();
  const input = page.getByRole("textbox", { name: "Your question" });
  await expect(input).toBeVisible();
  const box = await settledBox(input);
  if (!header) throw new Error("no layout box");
  const headerBottom = header.y + header.height;
  expect(box.y).toBeGreaterThanOrEqual(headerBottom);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  // The peeking sheet hugs the bottom of the screen, not the header.
  expect(box.y).toBeGreaterThan(844 / 2);
  const attribution = page.getByText("Test fixture", { exact: true });
  await expect(attribution).toBeVisible();
  const attr = await attribution.boundingBox();
  if (!attr) throw new Error("no attribution box");
  expect(attr.y).toBeGreaterThanOrEqual(headerBottom);
  expect(attr.y + attr.height).toBeLessThanOrEqual(box.y);
  await expectGearClearOfAttribution(page);

  const expand = page.getByRole("button", { name: "Expand assistant" });
  await expand.click();
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation).toBeVisible();
  // The sheet animates its height; wait for the conversation to get real room.
  await expect
    .poll(async () => (await conversation.boundingBox())?.height ?? 0)
    .toBeGreaterThan(150);
  const log = await settledBox(conversation);
  const after = await settledBox(input);
  expect(log.y).toBeGreaterThanOrEqual(headerBottom);
  expect(after.y + after.height).toBeLessThanOrEqual(844);
  await expectGearClearOfAttribution(page);
  // Visible at half, so the toBeHidden check at full below cannot pass vacuously.
  await expect(page.getByRole("button", { name: "Map settings" })).toBeVisible();

  // Full: the composer stays on screen, the sheet carries the attribution, and the map controls
  // behind it leave the accessibility tree.
  await expand.click();
  await expect(page.getByRole("slider", { name: "Assistant height" })).toHaveAttribute(
    "aria-valuetext",
    "full",
  );
  await expect(input).toBeVisible();
  const full = await settledBox(input);
  expect(full.y).toBeGreaterThanOrEqual(headerBottom);
  expect(full.y + full.height).toBeLessThanOrEqual(844);
  const sheetAttribution = page
    .getByText("Test fixture", { exact: true })
    .filter({ visible: true });
  await expect(sheetAttribution).toBeVisible();
  const sheetAttr = await settledBox(sheetAttribution);
  expect(sheetAttr.y).toBeGreaterThanOrEqual(full.y + full.height);
  expect(sheetAttr.y + sheetAttr.height).toBeLessThanOrEqual(844);
  await expect(page.getByRole("button", { name: "Map settings" })).toBeHidden();
});

// The local DB persists tickets between runs, so a retry would see a resolved ticket (applies file-wide).
test.describe.configure({ retries: 0 });

test("management: a gap becomes a ticket, staff resolve it, before/after shows", async ({
  page,
}) => {
  await open(page);
  await ask(page, KIOSK);
  await expect(await lastAnswer(page)).toContainText(/Route status: partly unverified/);
  await page.getByRole("radio", { name: "Management" }).click();
  await page.getByRole("link", { name: /Tickets/ }).click();
  await expect(page.getByRole("heading", { name: "Gaps to close" })).toBeVisible();
  const row = page.getByRole("button", { name: /Incline/ });
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Staff access").fill("e2e-token");
  // Nothing is recorded yet, so "Record what you found" is the correct-path option.
  await page.getByText("Record what you found").click();
  await expect(page.getByRole("radio", { name: /Record what you found/ })).toBeChecked();
  await page.getByLabel("Value found on site").fill("4");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText(/Verified on/)).toBeVisible();
  const before = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Before" }) });
  await expect(before).toContainText("Not checked yet");

  // The headline claim: the same question now gets a confirmed route.
  await page.getByRole("link", { name: "Back to map" }).click();
  await ask(page, KIOSK);
  const again = await lastAnswer(page);
  await expect(again).toContainText(/Route status: confirmed/);
  await expect(again).not.toContainText(/partly unverified/);
});

test("what-if hero: the assistant imagines a ramp and the answer is labelled not real", async ({
  page,
}) => {
  await open(page);
  await ask(page, "What if we build a ramp at the steps? How many wheelchair journeys would work?");
  const last = await lastAnswer(page);
  await expect(last).toContainText(/In this what-if simulation/);
  await expect(last).toContainText(/Imagined changes are not real/);
  await expect(last).toContainText(/Answer checked against the township data/);
  await expect(last).not.toContainText(/ is confirmed|will be built/);
  // The list view (no WebGL, no keys) spells out the same diff the 3D map draws (Cycle 8).
  const diff = page.getByRole("region", { name: "What-if · not real" });
  await expect(diff).toContainText("Imagined changes");
  await expect(diff).toContainText(/today \d+, what-if \d+ \(of \d+\)/);
  // Earlier tests change the shared world, so the imagined change varies; the row never ends empty.
  await expect(diff).toContainText(
    /→ would be (confirmed|partly unverified|blocked|no mapped connection)/,
  );
  await diff.getByRole("button", { name: "Clear what-if" }).click();
  await expect(diff).toHaveCount(0);
});

test("What-if Lab: staff run a river rise plus a suggested change on a copy of the township", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("radio", { name: "Management" }).click();
  await page.getByRole("button", { name: "Open What-if Lab" }).click();
  const lab = page.getByRole("region", { name: "What-if Lab" });
  // Earlier tests resolve tickets on the shared world, so take whatever the model suggests first.
  await lab.getByRole("checkbox").first().check();
  await lab.getByRole("button", { name: "Run what-if" }).click();
  const note = lab.getByRole("note");
  await expect(note).toContainText("What-if · not real");
  await expect(note).toContainText(/River \+3 m \(indicative scenario\)/);
  await expect(note).toContainText(/Reach a centre \(river rise only\)/);
  await expect(note).toContainText(/not a forecast/);
});

test("Rising river: synthetic residents per stage, labelled a simulation", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Management" }).click();
  await page.getByRole("button", { name: "Rising river" }).click();
  const panel = page.getByRole("region", { name: "Rising river" });
  await expect(panel.getByRole("note")).toContainText(/not a forecast/);
  // T-024: river stages are +1/+2/+3 m; the top stage is +3 m
  await panel.getByRole("button", { name: "River +3 m" }).click();
  await expect(panel.getByRole("list", { name: "At River +3 m" })).toContainText(
    /of \d+ still reach a centre/,
  );
});

test("tipping point: the assistant names the river level where a trip breaks", async ({ page }) => {
  await open(page);
  await ask(
    page,
    "At which river level does my route from the playground to the evacuation centre break?",
  );
  const last = await lastAnswer(page);
  await expect(last).toContainText(/River \+3 m/);
  await expect(last).toContainText(/not a forecast/);
});

test("ticket impact: the world model says what one check would change", async ({ page }) => {
  await open(page);
  await ask(page, "Can I push a stroller from Car Park B to the kiosk without stairs?");
  await lastAnswer(page);
  await page.goto("/tickets");
  const card = page.getByRole("region", { name: "What this check changes" });
  await expect(card).toContainText(/would become confirmed|changed/);
  await expect(card).toContainText(/planning estimate/);
});

test("Elmina Day: synthetic residents live a day; the clock drives the list and the feed", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("radio", { name: "Management" }).click();
  await page.getByRole("button", { name: "Simulate a day" }).click();
  const panel = page.getByRole("region", { name: "Simulate a day" });
  await expect(panel).toContainText("not a forecast");
  await panel.getByRole("button", { name: "A normal weekday" }).click();
  await expect(panel.getByRole("button", { name: "Play on the map" })).toBeVisible();
  await panel.getByRole("slider", { name: "Time of day" }).fill("480");
  await expect(panel).toContainText(/At 08:00: \d+ walking, \d+ driving, \d+ waiting/);
  // the list view spells out the same moment
  await expect(page.getByRole("heading", { name: /A normal weekday · 08:00/ })).toBeVisible();
  await panel.getByRole("tab", { name: "Overview" }).click();
  await expect(panel.getByRole("table")).toContainText("Wheelchair users");
  await panel.getByRole("tab", { name: "How it was made" }).click();
  await expect(panel).toContainText("DOSM");
  await panel.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("region", { name: "Simulate a day" })).toHaveCount(0);
});

test("Test a change: the same day with an imagined change, who gains and who loses", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("radio", { name: "Management" }).click();
  await page.getByRole("button", { name: "Simulate a day" }).click();
  const panel = page.getByRole("region", { name: "Simulate a day" });
  await panel.getByRole("button", { name: "A normal weekday" }).click();
  await panel.getByRole("tab", { name: "Test a change" }).click();
  await panel.getByRole("button", { name: "Compare the day" }).click();
  const result = panel.getByRole("region", { name: "Before and after" });
  await expect(result).toContainText("not a plan");
  await expect(result).toContainText(/\d+ residents would be better off and \d+ worse off/);
  await expect(page.getByRole("note").filter({ hasText: "What-if · not real" })).toBeVisible();
});

test("Rehearse my trip: a resident's own trip through a rehearsed day, departure by departure", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Rehearse my trip" }).click();
  const card = page.getByRole("region", { name: "Rehearse my trip" });
  await expect(card).toContainText("not a forecast and not advice");
  await card.getByRole("textbox", { name: "From" }).fill("Car Park B");
  await card.getByRole("button", { name: "Car Park B", exact: true }).click();
  await card.getByRole("textbox", { name: "To" }).fill("playground");
  await card
    .getByRole("button", { name: /playground/i })
    .first()
    .click();
  await card.getByRole("combobox", { name: "Rehearsed day" }).selectOption("weekday");
  await card.getByRole("button", { name: "Rehearse", exact: true }).click();
  const strip = card.getByRole("region", { name: "Your trip in the rehearsal" });
  await expect(strip).toContainText("A normal weekday");
  await expect(strip.getByRole("button", { name: /Leaving at 07:30: got there/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // the list view (no map keys in e2e) spells out the same trip
  await expect(page.getByRole("heading", { name: "Your trip · rehearsal" })).toBeVisible();
  await expect(card).not.toContainText(/\b(?:safe|you should|leave by)\b/i);
});

test("route answer lists every journey event as numbered steps in the list view (AC-D14)", async ({
  page,
}) => {
  await open(page);
  const chat = page.waitForResponse(
    (r) => r.url().includes("/api/chat") && r.request().method() === "POST",
  );
  await ask(page, "Can I push a stroller from Car Park B to the playground without stairs?");
  const body = await (await chat).text();
  // The plan the page received: the scene.intent whose kind is journey.play.
  let events: JourneyEvent[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:") || !line.includes("journey.play")) continue;
    const j = JSON.parse(line.slice(5).trim());
    const intent = j.intent ?? j.data?.intent ?? j;
    const plan = intent.journey ?? intent.plan;
    if (plan?.events) events = plan.events;
  }
  expect(events.length).toBeGreaterThan(0);
  await lastAnswer(page);
  const steps = page.getByTestId("journey-steps");
  await expect(steps).toBeVisible();
  await expect(steps).toContainText("Simulation · indicative times, not a prediction");
  const items = steps.getByRole("listitem");
  await expect(items).toHaveCount(events.length);
  for (const [i, e] of events.entries()) {
    const item = items.nth(i);
    await expect(item).toContainText(`${i + 1}.`);
    // the same title, status and source line as the 3D event card (one shared function)
    const c = journeyCardContent(e);
    await expect(item).toContainText(c.title);
    await expect(item).toContainText(c.statusLabel);
    await expect(item.getByTestId("card-source")).toContainText(c.source);
    if (e.element_id) await expect(item.getByTestId("card-element")).toHaveText(e.element_id);
    if (e.demo) await expect(item).toContainText("Demo value · not surveyed");
    else await expect(item).not.toContainText("Demo value · not surveyed");
  }
  await expect(steps).not.toContainText(/(?<![a-z])safe(?![a-z])/i);
});

test("route answer offers Watch the trip and working player controls (AC-D13)", async ({
  page,
}) => {
  await open(page);
  await ask(page, "Can I push a stroller from Car Park B to the playground without stairs?");
  await lastAnswer(page);
  type Hook = {
    total: number;
    phases: unknown[];
    state: () => { t: number; playing: boolean; camMode: string } | null;
  };
  const state = () =>
    page.evaluate(() => (window as unknown as { __journey: Hook }).__journey.state());
  const watch = page.getByRole("button", { name: "Watch the trip" });
  await expect(watch).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __journey: Hook }).__journey.total),
  ).toBeGreaterThan(0);
  expect(await state()).toMatchObject({ t: 0, playing: false });
  // e2e runs in the List view, which has no player: Watch loads the trip paused at the start and
  // the controls offer no Play/Pause or Restart (they play in 3D only; JourneyControls.dom.test).
  await watch.click();
  expect(await state()).toMatchObject({ t: 0, playing: false });
  const controls = page.getByTestId("journey-controls");
  await expect(controls.getByRole("button", { name: /^(Play|Pause|Restart)$/ })).toHaveCount(0);
  await controls.getByRole("button", { name: "Overview" }).click();
  expect((await state())?.camMode).toBe("overview");
  await controls.getByRole("slider", { name: "Trip position" }).fill("10");
  expect((await state())?.t).toBe(10);
});
