import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { JourneyPlan } from "../src/features/journey/timeline";
import { HOOK } from "./support/bookmarks";
import { DEMO_QUESTION, hasJourneyHook, journey } from "./support/journey";
import { decodePng } from "./support/scene";

/**
 * AC-D16 (the demo turn is a mock recording that DEMO_MODE replays on the loaded world) and AC-D17
 * (determinism: two runs of the demo preset give the same JourneyPlan JSON, the same camera pose at
 * every beat within 1 cm and 0.1 deg, and beat screenshots differing in < 1% of pixels).
 *
 * Run against a dev server on the Elmina seed with the mock, ideally in demo mode:
 * `DEMO_MODE=true LLM_PROVIDER=mock pnpm dev` then
 * `ACCEPTANCE_BASE_URL=http://localhost:5185 pnpm --filter @tl/web acceptance -g "AC-D16|AC-D17"`.
 * The AC-D16 replay check needs DEMO_MODE=true on that server and says so when it is off.
 *
 * Each run is a fresh page with the recording preset `?demo=1` (Stylised, High, Day, status lines
 * off, assistant open, pinned sun): ask the demo question, check the trip auto-plays (spec §6.6),
 * then pause and seek through the beats in the same order (dive end, every event hold, pull-back
 * end), reading the camera through the acceptance hook.
 */

const PROFILE = "older_adult_rest";
// Run from apps/web (pnpm --filter @tl/web acceptance), like ac-a15.
const REPO = resolve(process.cwd(), "../..");
const URL = "/?demo=1&acceptance=1";
/** Per-channel difference (0-255) that counts a pixel as changed (encoder / AA noise below it). */
const PIXEL_TOL = 24;

interface HookPhase {
  kind: string;
  t0: number;
  t1: number;
  eventIndex?: number;
}

interface Beat {
  name: string;
  t: number;
  cam: [number, number, number];
  headingDeg: number;
  pitchDeg: number;
  shot: Buffer;
}

/** demo.key() in packages/agent (sha256 of message, profile, scenario; 16 hex). */
function demoKey(message: string, profile: string, scenario = ""): string {
  const msg = message.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  return createHash("sha256")
    .update([msg, profile, scenario].join("\x1f"))
    .digest("hex")
    .slice(0, 16);
}

