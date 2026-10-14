import { expect, type Page, test } from "@playwright/test";

async function ask(page: Page, question: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Your question" }).fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}

test("access hero in list view shows a route status and verified evidence", async ({ page }) => {
  await ask(page, "Can I push a stroller from Car Park B to the playground without stairs?");
  const log = page.getByRole("log");
  await expect(log).toContainText(/route confirmed/);
  await expect(log).toContainText(/verified/);
});

test("flood hero shows the disclaimer and never says 'safe'", async ({ page }) => {
  await ask(
    page,
    "Priya uses a wheelchair at Lakeside Mall. If the river rises 3 m, where can she go?",
  );
  const log = page.getByRole("log");
  await expect(log.getByText(/not a forecast/i).first()).toBeVisible();
  // Wait for the stream to finish (the button reads "Sending…" while streaming).
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(log).not.toContainText(/\bsafe\b/i);
});

test("manage page lists the verification request after the kiosk question", async ({ page }) => {
  await ask(page, "Can I push a stroller from Car Park B to the kiosk without stairs?");
  const log = page.getByRole("log");
  await expect(log).toContainText(/route partly_unverified/);
  await expect(log).toContainText(/Not checked yet/);
  await page.goto("/manage");
  await expect(page.getByText("seg-cf").first()).toBeVisible();
});

test("flood briefing labels official and candidate evacuation centres", async ({ page }) => {
  await page.goto("/manage");
  await page.getByRole("tab", { name: "Flood briefing" }).click();
  await expect(page.getByRole("cell", { name: "Official PPS" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Candidate" }).first()).toBeVisible();
});

for (const path of ["/", "/manage"]) {
  test(`every button and textbox on ${path} has an accessible name`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const role of ["button", "textbox", "combobox"] as const) {
      const els = page.getByRole(role);
      const n = await els.count();
      for (let i = 0; i < n; i++) {
        const el = els.nth(i);
        const name = await el.evaluate(
          (node) =>
            (node as HTMLElement).ariaLabel ||
            (node as HTMLInputElement).labels?.[0]?.textContent ||
            node.textContent ||
            "",
        );
        expect(name.trim(), `${role} #${i} on ${path}`).not.toBe("");
      }
    }
  });
}

test("list view: clicking a place opens its card; Esc closes and returns focus", async ({
  page,
}) => {
  await page.goto("/");
  const btn = page.getByRole("button", { name: "Car Park B" });
  await btn.click();
  const card = page.getByRole("dialog", { name: "Car Park B" });
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(btn).toBeFocused();
});

test("journey tests: staff runs the batch and sees the stroller row", async ({ page }) => {
  await page.goto("/manage");
  await page.getByRole("tab", { name: "Journey tests" }).click();
  await page.getByLabel("Staff token").fill("e2e-token");
  await page.getByRole("button", { name: "Run journey tests" }).click();
  const matrix = page.getByRole("table", { name: /Journey outcomes by mobility profile/ });
  await expect(matrix.getByRole("rowheader", { name: "Stroller" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "finished" })).toBeVisible();
});
