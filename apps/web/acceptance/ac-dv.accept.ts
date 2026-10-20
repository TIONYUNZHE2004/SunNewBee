import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

/**
 * Development Simulation acceptance (spec 2026-10-21 section 10 and section 9): AC-H3, AC-C1, AC-C2,
 * AC-F3 and Q1-Q5, against the running `townshiplens-dev-demo` (mock + DEMO_MODE), Stylised view,
 * 1440x860. Start it first (`launch.json`), set ACCEPTANCE_BASE_URL, then:
 *   pnpm --filter @tl/web acceptance -g "AC-|Q"   (or the whole file)
 *
 * The page is driven the real way (Management tab -> the starter) and then through
 * `window.__devsim` (seek, play, pause, total, probe). A missing `__devsim` fails the run with a
 * clear message. Results: ACCEPTANCE_OUT/acceptance-<ACCEPTANCE_GATE|gate>.json (default: the
 * devsim ledger folder). Screenshots for Q3 go to DEVSIM_QA_DIR (scratch, never committed).
 */
const GATE = process.env.ACCEPTANCE_GATE ?? "gate";
const OUT =
  process.env.ACCEPTANCE_OUT ?? "C:/Users/shaoxian04/Documents/SunNewBee/.superpowers/sdd/devsim";
const SHOTS =
  process.env.DEVSIM_QA_DIR ?? "C:/Users/shaoxian04/AppData/Local/Temp/claude/devsim-qa";
const STARTER =
  "Simulate a 30-storey, 500-home tower near Lakeside Mall, from construction to daily life";
const BASELINE = [2, 7, 11, 19, 24, 30, 37, 41, 48, 54, 60, 65];
const VIEW = { width: 1440, height: 860 };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Probe {
  t: number;
  rects: {
    tower?: Rect;
    speaker?: Rect;
    bubble?: Rect;
    hypotheticalLabel?: Rect;
    simBadge?: Rect;
  };
  people: [number, number][];
  vehicles: [number, number][];
  cameraInsideBuilding: boolean;
  windowsLitFraction: number;
  fps?: number;
  /** Optional (lane request): the section 4.4 subject centre, stage-relative CSS px. */
  subject?: { name: string; x: number; y: number };
}
interface Fixture {
  probes: (Probe & {
    subject: { name: string; x: number; y: number };
    stage: { w: number; h: number };
  })[];
}
type Devsim = {
  seek(s: number): void;
  play(): void;
  pause(): void;
  total?: number;
  probe(): Probe;
};
type W = { __devsim?: Devsim };

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/devsim-prototype-probe.json"), "utf8"),
) as Fixture;

const results: Record<string, unknown> = { gate: GATE, capturedAt: new Date().toISOString() };
const consoleProblems: string[] = [];

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Rect, s: Rect) =>
  a.x >= s.x - 0.5 &&
  a.y >= s.y - 0.5 &&
  a.x + a.w <= s.x + s.w + 0.5 &&
  a.y + a.h <= s.y + s.h + 0.5;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

async function startDevsim(page: Page) {
  await page.goto("/?acceptance=1");
  await page
    .getByRole("tab", { name: /management/i })
    .or(page.getByText(/^management$/i))
    .first()
    .click();
  await page.getByText(STARTER, { exact: false }).first().click();
  try {
    await page.waitForFunction(() => !!(window as unknown as W).__devsim, null, {
      timeout: 120_000,
    });
  } catch {
    throw new Error(
      "window.__devsim is missing: the devsim product is not mounted (did the starter run, is this the Stylised view on the demo server?)",
    );
  }
  await page.evaluate(() => (window as unknown as W).__devsim?.pause());
}

const seek = (page: Page, t: number) =>
  page.evaluate((s) => {
    const d = (window as unknown as W).__devsim as Devsim;
    d.seek(s);
    return d.probe();
  }, t);

/** The 3D stage = the largest visible canvas; its page offset, so stage-relative rects map to the page. */
async function stageBox(page: Page) {
  return page.evaluate(() => {
    let best: DOMRect | null = null;
    for (const c of Array.from(document.querySelectorAll("canvas"))) {
      const r = c.getBoundingClientRect();
      if (!best || r.width * r.height > best.width * best.height) best = r;
    }
    return { x: best?.left ?? 0, y: best?.top ?? 0, w: best?.width ?? 0, h: best?.height ?? 0 };
  });
}

