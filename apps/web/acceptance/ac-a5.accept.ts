import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  ACCEPTANCE_BOOKMARKS,
  type AcceptanceBookmark,
  gotoBookmark,
  HOOK,
  settle,
} from "./support/bookmarks";
import type { RGBAImage } from "./support/pixels";
import { decodePng, mapArea } from "./support/scene";

/**
 * AC-A5 (task A-T4): the stylised display is clipped to the Elmina outline and sits on a diorama
 * slab. Output: ACCEPTANCE_OUT (default: the journey-sim ledger folder `acceptance/A-T4`).
 *
 * 1. Vertex check, two halves:
 *    - planners in node (vitest, Elmina seed): `ground/clipLayer.test.ts` (buildings, landmarks,
 *      trees, signs, land cover, parks, water), `stream/clipTile.test.ts` (city extrusions and
 *      ground meshes, plus every streamed tile at High ring 0: props, lamps, signs, road ribbons,
 *      verges, lots, agents) and `ground/slab.test.ts` (outline = boundary within 1 m);
 *    - live (hook `displayAudit`): every used vertex of every visible main-scene mesh and every
 *      visible instance origin, at the overview and at an edge pose, <= 5 m outside the outline.
 * 2. Slab edge on every side at the overview bookmark: for each outline vertex the hook projects
 *    the top outline point and the outer bottom corner of its soil section; the pixels sampled along
 *    that segment (the band just outside the projected outline) must show soil colour. Vertices are
 *    grouped by the compass side their section faces (N/E/S/W). A side passes only when its extreme
 *    vertex (N: most northerly, S: most southerly, E: most easterly, W: most westerly; the
 *    township's outer edge, not a notch) is on screen and shows soil, and >= 80% of the side's
 *    vertices are on screen (fix round 1). The overview is derived from the outline at runtime
 *    (A-T5, `cameraFit.ts` overviewPose: the whole slab at max range, clear of the map chrome).
 *    The run continues past a failing side so every number is written before the assertions.
 * 3. AC-B10 (B-T9, `-g AC-B10` selects this test): >= 3 distinct soil bands (luminance steps,
 *    `bandsOf`) along one vertex's section at the overview; the rounded rim and layers are vitest
 *    (`ground/slab.test.ts`). The criterion is a screenshot review: `overview.png` is written here.
 * Routing parity and the golden questions are pytest / `pnpm golden` (not here).
 */
const OUT =
  process.env.ACCEPTANCE_OUT ??
  "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/journey-sim/acceptance/A-T4";

/**
 * A pose over the east edge of the outline (local x ~ +2.1 km), 800 m range looking west, so the
 * streamed tiles straddle the edge: the live audit sees clipped roads, props and agents there.
 */
const EDGE_POSE: AcceptanceBookmark = {
  centre: [101.528, 3.1752],
  rangeM: 800,
  pitchDeg: -45,
  headingDeg: 270,
  theme: "day",
  note: "East edge of the Elmina outline (A-T4 audit pose).",
};

type Side = "N" | "E" | "S" | "W";

const px = (img: RGBAImage, x: number, y: number): [number, number, number] => {
  const o = (y * img.width + x) * 4;
  return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
};

/** HSV hue (deg) and saturation of an sRGB triple. */
function hueSat(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return [0, 0];
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max === 0 ? 0 : d / max];
}

/**
 * Soil colour (the slab's clay browns, lit and hazed): warm hue 10-50 deg, saturation >= 0.15,
 * red over blue by >= 15. The void past the slab is the fog / sky colour (cool, low saturation).
 */
function isSoil(r: number, g: number, b: number): boolean {
  const [h, s] = hueSat(r, g, b);
  return h >= 10 && h <= 50 && s >= 0.15 && r - b >= 15;
}

async function waitStable(page: Page): Promise<void> {
  const read = () =>
    page.evaluate((h) => {
      const api = (window as unknown as Record<string, { roadVertices(): number }>)[h];
      return String(api?.roadVertices() ?? 0);
    }, HOOK);
  let last = "";
  let same = 0;
  for (let i = 0; i < 90 && same < 2; i++) {
    await page.waitForTimeout(1000);
    const now = await read();
    same = now === last && Number(now) > 0 ? same + 1 : 0;
    last = now;
  }
}

async function audit(page: Page) {
  return page.evaluate((h) => {
    const api = (window as unknown as Record<string, { displayAudit(): unknown }>)[h];
    return api.displayAudit() as {
      meshes: number;
      vertices: number;
      instances: number;
      worstVertexM: number;
      worstInstanceM: number;
      over: { name: string; outsideM: number }[];
    } | null;
  }, HOOK);
}

