import { expect, type Page, test } from "@playwright/test";

// AC-A16 (store half) and AC-A17 on the tiny fixture (List view). The render-tier half of AC-A16
// runs in the acceptance harness against the Elmina seed.
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    // The tiny fixture has no buildings, so GET /layers/buildings answers 404 by design (the
    // browser logs it as a console error). The Elmina seed has buildings: the acceptance spec
    // checks AC-A17 there without this allowance.
    if (m.type() === "error" && !m.location().url.endsWith("/api/layers/buildings"))
      problems.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() === 404 && !r.url().endsWith("/api/layers/buildings"))
      problems.push(`404: ${r.url()}`);
  });
  return problems;
}

test("AC-A17: / and /tickets log no console error and no 404 (favicon served)", async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.goto("/tickets");
  await page.waitForLoadState("networkidle");
  const res = await page.request.get("/favicon.svg");
  expect(res.status()).toBe(200);
  expect(problems).toEqual([]);
});

test("?demo=1 forces Day and path status off without touching stored settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("tl.theme", "night");
      localStorage.setItem("tl.pathStatus", "true");
      localStorage.setItem("tl.quality", "low");
    }
  });
  await page.goto("/?demo=1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  await page.getByRole("button", { name: "Map settings" }).click();
  await expect(
    page
      .getByRole("radiogroup", { name: "Path status" })
      .getByRole("radio", { name: "Path status off" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => localStorage.getItem("tl.theme"))).toBe("night");
  expect(await page.evaluate(() => localStorage.getItem("tl.pathStatus"))).toBe("true");
  expect(await page.evaluate(() => localStorage.getItem("tl.quality"))).toBe("low");

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
});
