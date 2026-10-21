/**
 * Demo beats through the dev/e2e hook `window.__tl.demo` (demo polish spec §5.4, §7).
 *
 * Navigation compare (B11; AC-N1, N2, N3, N5, N7, N9):
 * - Stylised 3D (SwiftShader, stubbed buildings as in three.spec.ts) with `/api/chat` stubbed to
 *   stream the recorded Elmina `route.compare` intent (`fixtures/compare-intent.json`, B6): every
 *   §5.4 row is checked by `data-beat` at its midpoint and 0.5 s outside it, the chip counter at
 *   19.3 / 19.5 s, the walkers, and the routes' box above the reasons card at ≥ 32 s.
 * - List view on the tiny world with the real mock assistant: Watch the trip shows the toast and
 *   the reasons card without 3D or a split, the Rail badge goes up by one and `/tickets` lists the
 *   compare's VR (the recorded fixture's VR does not exist in the e2e database).
 *
 * Coordinator rulings on the corridor: the kerb beat's raw time is ~10.4 s and is clamped into its
 * window (R28); there is no seating POI, so no rest beat (R29); N = 0 keeps only the toast's first
 * sentence (R30). Each beat's raw and clamped times are attached to the test report.
 */

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const intent = JSON.parse(
  readFileSync(new URL("./fixtures/compare-intent.json", import.meta.url), "utf8"),
) as {
  kind: string;
  route_id: string;
  compare: {
    from_place: { name: string };
    to_place: { name: string };
    stop: { at_m: number } | null;
    reasons: { fastest: { minutes: number }; recommended: { minutes: number; steps: number } };
    unchecked: { attribute: string; length_m: number }[];
    pois: { kind: string }[];
    confirm_n: number | null;
  };
};

// Headless Chromium no longer falls back to SwiftShader on its own (as three.spec.ts).
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
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

/** Spec §5.4 rows as beat ids and baseline windows. */
const TABLE: [string, number, number][] = [
  ["intro", 0, 3],
  ["split", 0, 31.5],
  ["tag-kerb", 3, 5.5],
  ["tag-covered", 4.5, 7],
  ["greeting", 7, 10],
  ["tag-fastest", 10, 14],
  ["tag-incline", 10.3, 13.3],
  ["tag-unchecked", 13.6, 18],
  ["tag-stop", 16.7, 31],
  ["ticket-flight", 17.6, 19.4],
  ["tickets-chip", 0, 45],
  ["ticket-toast", 19.4, 25],
  ["tag-rest", 19.5, 23],
  ["arrive", 29, 31.5],
  ["overview", 31.5, 45],
  ["reasons", 32, 45],
];
const ROUTE_TIED = [
  "tag-kerb",
  "tag-covered",
  "tag-incline",
  "tag-unchecked",
  "tag-stop",
  "ticket-flight",
  "ticket-toast", // follows the flight
  "tag-rest",
];
/** Fixed beats play exactly the table window (±0.05 s); route-tied ones within ±1.5 s. */
const FIXED_TOL_S = 0.05;
const TIED_TOL_S = 1.5;
/** Route-tied beats whose end the table fixes (the stop tag stays until 31 s). */
const FIXED_END = ["tag-stop"];
/** R28: known off-baseline on the corridor, clamped instead. */
const OFF_BASELINE = ["tag-kerb"];
/** No DOM element: a camera state read from the hook. */
const CAMERA_ONLY = ["overview"];
const T_END = 45;

type TimelineBeat = {
  id: string;
  t0: number;
  t1: number;
  raw: number | null;
  baseline: [number, number];
  /** ticket-flight only: the walker's unfloored arrival at unchecked[0].start_m (R32). */
  reach?: number;
};
type NavState = {
  key: string;
  loaded: boolean;
  t: number;
  beats: string[];
  timeline: TimelineBeat[];
  counters: { tickets: number };
  camera: "split" | "overview" | null;
  walkers: { fastest: number; recommended: number } | null;
  recommendedM: number | null;
  stopAtM: number | null;
  routesBbox: { x0: number; y0: number; x1: number; y1: number } | null;
  cardTop: number | null;
  viewports: { left: { x: number; w: number }; right: { x: number; w: number } } | null;
};

const navState = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __tl: { demo: { state: () => unknown } } }).__tl.demo;
    return d.state();
  }) as Promise<NavState>;

