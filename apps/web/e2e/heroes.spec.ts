import { expect, type Page, test } from "@playwright/test";

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
  const last = await lastAnswer(page);
  await expect(last).toContainText(/Route status: confirmed/);
  await expect(last).toContainText(/Demo value · not surveyed/);
  await expect(last).not.toContainText(/(?<!not |un)verified/i);
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
  await page.getByRole("radio", { name: /Record what you found/ }).click();
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