test.describe.configure({ mode: "serial" });

let page: Page;
let stage: Rect;
let origin: { x: number; y: number };
let sweep: Probe[] = [];

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      consoleProblems.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message.slice(0, 300)}`));
  await startDevsim(page);
  const b = await stageBox(page);
  stage = { x: 0, y: 0, w: b.w, h: b.h };
  origin = { x: b.x, y: b.y };
  const total = await page.evaluate(() => (window as unknown as W).__devsim?.total ?? 66);
  // One shared 0 -> 66 sweep in 0.25 s steps feeds AC-H3, AC-C2, Q2, Q4 and Q5.
  sweep = [];
  for (let t = 0; t <= total + 1e-9; t += 0.25) sweep.push(await seek(page, t));
});

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  results.consoleProblems = consoleProblems;
  writeFileSync(join(OUT, `acceptance-${GATE}.json`), `${JSON.stringify(results, null, 2)}\n`);
});

test("AC-H3: the hypothetical label is present whenever the tower rect meets the stage", () => {
  const bad = sweep
    .filter((p) => p.rects.tower && p.rects.tower.w > 0 && overlaps(p.rects.tower, stage))
    .filter((p) => !p.rects.hypotheticalLabel)
    .map((p) => p.t);
  results["AC-H3"] = { samples: sweep.length, missingLabelAt: bad, pass: bad.length === 0 };
  expect(bad, "times where the tower is on screen but the hypothetical label is absent").toEqual(
    [],
  );
});

test("AC-C1: the subject centre is within 10% of the stage width of the prototype", async () => {
  const rows: unknown[] = [];
  const fails: string[] = [];
  const speakers = ["halim", "farid", "meiling", "zainab", "arjun"];
  for (const t of BASELINE) {
    const p = await seek(page, t);
    const fx = fixture.probes.find((q) => q.t === t);
    if (!fx) throw new Error(`prototype fixture has no probe at t=${t}`);
    // Both sides are normalised by their own stage width.
    const want = { x: fx.subject.x / fx.stage.w, y: fx.subject.y / fx.stage.w };
    let got: { x: number; y: number } | null = null;
    let via = "";
    if (p.subject) {
      got = { x: p.subject.x / stage.w, y: p.subject.y / stage.w };
      via = `probe.subject:${p.subject.name}`;
    } else if (["tower", "site"].includes(fx.subject.name) && p.rects.tower) {
      const c = centre(p.rects.tower);
      got = { x: c.x / stage.w, y: c.y / stage.w };
      via = "tower rect";
    } else if (p.rects.speaker && speakers.includes(fx.subject.name)) {
      const c = centre(p.rects.speaker);
      got = { x: c.x / stage.w, y: c.y / stage.w };
      via = "speaker rect";
    }
    if (!got) {
      rows.push({ t, subject: fx.subject.name, status: "NOT MEASURABLE (no rect or subject)" });
      fails.push(`${t}s (${fx.subject.name}) not measurable`);
      continue;
    }
    const d = Math.hypot(got.x - want.x, got.y - want.y);
    rows.push({ t, subject: fx.subject.name, via, want, got, distStageWidths: d });
    if (d > 0.1) fails.push(`${t}s (${fx.subject.name}) ${d.toFixed(3)}`);
  }
  results["AC-C1"] = { rows, fails, pass: fails.length === 0 };
  expect(fails, "subjects farther than 10% of the stage width from the prototype").toEqual([]);
});

test("AC-C2: bubbles are inside the stage and clear of the HUD, playback bar and panel", async () => {
  const sel = {
    hud: '[data-testid="devsim-hud"], [data-testid="devsim-clock"]',
    playbackBar: '[data-testid="devsim-controls"], [data-testid="devsim-playback"]',
    panel: '[data-testid="assistant-panel"], aside',
  };
  const chrome: Record<string, Rect[]> = {};
  for (const [k, s] of Object.entries(sel))
    chrome[k] = await page.evaluate(
      ({ s, ox, oy }) =>
        Array.from(document.querySelectorAll(s))
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ x: r.left - ox, y: r.top - oy, w: r.width, h: r.height })),
      { s, ox: origin.x, oy: origin.y },
    );
  const found = Object.fromEntries(Object.entries(chrome).map(([k, v]) => [k, v.length]));
  const bad: string[] = [];
  let bubbles = 0;
  for (const p of sweep) {
    const b = p.rects.bubble;
    if (!b) continue;
    bubbles++;
    if (!inside(b, stage)) bad.push(`${p.t}: outside stage`);
    for (const [k, rs] of Object.entries(chrome))
      if (rs.some((r) => overlaps(b, r))) bad.push(`${p.t}: overlaps ${k}`);
  }
  results["AC-C2"] = {
    bubbleSamples: bubbles,
    chromeFound: found,
    bad: bad.slice(0, 20),
    pass: bad.length === 0 && bubbles > 0,
  };
  expect(bubbles, "bubble samples seen").toBeGreaterThan(0);
  expect(found.playbackBar, "playback bar found (data-testid devsim-controls)").toBeGreaterThan(0);
  expect(bad).toEqual([]);
});

/** Sim-day / sim-night in Construction (10 cycles over 4..32 s; the prototype's sun curve). */
const sunE = (t: number) => Math.sin(2 * Math.PI * ((t - 4) / 2.8 + 0.15)) + 0.25;

test("AC-F3: fast-forward flow (moving counts, day >= 2x night, density at the wide shot)", async () => {
  const movedCount = (a: Probe, b: Probe) => {
    const n = (x: [number, number][], y: [number, number][]) =>
      x.reduce(
        (c, p, i) => c + (y[i] && Math.hypot(p[0] - y[i][0], p[1] - y[i][1]) > 0.5 ? 1 : 0),
        0,
      );
    return n(a.people, b.people) + n(a.vehicles, b.vehicles);
  };
  const day: number[] = [];
  const night: number[] = [];
  for (let t = 4.5; t < 31; t += 0.5) {
    const a = await seek(page, t);
    const b = await seek(page, t + 0.5);
    const e = sunE(t + 0.25);
    const m = movedCount(a, b);
    if (e > 0.25) day.push(m);
    else if (e < -0.08) night.push(m);
  }
  const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0);
  const onScreen = (pts: [number, number][]) =>
    pts.filter(([x, y]) => x >= 0 && y >= 0 && x <= stage.w && y <= stage.h).length;
  const wide: { t: number; people: number; vehicles: number }[] = [];
  for (const t of [10.6, 11, 12, 13, 14, 15]) {
    const p = await seek(page, t);
    wide.push({ t, people: onScreen(p.people), vehicles: onScreen(p.vehicles) });
  }
  const minPeople = Math.min(...wide.map((w) => w.people));
  const minVehicles = Math.min(...wide.map((w) => w.vehicles));
  const ratio = mean(night) > 0 ? mean(day) / mean(night) : Number.POSITIVE_INFINITY;
  results["AC-F3"] = {
    meanMovingDay: mean(day),
    meanMovingNight: mean(night),
    ratio,
    wide,
    minPeople,
    minVehicles,
    pass: mean(day) > 0 && ratio >= 2 && minPeople >= 30 && minVehicles >= 20,
  };
  expect(mean(day), "something moves by day").toBeGreaterThan(0);
  expect(ratio, "moving day/night ratio").toBeGreaterThanOrEqual(2);
  expect(minPeople, "people on screen at the wide shot").toBeGreaterThanOrEqual(30);
  expect(minVehicles, "vehicles on screen at the wide shot").toBeGreaterThanOrEqual(20);
});

test("Q1: average fps >= 30 over a real-time 0 -> 66 s run", async () => {
  const total = await page.evaluate(() => (window as unknown as W).__devsim?.total ?? 66);
  await page.evaluate(() => {
    const w = window as unknown as W & { __fps: { n: number; t0: number; stop: boolean } };
    w.__fps = { n: 0, t0: performance.now(), stop: false };
    const tick = () => {
      w.__fps.n++;
      if (!w.__fps.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__devsim?.seek(0);
    w.__devsim?.play();
  });
  await page.waitForTimeout((total + 0.5) * 1000);
  const fps = await page.evaluate(() => {
    const w = window as unknown as { __fps: { n: number; t0: number; stop: boolean } };
    w.__fps.stop = true;
    return (w.__fps.n / (performance.now() - w.__fps.t0)) * 1000;
  });
  await page.evaluate(() => (window as unknown as W).__devsim?.pause());
  results.Q1 = { avgFps: fps, pass: fps >= 30 };
  expect(fps).toBeGreaterThanOrEqual(30);
});

test("Q2: the camera is never inside a building (0.25 s steps)", () => {
  const bad = sweep.filter((p) => p.cameraInsideBuilding).map((p) => p.t);
  results.Q2 = { samples: sweep.length, insideAt: bad, pass: bad.length === 0 };
  expect(bad).toEqual([]);
});

test("Q3: the speaking character stands out from its surroundings at dusk and night", async () => {
  mkdirSync(SHOTS, { recursive: true });
  const rows: unknown[] = [];
  const fails: string[] = [];
  for (const t of [11, 41, 60, 65]) {
    const p = await seek(page, t);
    await page.waitForTimeout(400);
    const png = await page.screenshot({ path: join(SHOTS, `q3-${GATE}-${t}.png`) });
    // The speaker if there is one, else the tower (the subject at the wide beats).
    const r = p.rects.speaker ?? p.rects.tower;
    if (!r) {
      rows.push({ t, status: "no speaker or tower rect" });
      fails.push(`${t}: no rect`);
      continue;
    }
    const ratio = await page.evaluate(
      async ({ b64, r, ox, oy }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d") as CanvasRenderingContext2D;
        g.drawImage(img, 0, 0);
        const x0 = Math.max(0, Math.floor(r.x + ox));
        const y0 = Math.max(0, Math.floor(r.y + oy));
        const x1 = Math.min(c.width, Math.ceil(r.x + ox + r.w));
        const y1 = Math.min(c.height, Math.ceil(r.y + oy + r.h));
        const X0 = Math.max(0, Math.floor(x0 - r.w * 0.5));
        const Y0 = Math.max(0, Math.floor(y0 - r.h * 0.5));
        const X1 = Math.min(c.width, Math.ceil(x1 + r.w * 0.5));
        const Y1 = Math.min(c.height, Math.ceil(y1 + r.h * 0.5));
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let inS = 0;
        let inN = 0;
        let ringS = 0;
        let ringN = 0;
        for (let y = Y0; y < Y1; y++)
          for (let x = X0; x < X1; x++) {
            const i = (y * c.width + x) * 4;
            const l =
              0.2126 * ((d[i] ?? 0) / 255) ** 2.2 +
              0.7152 * ((d[i + 1] ?? 0) / 255) ** 2.2 +
              0.0722 * ((d[i + 2] ?? 0) / 255) ** 2.2;
            if (x >= x0 && x < x1 && y >= y0 && y < y1) {
              inS += l;
              inN++;
            } else {
              ringS += l;
              ringN++;
            }
          }
        const a = inS / Math.max(1, inN);
        const b = ringS / Math.max(1, ringN);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      },
      { b64: png.toString("base64"), r, ox: origin.x, oy: origin.y },
    );
    rows.push({ t, rect: r, contrastRatio: ratio });
    if (ratio < 1.5) fails.push(`${t}: ${ratio.toFixed(2)}`);
  }
  results.Q3 = {
    rows,
    fails,
    pass: fails.length === 0,
    note: "luminance ring check only; the DOM 4.5:1 text-contrast half is not automated here",
  };
  expect(fails).toEqual([]);
});

test("Q4: no windows lit before t = 32", () => {
  const bad = sweep.filter((p) => p.t < 32 && p.windowsLitFraction > 0).map((p) => p.t);
  results.Q4 = { litBefore32At: bad, pass: bad.length === 0 };
  expect(bad).toEqual([]);
});

test("Q5: no console errors or warnings during the sweep", () => {
  results.Q5 = {
    count: consoleProblems.length,
    first: consoleProblems.slice(0, 10),
    pass: consoleProblems.length === 0,
  };
  expect(consoleProblems).toEqual([]);
});