/** Pauses the nav playback at t and waits until the store is there. */
async function seek(page: Page, t: number) {
  await page.evaluate((s) => {
    const d = (
      window as unknown as {
        __tl: { demo: { set: (k: string) => void; pause: () => void; seek: (x: number) => void } };
      }
    ).__tl.demo;
    d.set("nav");
    d.pause();
    d.seek(s);
  }, t);
  await expect.poll(async () => (await navState(page)).t, COLD).toBeCloseTo(t, 5);
}

const beat = (page: Page, id: string) => page.locator(`[data-beat="${id}"]`);

async function openAssistant(page: Page) {
  const show = page.getByRole("button", { name: "Show assistant" });
  if (await show.isVisible()) await show.click();
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeVisible(COLD);
}

async function ask(page: Page, q: string) {
  await page.getByRole("textbox", { name: "Your question" }).fill(q);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const last = page.getByRole("log").getByRole("article").last();
  await expect(last).toHaveAttribute("data-done", "true", COLD);
  return last;
}

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

test.describe("navigation compare beats, Stylised 3D, recorded Elmina intent", () => {
  test.setTimeout(240_000);

  test("every §5.4 row by data-beat, chip counter, walkers, overview above the card (AC-N1/N2/N3/N5/N7)", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/layers/buildings", (r) => r.fulfill({ json: BUILDINGS }));
    await page.route("**/api/chat", (r) =>
      r.fulfill({
        headers: { "Content-Type": "text/event-stream" },
        body: sse([
          { type: "text.delta", delta: "Recommended route (demo values, not yet surveyed)." },
          { type: "scene.intent", intent },
          { type: "done", message_id: "m", answer_status: "answered", model: "stub" },
        ]),
      }),
    );
    await page.goto("/");
    const scene = page.getByTestId("three-scene");
    await expect(scene).toBeVisible(COLD);
    await expect
      .poll(async () => Number(await scene.getAttribute("data-frames")), COLD)
      .toBeGreaterThan(0);
    await openAssistant(page);
    const answer = await ask(page, "Wheelchair route from Elmina Lakeside Mall to Surau Kiambang?");

    // AC-N1: Watch the trip starts the compare playback (not the journey)
    await answer.getByRole("button", { name: "Watch the trip" }).click();
    await expect(page.getByTestId("compare-stage")).toBeVisible(COLD);
    await expect.poll(async () => (await navState(page)).loaded, COLD).toBe(true);
    await seek(page, 0.5);
    const st0 = await navState(page);
    expect(st0.key).toBe("nav");

    // AC-N3 (data): every §5.4 row's played window against the table, raw route times, and the
    // stated exceptions: R28 kerb raw off baseline (clamped), R29 no rest beat without a seating
    // POI, R32 flight raw floored at 17.6 s (the walker's own arrival `reach` is checked instead).
    const byId = new Map(st0.timeline.map((b) => [b.id, b]));
    const report: string[] = ["beat | baseline | raw | reach | played (clamped)"];
    for (const [id, a, b] of TABLE) {
      const x = byId.get(id);
      report.push(
        `${id} | ${a}–${b} | ${x?.raw == null ? "—" : x.raw.toFixed(2)} | ${x?.reach == null ? "—" : x.reach.toFixed(2)} | ${x ? `${x.t0.toFixed(2)}–${x.t1.toFixed(2)}` : "absent"}`,
      );
    }
    await info.attach("beat-times.txt", { body: report.join("\n"), contentType: "text/plain" });
    console.log(report.join("\n"));
    const seating = intent.compare.pois.some((p) => p.kind === "seating");
    for (const [id, a, b] of TABLE) {
      const x = byId.get(id);
      if (id === "tag-rest" && !seating) {
        expect(x, "R29: no seating POI, no rest beat").toBeUndefined();
        continue;
      }
      expect(x, id).toBeDefined();
      if (!x) continue;
      if (!ROUTE_TIED.includes(id)) {
        expect(Math.abs(x.t0 - a), `${id} t0 ${x.t0}`).toBeLessThanOrEqual(FIXED_TOL_S);
        expect(Math.abs(x.t1 - b), `${id} t1 ${x.t1}`).toBeLessThanOrEqual(FIXED_TOL_S);
        continue;
      }
      expect(Math.abs(x.t0 - a), `${id} t0 ${x.t0}`).toBeLessThanOrEqual(TIED_TOL_S + 1e-9);
      const endTol = FIXED_END.includes(id) ? FIXED_TOL_S : TIED_TOL_S + 1e-9;
      expect(Math.abs(x.t1 - b), `${id} t1 ${x.t1}`).toBeLessThanOrEqual(endTol);
      if (OFF_BASELINE.includes(id)) {
        expect(Math.abs((x.raw ?? a) - a), `R28 ${id} raw ${x.raw}`).toBeGreaterThan(TIED_TOL_S);
        expect(Math.abs(x.t0 - a), `R28 ${id} clamped`).toBeCloseTo(TIED_TOL_S, 5);
      } else {
        expect(Math.abs((x.raw ?? Number.NaN) - a), `${id} raw ${x.raw}`).toBeLessThanOrEqual(
          TIED_TOL_S,
        );
      }
      if (id === "ticket-flight") {
        // R32: the walker reaches the stretch within ±1.5 s of the unchecked tag's 13.6 s, before
        // the card flies
        expect(Math.abs((x.reach ?? Number.NaN) - 13.6), `reach ${x.reach}`).toBeLessThanOrEqual(
          TIED_TOL_S,
        );
        expect(x.reach ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(x.t0);
      }
    }

    // AC-N2: two halves of equal width, divider, pills from the payload
    await seek(page, 5);
    await expect.poll(async () => (await navState(page)).viewports !== null, COLD).toBe(true);
    const vp = (await navState(page)).viewports;
    expect(Math.abs((vp?.left.w ?? 0) - (vp?.right.w ?? -9))).toBeLessThanOrEqual(1);
    await expect(beat(page, "split-divider")).toBeAttached();
    const r = intent.compare.reasons;
    await expect(beat(page, "split-pill-fastest")).toHaveText(
      `Fastest route · ${r.fastest.minutes} min walking`,
    );
    await expect(beat(page, "split-pill-recommended")).toHaveText(
      r.recommended.steps === 0
        ? `Recommended · step-free · ${r.recommended.minutes} min`
        : `Recommended · ${r.recommended.minutes} min`,
    );
    await expect(beat(page, "intro")).toHaveCount(0); // the query chip is a 0–3 s beat
    await seek(page, 1.5);
    await expect(beat(page, "intro")).toHaveText(
      `Wheelchair · ${intent.compare.from_place.name} → ${intent.compare.to_place.name}`,
    );

    // AC-N3 (screen): each row visible at its played midpoint, hidden 0.5 s outside it
    for (const x of st0.timeline) {
      if (!TABLE.some(([id]) => id === x.id)) continue;
      const mid = (x.t0 + x.t1) / 2;
      await seek(page, mid);
      if (CAMERA_ONLY.includes(x.id)) {
        expect((await navState(page)).camera, `${x.id} @${mid}`).toBe("overview");
      } else {
        await expect(beat(page, x.id).first(), `${x.id} @${mid}`).toBeVisible(COLD);
      }
      expect((await navState(page)).beats).toContain(x.id);
      for (const t of [x.t0 - 0.5, x.t1 + 0.5]) {
        if (t < 0 || t > T_END) continue;
        await seek(page, t);
        if (CAMERA_ONLY.includes(x.id)) {
          expect((await navState(page)).camera, `${x.id} @${t}`).toBe("split");
        } else {
          await expect(beat(page, x.id), `${x.id} hidden @${t}`).toHaveCount(0);
        }
      }
    }
    if (!seating) {
      for (const t of [19.5, 21.25, 23]) {
        await seek(page, t);
        await expect(beat(page, "tag-rest")).toHaveCount(0);
      }
    }

    // AC-N5: counter 0 before 19.4 s, 1 after; the toast copy (R30: N = 0 -> first sentence only)
    await seek(page, 19.3);
    await expect(page.getByTestId("tickets-count")).toHaveText("0");
    await seek(page, 19.5);
    await expect(page.getByTestId("tickets-count")).toHaveText("1");
    const u = intent.compare.unchecked[0];
    if (u) {
      const attr = u.attribute === "incline_pct" ? "Incline" : u.attribute;
      const first = `Survey ticket queued for staff · ${attr} on ${Math.round(u.length_m)} m of the recommended path is not checked yet.`;
      await seek(page, 21);
      await expect(beat(page, "ticket-toast")).toHaveText(
        intent.compare.confirm_n
          ? `${first} Checking it would confirm ${intent.compare.confirm_n} wheelchair trips.`
          : first,
      );
    }

    // AC-N3 walkers: the recommended walker arrives at 29.0 ± 0.2 s; the fastest stops at stop.at_m
    await seek(page, 28.8);
    const before = await navState(page);
    expect(before.walkers?.recommended ?? 0).toBeLessThan(before.recommendedM ?? 0);
    await seek(page, 29.2);
    const after = await navState(page);
    expect(after.walkers?.recommended).toBeCloseTo(after.recommendedM ?? -1, 5);
    await seek(page, 30);
    const s30 = await navState(page);
    expect(Math.abs((s30.walkers?.fastest ?? 0) - (s30.stopAtM ?? 1e9))).toBeLessThanOrEqual(2);

    // AC-N7: after the merge (settled from 32 s, B8), both routes lie above the card with ≥ 24 px
    for (const t of [32.5, 33, 38]) {
      await seek(page, t);
      await expect
        .poll(async () => {
          const s = await navState(page);
          return s.routesBbox !== null && s.cardTop !== null;
        }, COLD)
        .toBe(true);
      const s = await navState(page);
      console.log(`AC-N7 @${t}s routesBbox ${JSON.stringify(s.routesBbox)} cardTop ${s.cardTop}`);
      expect(s.camera).toBe("overview");
      expect((s.routesBbox?.y1 ?? 1e9) + 24).toBeLessThanOrEqual(s.cardTop ?? -1);
      expect(s.routesBbox?.y0 ?? -1).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe("navigation compare, List view, real mock assistant (tiny world)", () => {
  // The suite's database starts empty and this spec files a ticket: a retry would see it twice.
  test.describe.configure({ retries: 0 });

  test("Watch the trip shows the toast and reasons card; the Rail badge and /tickets get the VR (AC-N1/N5/N9)", async ({
    page,
  }) => {
    await page.goto("/");
    await openAssistant(page);
    await page.getByRole("radio", { name: "Management" }).click();
    const badge = page.getByRole("link", { name: /^Tickets, \d+ open$/ });
    await expect(badge).toBeVisible(COLD);
    const count = async () =>
      Number((await badge.getAttribute("aria-label"))?.match(/(\d+) open/)?.[1] ?? Number.NaN);
    const n0 = await count();

    const chat = page.waitForResponse((r) => r.url().endsWith("/api/chat"));
    const answer = await ask(page, "Wheelchair route from Car Park B to the toilet?");
    const body = await (await chat).text();
    const vr = body
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map(
        (l) => JSON.parse(l.slice(6)) as { type: string; request_id?: string; created?: boolean },
      )
      .find((e) => e.type === "verification.requested");
    expect(vr?.request_id, "the compare files a survey ticket").toBeTruthy();
    expect(body).toContain('"kind":"route.compare"');

    // AC-N1 + AC-N9: the compare loads; the List view shows the toast and reasons, no 3D, no split
    await answer.getByRole("button", { name: "Watch the trip" }).click();
    const list = page.getByTestId("compare-list");
    await expect(list).toBeVisible(COLD);
    await expect.poll(async () => (await navState(page)).loaded).toBe(true);
    await expect(list.locator('[data-beat="ticket-toast"]')).toContainText(
      "Survey ticket queued for staff · Incline on",
    );
    const reasons = list.locator('[data-beat="reasons"]');
    await expect(reasons).toContainText("Steps");
    await expect(reasons).toContainText("Rest stop on the way");
    await expect(reasons).toContainText("Reasons use checked facts only.");
    await expect(page.getByTestId("three-scene")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(beat(page, "split")).toHaveCount(0);

    // AC-N5: the Rail open-ticket badge goes up by one, and /tickets lists the VR
    if (vr?.created) {
      await expect.poll(count, COLD).toBe(n0 + 1);
    } else {
      // an existing ticket was upvoted, so the open count does not change
      const note = `Rail badge +1 check skipped: ${vr?.request_id} was not newly created`;
      test.info().annotations.push({ type: "skipped-check", description: note });
      console.log(note);
    }
    const rows = (await (await page.request.get("/api/verification-requests")).json()) as {
      id: string;
    }[];
    expect(rows.map((x) => x.id)).toContain(vr?.request_id);
    await badge.click();
    await expect(page.getByRole("heading", { name: "Gaps to close" })).toBeVisible(COLD);
    await expect(
      page.getByRole("region", { name: "Ticket list" }).getByRole("button", { name: /Incline/ }),
    ).toBeVisible(COLD);
  });
});
