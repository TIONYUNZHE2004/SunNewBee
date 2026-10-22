import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HOOK, openScene } from "./support/bookmarks";

/**
 * AC-W3, AC-W4, AC-W5 and the 3D side of AC-W8 (demo polish C-align) through the `bld` hook in the
 * Stylised 3D view, on the 45 s building plan (`plan.elmina.json` via the dev demo
 * `?devsim=provisional`, dev build only). Elmina seed, Medium.
 * - W3: t = 12 Raya banner, crane yaw change < 0.5 deg over 1 s, no workers or lorries, no rain;
 *   t = 21 monsoon banner, rain on, crane stopped on the wet beat.
 * - W4: rig visible 3.5-8.5 s; every drawn lorry within 3 m of `lorry_route`; scaffold top = top
 *   floor + 1 floor (+-0.5 m); netting while floors < total.
 * - W5: 27-33 s moving lorries >= 2, boxes >= 8, movers in >= 10, lit share monotonic to >= 0.85,
 *   cars parked >= 6, children at the playground >= 4 after 32.5 s.
 * - W8 (3D): each bubble's speaker is drawn and its head is on stage (an anchored bubble).
 * Run against a dev server (`LLM_PROVIDER=mock pnpm dev`, map keys blank):
 *   ACCEPTANCE_BASE_URL=http://localhost:5185 pnpm --filter @tl/web acceptance -g "AC-W345"
 * Output: ACCEPTANCE_OUT (default `<main checkout>/.superpowers/sdd/2026-10-21-demo-polish/acceptance/C-align`).
 */
function defaultOut(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return join(dirname(common), ".superpowers/sdd/2026-10-21-demo-polish/acceptance/C-align");
}
const OUT = process.env.ACCEPTANCE_OUT ?? defaultOut();

type Demo = { set(k: string): void; seek(t: number): void; pause(): void; state(): Bld };
type Bld = {
  t: number;
  overlays: string[];
  bubbles: number[];
  floorsBuilt: number;
  crane: { yaw: number; yawDeg: number; stopped: boolean; wetBeat: boolean; hold: boolean };
  rain: boolean;
  workers: number;
  lorries: { kind: string; distToRoute: number | null }[];
  lorryRoute: { drawn: boolean; points: number; mode: string };
  rig: { visible: boolean };
  scaffoldTop: number;
  topFloor: number;
  netting: boolean;
  movingLorries: number;
  boxes: number;
  parkedCars: number;
  movers: { walking: number; entered: number };
  kidsAtPlayground: number;
  kidsMaxDistM: number | null;
  litShare: number;
  speaker: { who: string; anchored: boolean; headOnStage: boolean } | null;
  castOn: string[];
};

/** Seek, then wait two frames so the layer has posed and projected (beforeRender) at t. */
const at = (page: Page, t: number): Promise<Bld> =>
  page.evaluate(async (t) => {
    const d = (window as unknown as { __tl: { demo: Demo } }).__tl.demo;
    d.set("bld");
    d.pause();
    d.seek(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => requestAnimationFrame(r));
    return d.state();
  }, t);

