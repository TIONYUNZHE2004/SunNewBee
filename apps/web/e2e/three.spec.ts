import { expect, test } from "@playwright/test";

// Headless Chromium no longer falls back to SwiftShader on its own.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

// CI is always cold (Vite compiles three.js on the first request) and software WebGL starves the main
// thread, so every wait on the scene, or on UI that waits behind it, gets a long timeout.
const COLD = { timeout: 30_000 };

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
  await expect(scene).toBeVisible(COLD);
  await expect
    .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
    .toBeGreaterThan(0);
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await page
    .getByRole("textbox", { name: "Your question" })
    .fill("Can I push a stroller from Car Park B to the playground without stairs?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(scene).toHaveAttribute("data-route", "on", COLD);
  // The frame loop is still running with the route drawn.
  await expect
    .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
    .toBeGreaterThan(0);
});

const NOTE = "Decorative details are illustrative.";

test("the decorative disclaimer is visible in the three.js scene", async ({ page }) => {
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: BUILDINGS }));
  await page.goto("/?engine=three");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible(COLD);
  await expect
    .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
    .toBeGreaterThan(0);
  await expect(page.getByText(NOTE)).toBeVisible(COLD);
});

test("clicking a stubbed place marker opens the place card", async ({ page }) => {
  // One place exactly at the bookmark target (HERO_CENTRE): with the assistant panel hidden the
  // camera target is the canvas centre, so the screen-space marker sits there (no test hook needed).
  const ACCESS = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "stub-place", name: "Stub Park", type: "park" },
        geometry: { type: "Point", coordinates: [101.5095, 3.1805] },
      },
    ],
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: BUILDINGS }));
  await page.route("**/api/layers/access*", (r) => r.fulfill({ json: ACCESS }));
  await page.goto("/?engine=three&bookmark=hero-near");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible(COLD);
  // The panel offset shifts the look point: hide the assistant and wait until it is gone.
  const hide = page.getByRole("button", { name: "Hide assistant" });
  await expect(hide).toBeVisible(COLD);
  await hide.click();
  await expect(page.getByRole("button", { name: "Show assistant" })).toBeVisible(COLD);
  // The marker is built from the stubbed access layer (data-markers) and a frame has drawn since.
  await expect(scene).toHaveAttribute("data-markers", "1", COLD);
  const frames = Number(await scene.getAttribute("data-frames"));
  await expect
    .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
    .toBeGreaterThan(frames);
  const box = await scene.boundingBox();
  if (!box) throw new Error("no scene box");
  const card = page.getByRole("dialog").getByRole("button", { name: "Close place details" });
  // A click that lands before the view offset settles misses the 9.5 px pick radius: retry.
  await expect(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
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

test("three.js city draws instanced archetypes from the real public/city assets", async ({
  page,
}) => {
  // Only the buildings layer is stubbed; /city/manifest.json and the glbs are the committed files.
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: LINK_ROW }));
  await page.goto("/?engine=three&bookmark=hero-near");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible(COLD);
  await expect(scene).toHaveAttribute("data-assets", "ready", { timeout: 20_000 });
  await expect(scene).toHaveAttribute("data-instances", "3");
  await expect
    .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
    .toBeGreaterThan(0);
});

test("a probe bookmark streams tiles: data-tiles > 0 and frames render at probe-a", async ({
  page,
}) => {
  // probe-a (Elmina Valley 3) lies ~1.5 km south of the tiny fixture: the rig clamps the target
  // near the world bounds, and the streamer still activates the tiles around it.
  await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: BUILDINGS }));
  await page.goto("/?engine=three&bookmark=probe-a");
  const scene = page.getByTestId("three-scene");
  await expect(scene).toBeVisible(COLD);
  await expect
    .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await scene.getAttribute("data-tiles")), COLD)
    .toBeGreaterThan(0);
});
