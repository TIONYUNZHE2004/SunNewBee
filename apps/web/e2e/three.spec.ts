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

// Three adjacent link houses (6.4 m frontage east-west, 15.5 m deep north-south) near HERO_CENTRE.
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((3.1805 * Math.PI) / 180));
const linkRing = (i: number) => {
  const x0 = 101.5095 + i * 6.4 * M_LON;
  const y0 = 3.1805;
  const x1 = x0 + 6.4 * M_LON;
  const y1 = y0 + 15.5 * M_LAT;
  return [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ];
};
const LINK_ROW = {
  ...BUILDINGS,
  buildings: {
    type: "FeatureCollection",
    features: [0, 1, 2].map((i) => ({
      type: "Feature",
      properties: {
        id: `link${i}`,
        kind: "residential",
        height_m: 8.5,
        archetype: "link_intermediate",
        precinct: "Elmina Valley 2",
      },
      geometry: { type: "Polygon", coordinates: linkRing(i) },
    })),
  },
};

// FIXME(Task 14): the lane `blender` glbs and public/city/manifest.json are not merged into lane/fe
// yet, so the real assets cannot load here. The coordinator unfixmes this at the Task 14 merge.
test.fixme("three.js city draws instanced archetypes from the real public/city assets", async ({
  page,
}) => {
  // Only the buildings layer is stubbed; /city/manifest.json and the glbs are the committed files.
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: LINK_ROW }));
  await page.goto("/?engine=three&bookmark=hero-near");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute("data-assets", "ready", { timeout: 20_000 });
  await expect(scene).toHaveAttribute("data-instances", "3");
  await expect.poll(async () => Number(await scene.getAttribute("data-frames"))).toBeGreaterThan(0);
});
