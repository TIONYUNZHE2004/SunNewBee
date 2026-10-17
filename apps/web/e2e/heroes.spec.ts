import { expect, type Locator, type Page, test } from "@playwright/test";

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

test("Tickets is reachable by keyboard Tab order from the header", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Management" }).click();
  const tickets = page.getByRole("link", { name: /Tickets/ });
  await expect(tickets).toBeVisible();
  await page.getByRole("radio", { name: "Management" }).focus();
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
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
