import { expect, test } from "@playwright/test";

test("demo=hero shows step 1 and Next advances", async ({ page }) => {
  await page.goto("/?demo=hero");
  const bar = page.getByRole("region", { name: "Demo walkthrough" });
  await expect(bar).toContainText("Demo 1 of 8");
  await expect(bar).toContainText(/Elmina Urban Park/);
  await bar.getByRole("button", { name: "Next" }).click();
  await expect(bar).toContainText("Demo 2 of 8");
  await expect(bar).toContainText(/stroller/);
  await page.keyboard.press("ArrowRight");
  await expect(bar).toContainText("Demo 3 of 8");
});

test("a deep spot missing from the dataset is skipped with a note", async ({ page }) => {
  await page.goto("/?demo=hero");
  const bar = page.getByRole("region", { name: "Demo walkthrough" });
  for (let i = 0; i < 3; i++) await bar.getByRole("button", { name: "Next" }).click();
  await expect(bar).toContainText("Demo 4 of 8");
  await expect(bar).toContainText("(not available in this dataset)");
});

test("exit demo removes the bar; without the param there is none", async ({ page }) => {
  await page.goto("/?demo=hero");
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.getByRole("region", { name: "Demo walkthrough" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Demo walkthrough" })).toHaveCount(0);
});