test("AC-A5: planners in node keep every display vertex within 5 m (vitest, Elmina seed)", () => {
  mkdirSync(OUT, { recursive: true });
  const files = [
    "src/features/scene/three/ground/boundary.test.ts",
    "src/features/scene/three/ground/clipLayer.test.ts",
    "src/features/scene/three/ground/slab.test.ts",
    "src/features/scene/three/stream/clipTile.test.ts",
  ];
  let out = "";
  let ok = true;
  try {
    out = execFileSync("pnpm", ["exec", "vitest", "run", ...files, "--reporter=verbose"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      shell: true,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    ok = false;
    out = String((e as { stdout?: string }).stdout ?? e);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  writeFileSync(join(OUT, "ac-a5-vitest.txt"), plain);
  const stats = plain.match(/A-T4 clip stats \(Elmina seed\): (.*)/)?.[1];
  const sweep = plain.match(/A-T4 tile sweep: (.*)/)?.[1];
  writeFileSync(
    join(OUT, "ac-a5-vertices.json"),
    `${JSON.stringify(
      {
        task: "A-T4 AC-A5 vertex check (node planners)",
        capturedAt: new Date().toISOString(),
        pass: ok,
        clipStats: stats ? JSON.parse(stats) : null,
        tileSweep: sweep ? JSON.parse(sweep) : null,
      },
      null,
      2,
    )}\n`,
  );
  expect(ok, "vitest clip / slab / tile-sweep suites pass").toBe(true);
});

test("AC-A5 / AC-B10: the overview shows the slab soil edge on every side (>= 3 soil bands); live display audit", async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const bm = await gotoBookmark(page, "overview");
  await waitStable(page);
  await page.waitForTimeout(1500);
  const png = await page.screenshot({ path: join(OUT, "overview.png") });
  const img = await decodePng(page, png);
  const area = await mapArea(page, img.width, img.height);
  const outline = await page.evaluate((h) => {
    const api = (window as unknown as Record<string, { slabOutline(): unknown }>)[h];
    return api.slabOutline() as
      | {
          x: number;
          y: number;
          lx: number;
          lz: number;
          inFront: boolean;
          foot: { x: number; y: number };
        }[][]
      | null;
  }, HOOK);
  expect(outline, "a slab is drawn").not.toBeNull();
  const rect = area.canvas;
  const onMap = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < img.width &&
    y < img.height &&
    area.mask[Math.floor(y) * img.width + Math.floor(x)] === 1;

  const sides: Record<Side, { vertices: number; onScreen: number; soil: number }> = {
    N: { vertices: 0, onScreen: 0, soil: 0 },
    E: { vertices: 0, onScreen: 0, soil: 0 },
    S: { vertices: 0, onScreen: 0, soil: 0 },
    W: { vertices: 0, onScreen: 0, soil: 0 },
  };
  const marks: { x: number; y: number; soil: boolean }[] = [];
  /** Every outline vertex: its side, local position, on screen, shows soil. */
  const verts: { side: Side; lx: number; lz: number; onScreen: boolean; soil: boolean }[] = [];
  let maxBands = 0;
  for (const ring of outline ?? [])
    for (const v of ring) {
      const side = sideOf(v, ring);
      sides[side].vertices++;
      const row = { side, lx: v.lx, lz: v.lz, onScreen: false, soil: false };
      verts.push(row);
      const tx = rect.x + v.x;
      const ty = rect.y + v.y;
      const bx = rect.x + v.foot.x;
      const by = rect.y + v.foot.y;
      if (!v.inFront || !onMap(tx, ty) || !onMap(bx, by)) continue;
      sides[side].onScreen++;
      row.onScreen = true;
      // Samples along the band below the outline (skip the first 2 px: the outline itself).
      const len = Math.hypot(bx - tx, by - ty);
      let soil = 0;
      let n = 0;
      const lumas: number[] = [];
      for (let d = 2; d <= Math.max(2, len); d += 1) {
        const x = Math.round(tx + ((bx - tx) * d) / Math.max(len, 1e-6));
        const y = Math.round(ty + ((by - ty) * d) / Math.max(len, 1e-6));
        if (!onMap(x, y)) continue;
        const [r, g, b] = px(img, x, y);
        n++;
        if (isSoil(r, g, b)) {
          soil++;
          lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
        }
      }
      const shows = n > 0 && soil >= Math.min(2, n);
      if (shows) sides[side].soil++;
      row.soil = shows;
      marks.push({ x: tx, y: ty, soil: shows });
      maxBands = Math.max(maxBands, bandsOf(lumas));
    }

  const live = await audit(page);
  await gotoBookmark(page, "hero-mid"); // leave the overview so the edge pose streams fresh tiles
  await page.evaluate(
    ({ h, p }) => {
      (window as unknown as Record<string, { setPose(p: unknown): void }>)[h]?.setPose(p);
    },
    {
      h: HOOK,
      p: {
        lon: EDGE_POSE.centre[0],
        lat: EDGE_POSE.centre[1],
        rangeM: EDGE_POSE.rangeM,
        pitchDeg: EDGE_POSE.pitchDeg,
        headingDeg: EDGE_POSE.headingDeg,
      },
    },
  );
  await settle(page);
  await waitStable(page);
  await page.screenshot({ path: join(OUT, "edge-east.png") });
  const liveEdge = await audit(page);

  // Fix round 1 (coordinator): a side passes only when its EXTREME vertex (the township's outer
  // edge on that side: N = most northerly, i.e. min lz; S = max lz; E = max lx; W = min lx; not a
  // notch) is on screen and shows soil, AND >= 80% of that side's vertices are on screen.
  const pick = (better: (a: (typeof verts)[number], b: (typeof verts)[number]) => boolean) =>
    verts.reduce<(typeof verts)[number] | null>((m, v) => (!m || better(v, m) ? v : m), null);
  const extreme: Record<Side, (typeof verts)[number] | null> = {
    N: pick((a, b) => a.lz < b.lz),
    S: pick((a, b) => a.lz > b.lz),
    E: pick((a, b) => a.lx > b.lx),
    W: pick((a, b) => a.lx < b.lx),
  };
  const MIN_ON_SCREEN = 0.8;
  const onShare = (s: Side) => (sides[s].vertices ? sides[s].onScreen / sides[s].vertices : 0);
  const sideOk = (s: Side) =>
    !!extreme[s]?.onScreen && !!extreme[s]?.soil && onShare(s) >= MIN_ON_SCREEN;
  const m = {
    task: "A-T4 AC-A5",
    capturedAt: new Date().toISOString(),
    bookmark: bm,
    sides: Object.fromEntries(
      (Object.keys(sides) as Side[]).map((s) => [
        s,
        {
          ...sides[s],
          soilShare: sides[s].onScreen ? sides[s].soil / sides[s].onScreen : null,
          onScreenShare: onShare(s),
          extreme: extreme[s],
          pass: sideOk(s),
        },
      ]),
    ),
    maxSoilBandsSeenOnOneVertex: maxBands,
    liveAudit: { overview: live, edgePose: { pose: EDGE_POSE, audit: liveEdge } },
    marks,
    pass:
      (Object.keys(sides) as Side[]).every(sideOk) &&
      !!live &&
      live.worstVertexM <= 5 &&
      live.worstInstanceM <= 5 &&
      !!liveEdge &&
      liveEdge.worstVertexM <= 5 &&
      liveEdge.worstInstanceM <= 5,
  };
  writeFileSync(join(OUT, "ac-a5.json"), `${JSON.stringify(m, null, 2)}\n`);

  expect(live?.worstVertexM ?? 99, "overview: mesh vertices <= 5 m outside").toBeLessThanOrEqual(5);
  expect(live?.worstInstanceM ?? 99, "overview: instances <= 5 m outside").toBeLessThanOrEqual(5);
  expect(liveEdge?.worstVertexM ?? 99, "edge pose: mesh vertices").toBeLessThanOrEqual(5);
  expect(liveEdge?.worstInstanceM ?? 99, "edge pose: instances").toBeLessThanOrEqual(5);
  // Soft: every side is judged and reported, then the test fails if any side failed. At the A-T0
  // overview pose (7 km) the N and S extremes are off screen; A-T5 re-poses the overview.
  for (const s of Object.keys(sides) as Side[]) {
    expect.soft(extreme[s]?.onScreen, `side ${s}: extreme vertex on screen`).toBe(true);
    expect.soft(extreme[s]?.soil, `side ${s}: extreme vertex shows soil`).toBe(true);
    expect
      .soft(onShare(s), `side ${s}: >= 80% of its vertices on screen`)
      .toBeGreaterThanOrEqual(MIN_ON_SCREEN);
  }
  // AC-B10 (B-T9): the section shows >= 3 distinct soil bands somewhere at the overview (the near
  // side, where a band is several pixels tall); the slab edge follows the boundary is AC-A5 above.
  expect.soft(maxBands, "AC-B10: >= 3 soil bands seen on one vertex").toBeGreaterThanOrEqual(3);
});

/** The compass side an outline vertex's section faces, from the outline's local positions. */
function sideOf(v: { lx: number; lz: number }, ring: { lx: number; lz: number }[]): Side {
  // Outward is away from the ring's centroid (good enough for a side label on a blob outline).
  let cx = 0;
  let cz = 0;
  for (const p of ring) {
    cx += p.lx;
    cz += p.lz;
  }
  cx /= ring.length;
  cz /= ring.length;
  const ex = v.lx - cx;
  const north = -(v.lz - cz);
  if (Math.abs(north) >= Math.abs(ex)) return north >= 0 ? "N" : "S";
  return ex >= 0 ? "E" : "W";
}

/** Distinct soil bands along a sample run: luminance steps of >= 12 between runs of >= 2 samples. */
function bandsOf(lumas: number[]): number {
  if (lumas.length < 2) return lumas.length;
  let bands = 1;
  let ref = lumas[0] as number;
  let run = 0;
  for (const l of lumas) {
    if (Math.abs(l - ref) >= 12) {
      run++;
      if (run >= 2) {
        bands++;
        ref = l;
        run = 0;
      }
    } else run = 0;
  }
  return bands;
}
