import { expect, test } from "@playwright/test";

// Headless Chromium no longer falls back to SwiftShader on its own.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

const ring = (x: number, y: number, d = 0.0001) => [
  [
    [x, y],
    [x + d, y],
    [x + d, y + d],
    [x, y + d],
    [x, y],
  ],
];
const BUILDINGS = {
  buildings: {
    type: "FeatureCollection",
    features: [0, 1, 2].map((i) => ({
      type: "Feature",
      properties: { id: `t${i}`, height_m: 9 + i * 6, kind: "residential" },
      geometry: { type: "Polygon", coordinates: ring(101.5095 + i * 0.0004, 3.1808) },
    })),
  },
  trees: { type: "FeatureCollection", features: [] },
  as_of: "2026-10-17",
  attribution: [],
};

test("three.js stylised scene mounts, renders and draws a highlighted route", async ({ page }) => {
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: BUILDINGS }));
  await page.goto("/?engine=three");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible();
  await expect.poll(async () => Number(await scene.getAttribute("data-frames"))).toBeGreaterThan(0);
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await page
    .getByRole("textbox", { name: "Your question" })
    .fill("Can I push a stroller from Car Park B to the playground without stairs?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(scene).toHaveAttribute("data-route", "on");
});
