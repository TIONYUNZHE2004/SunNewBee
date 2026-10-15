import { expect, type Page, test } from "@playwright/test";

const KIOSK = "Can I push a stroller from Car Park B to the kiosk without stairs?";

async function ask(page: Page, question: string) {
  await page.getByRole("textbox", { name: "Your question" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeVisible();
}

test("list fallback keeps the product working as text", async ({ page }) => {
  await open(page);
  await expect(page.getByText(/3D map couldn't load/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Map settings" })).toBeVisible();
});

test("access hero shows a route status and honest demo evidence", async ({ page }) => {
  await open(page);
  await ask(page, "Can I push a stroller from Car Park B to the playground without stairs?");
  const log = page.getByRole("log");
  await expect(log).toContainText(/Route status: confirmed/);
  await expect(log).toContainText(/Demo value · not surveyed/);
});

test("flood answer carries the disclaimer and never says safe", async ({ page }) => {
  await open(page);
  await ask(
    page,
    "Priya uses a wheelchair at Lakeside Mall. If the river rises 3 m, where can she go?",
  );
  const log = page.getByRole("log");
  await expect(log.getByText(/not a forecast/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  await expect(log).not.toContainText(/\bsafe\b/i);
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

test("day/night toggle switches the app theme", async ({ page }) => {
  await open(page);
  const toggle = page.getByRole("button", { name: /Switch to (day|night) theme/ });
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await toggle.click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(["day", "night"]).toContain(after);
  expect(after).not.toBe(before);
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

test("management: a gap becomes a ticket, staff resolve it, before/after shows", async ({
  page,
}) => {
  await open(page);
  await ask(page, KIOSK);
  await expect(page.getByRole("log")).toContainText(/Route status: partly unverified/);
  await page.getByRole("radio", { name: "Management" }).click();
  await page.getByRole("link", { name: /Tickets/ }).click();
  await expect(page.getByRole("heading", { name: "Gaps to close" })).toBeVisible();
  // The only open ticket is auto-selected; clicking its row is idempotent.
  await page.getByRole("button", { name: /Incline/ }).click();
  await page.getByLabel("Staff access").fill("e2e-token");
  // Nothing is recorded yet, so "Record what you found" is the correct-path option.
  await page.getByRole("radio", { name: /Record what you found/ }).click();
  await page.getByLabel("Value found on site").fill("4");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText(/Verified on/)).toBeVisible();
  await expect(page.getByText("Not checked yet").first()).toBeVisible();
});