test("AC-W345: building set pieces, move-in and bubble speakers via the bld hook", async ({
  page,
}) => {
  test.setTimeout(6 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const gpu = await openScene(page, "day");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("tl.quality", "medium");
    } catch {}
  });
  await page.goto("/?acceptance=1&sun=pinned&devsim=provisional");
  await page.locator('[data-testid="three-scene"]').waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __tl?: { demo?: Demo } }).__tl?.demo;
      if (!d) return false;
      d.set("bld");
      return "crane" in d.state() && (d.state() as unknown as { total: number }).total === 45;
    },
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(3000);
  const out: Record<string, unknown> = { gpu, capturedAt: new Date().toISOString() };
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) fails.push(what);
  };

  // ---- AC-W3 ----
  const w3: Record<string, unknown> = {};
  const r12 = await at(page, 12);
  // pairs a full 1 s apart across the Raya hold (11-13 s): start, middle and end of the window
  const yawPairs: { t0: number; t1: number; d: number }[] = [];
  for (const t0 of [11.05, 11.5, 11.95]) {
    const a = (await at(page, t0)).crane.yawDeg;
    const b = (await at(page, t0 + 1)).crane.yawDeg;
    yawPairs.push({ t0, t1: t0 + 1, d: Math.abs(b - a) });
  }
  const maxDelta = Math.max(...yawPairs.map((p) => p.d));
  w3.t12 = {
    rayaBanner: r12.overlays.includes("banner-raya"),
    yawPairs,
    maxDeltaDegOver1s: maxDelta,
    workers: r12.workers,
    lorries: r12.lorries.length,
    rain: r12.rain,
    hold: r12.crane.hold,
  };
  check(r12.overlays.includes("banner-raya"), "W3 t=12 Raya banner");
  check(maxDelta < 0.5, "W3 crane yaw delta < 0.5 deg / 1 s");
  check(r12.workers === 0 && r12.lorries.length === 0, "W3 t=12 workers + lorries hidden");
  check(!r12.rain, "W3 t=12 no rain");
  const r21 = await at(page, 21);
  w3.t21 = {
    monsoonBanner: r21.overlays.includes("banner-monsoon"),
    rain: r21.rain,
    stopped: r21.crane.stopped,
    wetBeat: r21.crane.wetBeat,
  };
  check(r21.overlays.includes("banner-monsoon"), "W3 t=21 monsoon banner");
  check(r21.rain, "W3 t=21 rain on");
  check(r21.crane.stopped && r21.crane.wetBeat, "W3 t=21 crane stopped on the wet beat");
  out.w3 = w3;

  // ---- AC-W4 ----
  const rig: Record<string, boolean> = {};
  for (const t of [3.4, 3.6, 6, 8.4, 8.6]) rig[String(t)] = (await at(page, t)).rig.visible;
  check(!rig["3.4"] && rig["3.6"] && rig["6"] && rig["8.4"] && !rig["8.6"], "W4 rig 3.5-8.5 s");
  let lorrySeen = 0;
  let lorryMax = 0;
  const scaffold: { t: number; top: number; floor: number; netting: boolean; floors: number }[] =
    [];
  for (let t = 4; t < 27; t += 1) {
    const s = await at(page, t);
    for (const v of s.lorries) {
      lorrySeen++;
      lorryMax = Math.max(lorryMax, v.distToRoute ?? 99);
    }
    scaffold.push({
      t,
      top: s.scaffoldTop,
      floor: s.topFloor,
      netting: s.netting,
      floors: s.floorsBuilt,
    });
    if (s.topFloor > 0)
      check(Math.abs(s.scaffoldTop - (s.topFloor + 1) * 3.2) <= 0.5, `W4 scaffold top at ${t}`);
    if (s.floorsBuilt > 0 && s.floorsBuilt < 30) check(s.netting, `W4 netting at ${t}`);
    if (s.floorsBuilt >= 30) check(!s.netting, `W4 netting off once topped out at ${t}`);
  }
  check(lorrySeen > 10 && lorryMax <= 3, "W4 lorries within 3 m of the route");
  out.w4 = { rig, lorrySeen, lorryMaxDistM: lorryMax, scaffold };

  // ---- AC-W5 ----
  const w5: Bld[] = [];
  let mono = true;
  let prev = -1;
  for (let t = 27; t <= 33.001; t += 0.5) {
    const s = await at(page, t);
    w5.push(s);
    if (s.litShare < prev - 1e-9) mono = false;
    prev = s.litShare;
  }
  const s30 = await at(page, 30);
  const s31 = await at(page, 31);
  const s33 = await at(page, 33);
  const k324 = (await at(page, 32.4)).kidsAtPlayground;
  const s326 = await at(page, 32.6);
  const k326 = s326.kidsAtPlayground;
  const kidsDist = [s326.kidsMaxDistM, s33.kidsMaxDistM, (await at(page, 40)).kidsMaxDistM];
  const w5Sum = {
    movingLorries30: s30.movingLorries,
    boxes31: s31.boxes,
    boxes33: s33.boxes,
    entered33: s33.movers.entered,
    lit33: s33.litShare,
    litMonotonic: mono,
    parkedCars33: s33.parkedCars,
    kids324: k324,
    kids326: k326,
    kidsMaxDistM: kidsDist,
  };
  check(s30.movingLorries >= 2, "W5 moving lorries >= 2");
  check(s31.boxes >= 8 && s33.boxes >= 8, "W5 boxes >= 8");
  check(s33.movers.entered >= 10, "W5 movers in >= 10");
  check(mono && s33.litShare >= 0.85, "W5 lit share monotonic to >= 0.85");
  check(s33.parkedCars >= 6, "W5 cars parked >= 6");
  check(k326 >= 4, "W5 children >= 4 after 32.5 s");
  check(
    kidsDist.every((d) => d !== null && d <= 8),
    "W5 children within 8 m of the playground (32.6, 33, 40 s)",
  );
  out.w5 = w5Sum;

  // ---- AC-W8 (3D side): every bubble anchored to a drawn speaker on stage ----
  // spec §6.3 / plan.elmina.json bubble windows
  const windows: [number, string, number, number][] = [
    [1, "halim", 5.5, 9],
    [2, "farid", 14, 16.5],
    [3, "worker", 19.5, 22.5],
    [4, "meiling", 28.5, 31.5],
    [5, "halim", 31, 33],
    [6, "zainab", 34, 37],
    [7, "arjun", 36.5, 39],
  ];
  const w8: unknown[] = [];
  for (const [n, who, t0, t1] of windows)
    for (const t of [t0 + 0.05, (t0 + t1) / 2, t1 - 0.05]) {
      const s = await at(page, t);
      w8.push({ n, t, speaker: s.speaker, bubbles: s.bubbles });
      // where two bubbles overlap the first one on is the anchored speaker
      const first = s.speaker?.who;
      check(s.bubbles.includes(n), `W8 bubble ${n} on at ${t}`);
      check(
        !!s.speaker && s.speaker.anchored && s.speaker.headOnStage,
        `W8 bubble ${n} (${who}) speaker anchored at ${t} (${first})`,
      );
    }
  out.w8 = w8;
  await at(page, 21);
  await page.screenshot({ path: join(OUT, "ac-w3-21s.png") });
  await at(page, 30);
  await page.screenshot({ path: join(OUT, "ac-w5-30s.png") });
  out.fails = fails;
  writeFileSync(join(OUT, "ac-w345.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[AC-W345] ${fails.length === 0 ? "PASS" : `FAIL ${JSON.stringify(fails)}`}`);
  expect(fails).toEqual([]);
});