const frames = (page: Page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise<void>((r) => {
        let i = 0;
        const f = () => (++i >= k ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/**
 * Waits until the camera holds still (position within 1 mm for 500 ms, at most 8 s). A beat is a
 * paused time on the timeline; the journey camera (D-T5 follow rig) is a function of that time,
 * but any eased transition the scene still runs (e.g. the orbit rig's fly-to after
 * route.highlight, which runs on the wall clock) must finish before the pose is compared, or
 * the check measures how far a tween got, not the beat.
 */
async function cameraStill(page: Page, beat: string): Promise<void> {
  const still = await page.evaluate(
    (h) =>
      new Promise<boolean>((done) => {
        const api = (
          window as unknown as Record<
            string,
            { cameraLocal(): [number, number, number] } | undefined
          >
        )[h];
        if (!api) return done(true);
        const t0 = performance.now();
        let last = api.cameraLocal();
        let since = t0;
        const tick = () => {
          const now = performance.now();
          const c = api.cameraLocal();
          if (Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]) > 0.001) since = now;
          last = c;
          if (now - since >= 500) return done(true);
          if (now - t0 > 8000) return done(false);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    HOOK,
  );
  if (!still) console.log(`AC-D17 ${beat}: camera still moving after 8 s (compared anyway)`);
}

/** One run of the demo preset: load, ask, auto-play, then the beats. */
async function demoRun(page: Page): Promise<{ plan: JourneyPlan; beats: Beat[] }> {
  await page.addInitScript((p: string) => {
    try {
      localStorage.setItem("tl.profile", p);
      localStorage.setItem("tl.camera.hint", "dismissed");
    } catch {
      /* the profile check below fails loudly */
    }
  }, PROFILE);
  await page.goto(URL);
  await page.locator('[data-testid="three-scene"]').waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction((h) => h in window, HOOK, { timeout: 60_000 });
  const tips = page.getByRole("button", { name: "Dismiss camera tips" });
  if (await tips.isVisible()) await tips.click();
  // The preset opens the assistant: no "Show assistant" click.
  await page.getByRole("textbox", { name: "Your question" }).fill(DEMO_QUESTION);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByTestId("journey-sim-label").waitFor({ state: "visible", timeout: 60_000 });
  expect(await hasJourneyHook(page), "?demo=1 installs window.__journey").toBe(true);
  // §6.6: the trip plays by itself when journey.play arrives (no "Watch the trip" click).
  await page.waitForFunction(
    () => {
      const j = (
        window as unknown as { __journey?: { state(): { playing: boolean; t: number } | null } }
      ).__journey;
      const s = j?.state();
      return !!s && s.playing && s.t > 0;
    },
    null,
    { timeout: 10_000 },
  );
  await journey.pause(page);
  const plan = (await page.evaluate(
    () => (window as unknown as { __journey: { plan: unknown } }).__journey.plan,
  )) as JourneyPlan;
  const { phases } = await journey.info(page);
  const ph = phases as HookPhase[];
  const beats: { name: string; t: number }[] = [];
  const dive = ph.find((p) => p.kind === "dive");
  if (dive) beats.push({ name: "dive end", t: dive.t1 - 0.05 });
  for (const p of ph)
    if (p.kind === "event") beats.push({ name: `event ${p.eventIndex}`, t: (p.t0 + p.t1) / 2 });
  const pull = ph.find((p) => p.kind === "pull");
  if (pull) beats.push({ name: "pull end", t: pull.t1 - 0.05 });
  const out: Beat[] = [];
  for (const b of beats) {
    await journey.seek(page, b.t);
    await frames(page);
    await cameraStill(page, b.name);
    const pose = await page.evaluate((h) => {
      const api = (
        window as unknown as Record<
          string,
          | {
              cameraLocal(): [number, number, number];
              getPose(): { headingDeg: number; pitchDeg: number };
            }
          | undefined
        >
      )[h];
      if (!api) throw new Error(`${h} missing: load the map with ?acceptance=1`);
      return { cam: api.cameraLocal(), ...api.getPose() };
    }, HOOK);
    const shot = await page.screenshot();
    out.push({ ...b, cam: pose.cam, headingDeg: pose.headingDeg, pitchDeg: pose.pitchDeg, shot });
  }
  return { plan, beats: out };
}

/** One demo-cache row or SSE event (only the fields read here). */
interface Row {
  meta?: { world: string; model: string; profile: string };
  type?: string;
  model?: string;
  intent?: { kind: string; journey?: unknown };
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test.describe("demo recording (D-T10)", () => {
  test("AC-D16: the demo turn is a mock recording on Elmina that DEMO_MODE replays", async ({
    request,
  }) => {
    const key = demoKey(DEMO_QUESTION, PROFILE);
    const text: string = readFileSync(resolve(REPO, "data/demo", `${key}.jsonl`), "utf-8");
    const rows: Row[] = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Row);
    const meta = rows[0]?.meta as NonNullable<Row["meta"]>;
    expect(meta.world).toBe("elmina");
    expect(meta.model).toBe("mock-scripted");
    expect(meta.profile).toBe(PROFILE);
    const res = await request.post("/api/chat", {
      data: { message: DEMO_QUESTION, profile: PROFILE },
      timeout: 60_000,
    });
    expect(res.ok()).toBe(true);
    const events: Row[] = (await res.text())
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5)) as Row);
    const done = events.at(-1) as Row;
    expect(done.type).toBe("done");
    console.log(`AC-D16: server answered with model ${done.model}`);
    test.skip(
      !String(done.model).endsWith("+demo-cache"),
      "the server is not in DEMO_MODE (or its world is not elmina): replay not exercised",
    );
    const play = events.find((e) => e.type === "scene.intent" && e.intent?.kind === "journey.play");
    const recorded = rows.find(
      (r) => r.type === "scene.intent" && r.intent?.kind === "journey.play",
    );
    expect(play?.intent?.journey).toBeTruthy();
    expect(play?.intent?.journey).toEqual(recorded?.intent?.journey);
  });

  test("AC-D17: two runs give the same plan, camera at every beat and beat frames", async ({
    browser,
    request,
  }) => {
    test.setTimeout(20 * 60_000);
    // The plan from the API twice (POST /journeys is per request; no route store).
    const body = {
      from_id: "osm-way-909868201",
      to_id: "park-b",
      profile: PROFILE,
      start_time: "09:00",
    };
    const a = await (await request.post("/api/journeys", { data: body })).json();
    const b = await (await request.post("/api/journeys", { data: body })).json();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));

    const runs = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      runs.push(await demoRun(page));
      await ctx.close();
    }
    const [r1, r2] = runs as [
      Awaited<ReturnType<typeof demoRun>>,
      Awaited<ReturnType<typeof demoRun>>,
    ];
    expect(JSON.stringify(r2.plan)).toBe(JSON.stringify(r1.plan));
    expect(JSON.stringify(r1.plan)).toBe(JSON.stringify(a));
    expect(r2.beats.map((x) => x.name)).toEqual(r1.beats.map((x) => x.name));
    expect(r1.beats.length).toBeGreaterThan(2);

    // Decode in a scratch page (decodePng runs in the browser).
    const ctx = await browser.newContext();
    const scratch = await ctx.newPage();
    let worst = 0;
    for (let i = 0; i < r1.beats.length; i++) {
      const p = r1.beats[i] as Beat;
      const q = r2.beats[i] as Beat;
      const dPos = Math.hypot(p.cam[0] - q.cam[0], p.cam[1] - q.cam[1], p.cam[2] - q.cam[2]);
      const dHead = angleDiff(p.headingDeg, q.headingDeg);
      const dPitch = Math.abs(p.pitchDeg - q.pitchDeg);
      const i1 = await decodePng(scratch, p.shot);
      const i2 = await decodePng(scratch, q.shot);
      expect(i2.width * i2.height).toBe(i1.width * i1.height);
      let changed = 0;
      for (let k = 0; k < i1.data.length; k += 4) {
        const d = Math.max(
          Math.abs((i1.data[k] as number) - (i2.data[k] as number)),
          Math.abs((i1.data[k + 1] as number) - (i2.data[k + 1] as number)),
          Math.abs((i1.data[k + 2] as number) - (i2.data[k + 2] as number)),
        );
        if (d > PIXEL_TOL) changed++;
      }
      const share = changed / (i1.width * i1.height);
      worst = Math.max(worst, share);
      console.log(
        `AC-D17 ${p.name} t=${p.t.toFixed(2)}: dPos ${(dPos * 100).toFixed(2)} cm, dHeading ${dHead.toFixed(3)}°, dPitch ${dPitch.toFixed(3)}°, pixels ${(share * 100).toFixed(3)}%`,
      );
      expect(dPos, `${p.name} camera position`).toBeLessThanOrEqual(0.01);
      expect(dHead, `${p.name} heading`).toBeLessThanOrEqual(0.1);
      expect(dPitch, `${p.name} pitch`).toBeLessThanOrEqual(0.1);
      expect(share, `${p.name} pixels`).toBeLessThan(0.01);
    }
    console.log(`AC-D17: ${r1.beats.length} beats, worst pixel share ${(worst * 100).toFixed(3)}%`);
    await ctx.close();
  });
});
