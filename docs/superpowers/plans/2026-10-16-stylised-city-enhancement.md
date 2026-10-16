# Stylised City Enhancement Implementation Plan (Project 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the stylised Cesium city look like a lit low-poly diorama in Day, Dusk and Night, follow the Malaysian clock (with manual override), open close in with friendly 3D mouse/touch/keyboard controls, and add gentle decorative motion, at a GPU cost the quality tiers keep in check.

**Architecture:** Everything stays inside the existing Cesium viewer and the `apps/web/src/features/scene/cesium/stylised/` renderer (spec Approach 1). Pure, unit-tested modules hold all maths (theme clock, camera maths, mesh building, dash/offset geometry, colour, tiers, flock paths); thin Cesium adapters apply them. The palette becomes the single source of every mood-dependent value, so a theme change (and the 2 s crossfade) is "compute a palette, push it into every layer".

**Tech Stack:** React 19, zustand, Cesium 1.146 / Resium 1.27, Vite 8, Tailwind 4, vitest 5 (node by default, `// @vitest-environment jsdom` for DOM tests), Playwright 1.64, Python 3.13 + FastAPI 0.143 (one small API addition), uv.

**Spec:** `docs/superpowers/specs/2026-10-16-stylised-city-enhancement-design.md`

## Global Constraints

- Display only: nothing added here is read by routing, evaluation, flood or answers. Decorative primitives use `allowPicking: false`.
- No moving cars; no balloon, bridge, boats or shop names; parked cars stay parked.
- Decorative water stays visibly distinct from the flood-scenario `WATER_COLOR` (`features/scene/styles.ts`) in every mood; shimmer only on base water.
- Heights still come only from OSM tags or deterministic defaults; never from Google tiles.
- The label "Decorative details are illustrative." stays in Map settings for the stylised style.
- Theme clock uses `Asia/Kuala_Lumpur`: Day 07:00–18:00, Dusk 18:00–19:30, Night 19:30–07:00 (start inclusive).
- Camera limits: zoom 30 m – 20 000 m; pitch ≤ −5°; centre within 5 km of `site.bbox`.
- Stylised home: range 1200 m, pitch −35°, vertical FOV 30°. Realistic keeps 6000 m, −45°, 60°.
- Motion loop: ≤ 30 renders/s, zero when hidden, off-screen, disabled or `prefers-reduced-motion`.
- Draw calls for the whole stylised scene < ~60 (merged buildings per class, one instanced primitive per prop colour).
- `requestRenderMode` stays on: every scene change calls `viewer.scene.requestRender()`.
- Dependencies: no new runtime dependency. Only MIT / Apache-2.0 / BSD; exact pins.
- Commits: Conventional with scope (`feat(web): …`, `feat(api): …`, `data: …`, `docs: …`), explicit paths in `git add`, never `git commit -am`. Data regeneration is a separate `data:` commit. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ
  ```
- Cost: default `LLM_PROVIDER=mock`; visual checks use the Stylised style only (no Google tile loads).
- Done = the CI checklist from AGENTS.md passes (`pnpm lint`, `uv run pytest -q`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm gen && git diff --exit-code packages/api-client`, `pnpm golden`, `pnpm --filter @tl/web e2e`), run with `set -o pipefail`, each reported PASS / FAIL / BLOCKED / NOT RUN.

## Review Focus

1. **Theme stored by an older build** (`localStorage tl.theme = "night"`) must load as a manual Night choice, not crash or silently become Auto. Pinned in Task 1.
2. **Typing in the chat box while the map has been clicked before** (W, A, +, arrows) must never move the camera. Pinned in Task 6 (keys handled only by the map section's own `onKeyDown`).
3. **A tab left in the background over the 18:00 boundary**: the theme must be right when the user returns, with no burst of queued renders. Pinned in Task 1 (timer re-evaluates from `new Date()`, not by counting ticks) and Task 14 (loop paused while hidden).
4. **A theme change while buildings / ground are still being built** (primitives not ready) must end on the latest palette. Pinned in Task 9 (crossfade cancels and restarts; ground keeps "wanted" palette until ready).
5. **The camera dragged to a limit** (far outside Elmina, or tilted to the horizon) must stop there and stay usable, and "Home view" must always recover. Pinned in Task 4 (clamp maths) and Task 5 (per-frame clamp listener test).

---

## File map

| File | Responsibility |
|---|---|
| `apps/web/src/ui/theme.ts` | `Theme`, `ThemeChoice`, `themeAt`, `skinFor`, theme store, clock timer |
| `apps/web/src/ui/ThemeMenu.tsx` (replaces `ThemeToggle.tsx`) | header Auto/Day/Dusk/Night menu |
| `apps/web/src/features/scene/cesium/stylised/palette.ts` | all mood values (colours, light, glow, sky, flags) and `lerpPalette` |
| `apps/web/src/features/scene/cesium/stylised/colour.ts` | hex ↔ rgb/lab, `mixHex`, `deltaE` |
| `apps/web/src/features/scene/cesium/stylised/lighting.ts` | shared GLSL (`tl_light`, `tl_fog`, cloud shadow) + uniforms builder + `litColorMaterial` |
| `apps/web/src/features/scene/cesium/stylised/postfx.ts` | AO, bloom, FXAA, shadows per palette and tier |
| `apps/web/src/features/scene/cesium/stylised/crossfade.ts` | 2 s palette fade driver |
| `apps/web/src/features/scene/cesium/stylised/lines.ts` | `offsetLine`, `dashSegments` (pure) |
| `apps/web/src/features/scene/cesium/stylised/roofs.ts` | seeded roof clutter placement (pure) |
| `apps/web/src/features/scene/cesium/stylised/motion/clock.ts` | the single animation loop |
| `apps/web/src/features/scene/cesium/stylised/motion/flocks.ts` | bird/cloud paths (pure) |
| `apps/web/src/features/scene/cesium/stylised/motion/sky.ts` | birds + clouds primitives |
| `apps/web/src/features/scene/cesium/stylised/quality.ts` | tiers, tier pick, frame monitor (pure) |
| `apps/web/src/features/scene/cesium/controls/cameraMath.ts` | pure camera maths and key map |
| `apps/web/src/features/scene/cesium/controls/cameraOps.ts` | camera actions on a Cesium viewer |
| `apps/web/src/features/scene/cesium/controls/configureControls.ts` | mouse/touch mapping, limits, double-click, shift-wheel |
| `apps/web/src/features/scene/cesium/controls/CameraControls.tsx` | compass + slide-out cluster + hint |
| `apps/web/src/features/scene/cesium/controls/cameraUiStore.ts` | always-show, hint dismissed |
| `apps/web/src/features/scene/sceneSettingsStore.ts` | Motion on/off, Quality choice (persisted) |
| `apps/web/src/features/scene/cesium/PerfOverlay.tsx` | `?perf=1` overlay |
| `data/scripts/build_buildings.py` | `--parks` mode writing `base/parks.geojson` |
| `apps/api/src/townshiplens_api/routes/core.py` | `parks` in `BuildingsLayer` |

Existing files modified along the way: `main.tsx`, `index.css`, `Shell.tsx`, `SettingsPopover.tsx`, `CesiumScene.tsx`, `camera.ts`, `home.ts`, `timeOfDay.ts`, `MapboxLite.tsx`, `StylisedCity.tsx`, `StylisedPreview.tsx`, `buildingsMesh.ts`, `buildingsPrimitive.ts`, `model.ts`, `ground.ts`, `props.ts`, `reskin.ts`, `lib/api.ts`, `apps/web/README.md`, `data/README.md`.

---

# Phase 1: theme and clock; camera and controls

### Task 1: Three-mood theme model and Malaysian clock

**Files:**
- Modify: `apps/web/src/ui/theme.ts` (rewrite)
- Modify: `apps/web/src/ui/theme.test.ts` (rewrite)
- Modify: `apps/web/src/main.tsx:6-10`

**Interfaces:**
- Produces:
  - `type Theme = "day" | "dusk" | "night"`
  - `type ThemeChoice = "auto" | Theme`
  - `type Skin = "light" | "dark"`
  - `themeAt(d: Date): Theme`
  - `skinFor(t: Theme): Skin`
  - `loadChoice(store?): ThemeChoice`
  - `applyTheme(t: Theme, el?: HTMLElement): void` (sets `data-theme` and `data-skin`)
  - `useTheme`: zustand store `{ choice: ThemeChoice; theme: Theme; setChoice(c: ThemeChoice): void; refresh(now?: Date): void }`
  - `startThemeClock(intervalMs = 60_000): () => void`

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/ui/theme.test.ts` with:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, loadChoice, skinFor, startThemeClock, themeAt, useTheme } from "./theme";

// Kuala Lumpur is UTC+8 all year (no DST): 07:00 KL = 23:00 UTC the previous day.
const kl = (h: number, m: number) => new Date(Date.UTC(2026, 9, 16, h - 8, m));

describe("themeAt (Asia/Kuala_Lumpur, independent of the machine timezone)", () => {
  it.each([
    [6, 59, "night"],
    [7, 0, "day"],
    [17, 59, "day"],
    [18, 0, "dusk"],
    [19, 29, "dusk"],
    [19, 30, "night"],
    [0, 0, "night"],
  ] as const)("%i:%i KL is %s", (h, m, want) => {
    expect(themeAt(kl(h, m))).toBe(want);
  });
});

describe("skinFor", () => {
  it("day and dusk share the light chrome, night is dark", () => {
    expect(skinFor("day")).toBe("light");
    expect(skinFor("dusk")).toBe("light");
    expect(skinFor("night")).toBe("dark");
  });
});

describe("loadChoice", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to auto", () => expect(loadChoice(localStorage)).toBe("auto"));
  it.each(["auto", "day", "dusk", "night"])("keeps a stored %s", (v) => {
    localStorage.setItem("tl.theme", v);
    expect(loadChoice(localStorage)).toBe(v);
  });
  it("ignores junk", () => {
    localStorage.setItem("tl.theme", "purple");
    expect(loadChoice(localStorage)).toBe("auto");
  });
  it("survives storage throwing (private window)", () => {
    const bad = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadChoice(bad)).toBe("auto");
  });
});

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("applyTheme sets data-theme and data-skin", () => {
    applyTheme("dusk");
    expect(document.documentElement.dataset.theme).toBe("dusk");
    expect(document.documentElement.dataset.skin).toBe("light");
  });

  it("a manual choice is shown and persisted", () => {
    useTheme.getState().setChoice("night");
    expect(useTheme.getState().theme).toBe("night");
    expect(localStorage.getItem("tl.theme")).toBe("night");
    expect(document.documentElement.dataset.skin).toBe("dark");
  });

  it("auto follows the clock and switches live at 18:00", () => {
    vi.setSystemTime(kl(17, 59));
    useTheme.getState().setChoice("auto");
    expect(useTheme.getState().theme).toBe("day");
    const stop = startThemeClock(60_000);
    vi.setSystemTime(kl(18, 0));
    vi.advanceTimersByTime(60_000);
    expect(useTheme.getState().theme).toBe("dusk");
    stop();
  });

  it("the clock never overrides a manual choice", () => {
    vi.setSystemTime(kl(12, 0));
    useTheme.getState().setChoice("night");
    const stop = startThemeClock(60_000);
    vi.advanceTimersByTime(60_000);
    expect(useTheme.getState().theme).toBe("night");
    stop();
  });

  it("setChoice tolerates setItem throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => useTheme.getState().setChoice("day")).not.toThrow();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/ui/theme.test.ts`
Expected: FAIL (`themeAt`, `skinFor`, `loadChoice`, `startThemeClock` are not exported).

- [ ] **Step 3: Implement**

Replace `apps/web/src/ui/theme.ts` with:

```ts
import { create } from "zustand";

/** The look actually shown (3D map mood). */
export type Theme = "day" | "dusk" | "night";
/** What the user picked: Auto follows the Elmina clock. */
export type ThemeChoice = "auto" | Theme;
/** UI chrome: Day and Dusk share the light chrome; they differ only in the 3D map. */
export type Skin = "light" | "dark";

const KEY = "tl.theme";
const CHOICES: readonly ThemeChoice[] = ["auto", "day", "dusk", "night"];

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const KL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Elmina wall-clock mood: Day 07:00-18:00, Dusk 18:00-19:30, Night 19:30-07:00. Display only. */
export function themeAt(d: Date): Theme {
  const parts = KL.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = h * 60 + m;
  if (mins >= 7 * 60 && mins < 18 * 60) return "day";
  if (mins >= 18 * 60 && mins < 19 * 60 + 30) return "dusk";
  return "night";
}

export const skinFor = (t: Theme): Skin => (t === "night" ? "dark" : "light");

/** Stored choice (legacy "day"/"night" included), else Auto. Never throws. */
export function loadChoice(store: Store | undefined = browserStore()): ThemeChoice {
  try {
    const v = store?.getItem(KEY);
    if (v && (CHOICES as readonly string[]).includes(v)) return v as ThemeChoice;
  } catch {
    /* storage unavailable */
  }
  return "auto";
}

const resolve = (c: ThemeChoice, now: Date): Theme => (c === "auto" ? themeAt(now) : c);

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
  el.dataset.skin = skinFor(t);
}

interface ThemeState {
  choice: ThemeChoice;
  theme: Theme;
  setChoice: (c: ThemeChoice) => void;
  /** Re-evaluate Auto against the clock (called by the clock timer). */
  refresh: (now?: Date) => void;
}

const initialChoice = loadChoice();

export const useTheme = create<ThemeState>((set, get) => ({
  choice: initialChoice,
  theme: resolve(initialChoice, new Date()),
  setChoice: (choice) => {
    try {
      browserStore()?.setItem(KEY, choice);
    } catch {
      /* per-viewer convenience only */
    }
    const theme = resolve(choice, new Date());
    if (typeof document !== "undefined") applyTheme(theme);
    set({ choice, theme });
  },
  refresh: (now = new Date()) => {
    const { choice, theme } = get();
    const next = resolve(choice, now);
    if (next === theme) return;
    if (typeof document !== "undefined") applyTheme(next);
    set({ theme: next });
  },
}));

/** Re-checks Auto every `intervalMs` from the real clock (a backgrounded tab is right on return). */
export function startThemeClock(intervalMs = 60_000): () => void {
  const id = setInterval(() => useTheme.getState().refresh(new Date()), intervalMs);
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible")
      useTheme.getState().refresh(new Date());
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisible);
  };
}
```

In `apps/web/src/main.tsx` replace the theme lines (currently `import { applyTheme, useTheme } from "./ui/theme";` and `applyTheme(useTheme.getState().theme);`) with:

```ts
import { applyTheme, startThemeClock, useTheme } from "./ui/theme";
// …
applyTheme(useTheme.getState().theme);
startThemeClock();
```

- [ ] **Step 4: Make the rest of the app compile**

`toggle` and `setTheme` no longer exist. Fix their three users with the smallest change (Task 3 redesigns the UI):
- `apps/web/src/ui/ThemeToggle.tsx`: replace the body with `const { theme, setChoice } = useTheme(); const next = theme === "night" ? "day" : "night";` and `onClick={() => setChoice(next)}`.
- `apps/web/src/features/map-ui/SettingsPopover.tsx:84,144-149`: `const { theme, setChoice } = useTheme();` and `onClick={() => setChoice("day")}` / `setChoice("night")`.
- `apps/web/src/features/scene/cesium/stylised/StylisedPreview.tsx:133`: `const setChoice = useTheme((s) => s.setChoice);` and the button calls `setChoice(theme === "night" ? "day" : "night")`.

Run: `pnpm --filter @tl/web typecheck`
Expected: errors only where a `Record<Theme, …>` lacks `dusk` (`timeOfDay.ts STYLES`, `buildingsPrimitive.ts LIT_FRACTION`) and in `mapboxLightPreset`. Add the minimal `dusk` entries now (copy the `day` values) so the build is green; Task 2 gives them real values.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tl/web exec vitest run src/ui/theme.test.ts`
Expected: PASS. Then `pnpm --filter @tl/web exec vitest run`, expected: PASS (fix any test that called `toggle`/`setTheme` to use `setChoice`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/theme.ts apps/web/src/ui/theme.test.ts apps/web/src/main.tsx apps/web/src/ui/ThemeToggle.tsx apps/web/src/features/map-ui/SettingsPopover.tsx apps/web/src/features/scene/cesium/stylised/StylisedPreview.tsx apps/web/src/features/scene/cesium/timeOfDay.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts
git commit -m "feat(web): three-mood theme that follows the Elmina clock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 2: Dusk through every renderer, and the two chrome skins in CSS

**Files:**
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts:37-38,96-114`
- Modify: `apps/web/src/features/scene/cesium/timeOfDay.ts:11-25`
- Modify: `apps/web/src/features/scene/cesium/timeOfDay.test.ts`
- Modify: `apps/web/src/features/scene/mapbox/MapboxLite.tsx` (where `mapboxLightPreset` is used)
- Modify: `apps/web/src/index.css:3-44`

**Interfaces:**
- Consumes: `Theme` from Task 1.
- Produces: `paletteFor(t: Theme): Palette` with a `dusk` palette; `Palette` gains `glow: number` and `litFrac: number`; `mapboxLightPreset(t): "day" | "dusk" | "night"`; CSS tokens keyed by `:root[data-skin="light"|"dark"]`.

- [ ] **Step 1: Write the failing tests**

In `palette.test.ts`, add `const dusk = paletteFor("dusk");`, change both `for (const p of [day, night])` loops to `[day, dusk, night]`, and add:

```ts
  it("dusk is between day and night: warmer sky than day, brighter than night", () => {
    expect(lum(dusk.sky)).toBeLessThan(lum(day.sky));
    expect(lum(dusk.sky)).toBeGreaterThan(lum(night.sky));
  });
  it("window glow and lit share rise from day to night", () => {
    expect(day.glow).toBe(0);
    expect(dusk.glow).toBeGreaterThan(0);
    expect(night.glow).toBe(1);
    expect(day.litFrac).toBeLessThan(dusk.litFrac);
    expect(dusk.litFrac).toBeLessThan(night.litFrac);
  });
```

In `timeOfDay.test.ts` add:

```ts
  it("has a dusk style and maps dusk to the Mapbox dusk preset", () => {
    expect(cesiumTimeStyle("dusk").skyColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mapboxLightPreset("dusk")).toBe("dusk");
    expect(mapboxLightPreset("day")).toBe("day");
    expect(mapboxLightPreset("night")).toBe("night");
  });
```

(Import `mapboxLightPreset` in that test file if it is not imported yet.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/palette.test.ts src/features/scene/cesium/timeOfDay.test.ts`
Expected: FAIL (no dusk palette, no `glow`, preset returns `"night"` for dusk).

- [ ] **Step 3: Implement**

In `palette.ts`:
- Add `glow: number;` (window emission 0 to 1) and `litFrac: number;` (share of lit windows) to `interface Palette`.
- Add `glow: 1, litFrac: 0.58` to NIGHT and `glow: 0, litFrac: 0.35` to DAY.
- Add a DUSK palette and replace `paletteFor`:

```ts
const DUSK: Palette = {
  ground: "#d9b9b4",
  road: "#7d6a92",
  water: "#5f8f93",
  sky: "#c98aa6",
  fog: 0.0003,
  tree: ["#4f9a7a", "#2f7466"],
  trunk: "#6a4a55",
  car: ["#e0686a", "#5a8fd9", "#f4f1ea"],
  wall: { warm: "#e3b49a", cool: "#a99ad6", rose: "#e7a2b4" },
  roof: { warm: "#b4745e", cool: "#7f70b8", rose: "#cc6c86" },
  windowLit: ["#ffd08a", "#fff0dc"],
  windowDark: "#3d2f6b",
  sun: { dir: [0.75, -0.2, -0.3], color: "#ffb38a", intensity: 1.4 },
  ambient: 0.6,
  glow: 0.6,
  litFrac: 0.45,
};

const PALETTES: Record<Theme, Palette> = { day: DAY, dusk: DUSK, night: NIGHT };
export const paletteFor = (t: Theme): Palette => PALETTES[t] ?? NIGHT;
```

In `buildingsPrimitive.ts`, delete `LIT_FRACTION` and in `uniformsFor` use `litFrac: palette.litFrac` and `glow: palette.glow` (drop the `theme` parameter from `uniformsFor`, and update its two callers).

In `timeOfDay.ts`, add to `STYLES`:

```ts
  dusk: {
    skyColor: "#c98aa6",
    globeBase: "#4a4a5a",
    tileBrightness: 0.75,
    fogDensity: 0.0002,
    hue: 0,
  },
```

and replace `mapboxLightPreset`:

```ts
export const mapboxLightPreset = (t: Theme): "day" | "dusk" | "night" => t;
```

In `MapboxLite.tsx`, make sure the value is passed through unchanged to the Mapbox Standard `lightPreset` config (it accepts `"dawn" | "day" | "dusk" | "night"`). Update any local type annotation from `"day" | "night"` to `"day" | "dusk" | "night"`.

In `index.css`, change the selectors only (values unchanged here; Project 4 restyles them):
- `:root, :root[data-theme="night"]` becomes `:root, :root[data-skin="dark"]`.
- `:root[data-theme="day"]` becomes `:root[data-skin="light"]`.

Update the comment above them to: `/* Dark chrome is the default (Night). Light chrome (Day and Dusk) swaps the same semantic variables. */`

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tl/web exec vitest run`
Expected: PASS. If `apps/web/src/ui/theme.test.ts` or a Shell test asserted `data-theme` drives CSS, it still passes (the attribute is still set).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/palette.ts apps/web/src/features/scene/cesium/stylised/palette.test.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/timeOfDay.ts apps/web/src/features/scene/cesium/timeOfDay.test.ts apps/web/src/features/scene/mapbox/MapboxLite.tsx apps/web/src/index.css
git commit -m "feat(web): dusk mood in every renderer and skin-keyed chrome tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 3: Theme menu (header and Map settings)

**Files:**
- Create: `apps/web/src/ui/ThemeMenu.tsx`
- Create: `apps/web/src/ui/ThemeMenu.dom.test.tsx`
- Delete: `apps/web/src/ui/ThemeToggle.tsx`
- Modify: `apps/web/src/app/Shell.tsx:4,94`
- Modify: `apps/web/src/features/map-ui/SettingsPopover.tsx:141-151`
- Modify: `apps/web/src/features/map-ui/SettingsPopover.dom.test.tsx` (theme radios)

**Interfaces:**
- Consumes: `useTheme` `{ choice, theme, setChoice }` (Task 1).
- Produces: `<ThemeMenu />` (button `aria-haspopup="menu"`, accessible name `Theme: <Auto (Day)|Day|Dusk|Night>`; menu of `menuitemradio`s).

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/ThemeMenu.dom.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeMenu } from "./ThemeMenu";
import { useTheme } from "./theme";

describe("ThemeMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    useTheme.getState().setChoice("auto");
  });

  it("names the current choice and opens a menu of four options", () => {
    render(<ThemeMenu />);
    const btn = screen.getByRole("button", { name: /^Theme: Auto/ });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Auto", "Day", "Dusk", "Night"]);
    expect(screen.getByRole("menuitemradio", { name: "Auto" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("picking Dusk sets the choice and closes the menu", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dusk" }));
    expect(useTheme.getState().choice).toBe("dusk");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: Dusk" })).toBeInTheDocument();
  });

  it("Escape closes and returns focus to the button", () => {
    render(<ThemeMenu />);
    const btn = screen.getByRole("button", { name: /^Theme:/ });
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @tl/web exec vitest run src/ui/ThemeMenu.dom.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/src/ui/ThemeMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { type Theme, type ThemeChoice, useTheme } from "./theme";

const LABEL: Record<ThemeChoice, string> = { auto: "Auto", day: "Day", dusk: "Dusk", night: "Night" };
const ICON: Record<Theme, string> = { day: "☀", dusk: "◐", night: "☾" };
const ORDER: ThemeChoice[] = ["auto", "day", "dusk", "night"];

export function ThemeMenu() {
  const { choice, theme, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const name = choice === "auto" ? `Theme: Auto (${LABEL[theme]})` : `Theme: ${LABEL[choice]}`;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-11 items-center justify-center rounded-full border border-edge text-fg hover:bg-fg/10"
      >
        <span aria-hidden="true">{ICON[theme]}</span>
        {choice === "auto" && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[0.6rem] font-bold text-on-accent"
          >
            A
          </span>
        )}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-30 mt-2 w-40 rounded-xl border border-edge bg-surface p-1 shadow-lg"
        >
          {ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={choice === c}
              onClick={() => {
                setChoice(c);
                setOpen(false);
                btn.current?.focus();
              }}
              className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm ${
                choice === c ? "bg-accent text-on-accent" : "text-fg hover:bg-fg/10"
              }`}
            >
              {LABEL[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

`Shell.tsx`: replace the `ThemeToggle` import and usage with `ThemeMenu`. Delete `apps/web/src/ui/ThemeToggle.tsx`; `grep -rn ThemeToggle apps/web/src` must then return nothing (update any test that imported it to use `ThemeMenu`).

`SettingsPopover.tsx`: replace the Theme section with four radios:

```tsx
          <div>
            <h3 className={H}>Theme</h3>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
              {(["auto", "day", "dusk", "night"] as const).map((c) => (
                <Radio key={c} checked={choice === c} onClick={() => setChoice(c)}>
                  {c === "auto" ? "Auto (clock)" : c[0]!.toUpperCase() + c.slice(1)}
                </Radio>
              ))}
            </div>
          </div>
```

with `const { choice, setChoice } = useTheme();` at the top of `SettingsPopover`. In `SettingsPopover.dom.test.tsx`, update the theme assertions to the four names `Auto (clock)`, `Day`, `Dusk`, `Night`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tl/web exec vitest run`
Expected: PASS. Then `pnpm lint`, expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/ThemeMenu.tsx apps/web/src/ui/ThemeMenu.dom.test.tsx apps/web/src/app/Shell.tsx apps/web/src/features/map-ui/SettingsPopover.tsx apps/web/src/features/map-ui/SettingsPopover.dom.test.tsx
git rm apps/web/src/ui/ThemeToggle.tsx
git commit -m "feat(web): Auto / Day / Dusk / Night theme menu" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 4: Pure camera maths and the key map

**Files:**
- Create: `apps/web/src/features/scene/cesium/controls/cameraMath.ts`
- Create: `apps/web/src/features/scene/cesium/controls/cameraMath.test.ts`

**Interfaces:**
- Produces:
  - `LIMITS = { minRangeM: 30, maxRangeM: 20_000, maxPitchRad: -5° in rad, minPitchRad: -90° in rad, boundsMarginM: 5000 }`
  - `type Hpr = { heading: number; pitch: number; range: number }`
  - `orbitStep(h: Hpr, dHeading: number, dPitch: number, zoomFactor?: number): Hpr`
  - `clampPitch(p: number): number`
  - `moveVector(headingRad: number, right: number, forward: number): [east: number, north: number]`
  - `clampToBounds(lon: number, lat: number, bbox: [w, s, e, n], marginM): [lon, lat]`
  - `type KeyAction = { kind: "move"; right: number; forward: number } | { kind: "orbit"; dHeading: number; dPitch: number } | { kind: "zoom"; factor: number }`
  - `keyAction(key: string): KeyAction | null`
  - `STEP = { orbitRad: 15° in rad, tiltRad: 7.5° in rad, zoomIn: 0.7, zoomOut: 1 / 0.7, moveShare: 0.25 }`

- [ ] **Step 1: Write the failing tests**

`cameraMath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampPitch,
  clampToBounds,
  keyAction,
  LIMITS,
  moveVector,
  orbitStep,
  STEP,
} from "./cameraMath";

const deg = (d: number) => (d * Math.PI) / 180;

describe("clampPitch", () => {
  it("never tilts closer than 5 degrees to the horizon, nor past straight down", () => {
    expect(clampPitch(deg(10))).toBeCloseTo(LIMITS.maxPitchRad);
    expect(clampPitch(deg(-3))).toBeCloseTo(LIMITS.maxPitchRad);
    expect(clampPitch(deg(-40))).toBeCloseTo(deg(-40));
    expect(clampPitch(deg(-120))).toBeCloseTo(deg(-90));
  });
});

describe("orbitStep", () => {
  it("adds heading (wrapped to 0..2pi) and pitch, clamps pitch and range", () => {
    const h = { heading: deg(350), pitch: deg(-35), range: 1200 };
    const r = orbitStep(h, deg(20), deg(-10));
    expect(r.heading).toBeCloseTo(deg(10));
    expect(r.pitch).toBeCloseTo(deg(-45));
    expect(r.range).toBe(1200);
    expect(orbitStep(h, 0, deg(60)).pitch).toBeCloseTo(LIMITS.maxPitchRad);
    expect(orbitStep(h, 0, 0, 1e-6).range).toBe(LIMITS.minRangeM);
    expect(orbitStep(h, 0, 0, 1e6).range).toBe(LIMITS.maxRangeM);
  });
});

describe("moveVector", () => {
  it("forward follows the heading, right is 90 degrees clockwise of it", () => {
    const [e1, n1] = moveVector(0, 0, 10); // facing north
    expect(e1).toBeCloseTo(0);
    expect(n1).toBeCloseTo(10);
    const [e2, n2] = moveVector(deg(90), 0, 10); // facing east
    expect(e2).toBeCloseTo(10);
    expect(n2).toBeCloseTo(0);
    const [e3, n3] = moveVector(0, 10, 0); // right while facing north = east
    expect(e3).toBeCloseTo(10);
    expect(n3).toBeCloseTo(0);
  });
});

describe("clampToBounds", () => {
  const bbox: [number, number, number, number] = [101.46, 3.15, 101.53, 3.24];
  it("keeps points inside the bbox plus margin", () => {
    expect(clampToBounds(101.5, 3.2, bbox, 5000)).toEqual([101.5, 3.2]);
    const [lon, lat] = clampToBounds(102.5, 2.0, bbox, 5000);
    expect(lon).toBeCloseTo(101.53 + 5000 / (111_320 * Math.cos(deg(3.195))), 4);
    expect(lat).toBeCloseTo(3.15 - 5000 / 111_320, 4);
  });
});

describe("keyAction", () => {
  it("maps WASD/arrows, Q/E, R/F and +/-", () => {
    expect(keyAction("w")).toEqual({ kind: "move", right: 0, forward: 1 });
    expect(keyAction("ArrowLeft")).toEqual({ kind: "move", right: -1, forward: 0 });
    expect(keyAction("q")).toEqual({ kind: "orbit", dHeading: -STEP.orbitRad, dPitch: 0 });
    expect(keyAction("R")).toEqual({ kind: "orbit", dHeading: 0, dPitch: STEP.tiltRad });
    expect(keyAction("+")).toEqual({ kind: "zoom", factor: STEP.zoomIn });
    expect(keyAction("-")).toEqual({ kind: "zoom", factor: STEP.zoomOut });
    expect(keyAction("Enter")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/controls/cameraMath.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`cameraMath.ts`:

```ts
/** Pure camera maths for the stylised/realistic 3D map (no Cesium import; unit-tested). */
const RAD = Math.PI / 180;
const M_PER_DEG = 111_320;
const TAU = Math.PI * 2;

export const LIMITS = {
  minRangeM: 30,
  maxRangeM: 20_000,
  /** Stop 5 degrees short of the horizon. */
  maxPitchRad: -5 * RAD,
  minPitchRad: -90 * RAD,
  boundsMarginM: 5000,
} as const;

export const STEP = {
  orbitRad: 15 * RAD,
  tiltRad: 7.5 * RAD,
  zoomIn: 0.7,
  zoomOut: 1 / 0.7,
  /** Keyboard move: this share of the camera height per press. */
  moveShare: 0.25,
} as const;

export type Hpr = { heading: number; pitch: number; range: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

export const clampPitch = (p: number) => clamp(p, LIMITS.minPitchRad, LIMITS.maxPitchRad);

export function orbitStep(h: Hpr, dHeading: number, dPitch: number, zoomFactor = 1): Hpr {
  return {
    heading: wrap(h.heading + dHeading),
    pitch: clampPitch(h.pitch + dPitch),
    range: clamp(h.range * zoomFactor, LIMITS.minRangeM, LIMITS.maxRangeM),
  };
}

/** Ground-plane move: heading clockwise from north; returns metres [east, north]. */
export function moveVector(headingRad: number, right: number, forward: number): [number, number] {
  const s = Math.sin(headingRad);
  const c = Math.cos(headingRad);
  return [right * c + forward * s, -right * s + forward * c];
}

export function clampToBounds(
  lon: number,
  lat: number,
  bbox: readonly [number, number, number, number],
  marginM: number,
): [number, number] {
  const [w, s, e, n] = bbox;
  const dLat = marginM / M_PER_DEG;
  const dLon = marginM / (M_PER_DEG * Math.cos(((s + n) / 2) * RAD));
  return [clamp(lon, w - dLon, e + dLon), clamp(lat, s - dLat, n + dLat)];
}

export type KeyAction =
  | { kind: "move"; right: number; forward: number }
  | { kind: "orbit"; dHeading: number; dPitch: number }
  | { kind: "zoom"; factor: number };

const KEYS: Record<string, KeyAction> = {
  w: { kind: "move", right: 0, forward: 1 },
  arrowup: { kind: "move", right: 0, forward: 1 },
  s: { kind: "move", right: 0, forward: -1 },
  arrowdown: { kind: "move", right: 0, forward: -1 },
  a: { kind: "move", right: -1, forward: 0 },
  arrowleft: { kind: "move", right: -1, forward: 0 },
  d: { kind: "move", right: 1, forward: 0 },
  arrowright: { kind: "move", right: 1, forward: 0 },
  q: { kind: "orbit", dHeading: -STEP.orbitRad, dPitch: 0 },
  e: { kind: "orbit", dHeading: STEP.orbitRad, dPitch: 0 },
  r: { kind: "orbit", dHeading: 0, dPitch: STEP.tiltRad },
  f: { kind: "orbit", dHeading: 0, dPitch: -STEP.tiltRad },
  "+": { kind: "zoom", factor: STEP.zoomIn },
  "=": { kind: "zoom", factor: STEP.zoomIn },
  "-": { kind: "zoom", factor: STEP.zoomOut },
  _: { kind: "zoom", factor: STEP.zoomOut },
};

export const keyAction = (key: string): KeyAction | null => KEYS[key.toLowerCase()] ?? null;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/controls/cameraMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scene/cesium/controls/cameraMath.ts apps/web/src/features/scene/cesium/controls/cameraMath.test.ts
git commit -m "feat(web): pure camera maths and key map for the 3D controls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 5: Camera actions, mouse/touch mapping, limits and the close stylised home view

**Files:**
- Create: `apps/web/src/features/scene/cesium/controls/cameraOps.ts`
- Create: `apps/web/src/features/scene/cesium/controls/configureControls.ts`
- Create: `apps/web/src/features/scene/cesium/controls/configureControls.test.ts`
- Modify: `apps/web/src/features/scene/cesium/home.ts`
- Modify: `apps/web/src/features/scene/cesium/home.test.ts`
- Modify: `apps/web/src/features/scene/cesium/camera.ts:9-19`
- Modify: `apps/web/src/features/scene/cesium/CesiumScene.tsx:30-37,111-118,153-209`

**Interfaces:**
- Consumes: `LIMITS`, `orbitStep`, `moveVector`, `clampPitch`, `clampToBounds`, `STEP` (Task 4); `homeView` (existing).
- Produces:
  - `home.ts`: `STYLISED_RANGE_M = 1200`, `STYLISED_PITCH_DEG = -35`, `STYLISED_FOV_DEG = 30`, `DEFAULT_PITCH_DEG = -45`, `DEFAULT_FOV_DEG = 60`, `type Framing = HomeView & { pitchDeg: number }`, `framingFor(style: "stylised" | "realistic", home: HomeView): Framing`
  - `cameraOps.ts`: `interface CameraOps { orbit(dHeading: number, dPitch: number): void; move(right: number, forward: number): void; zoom(factor: number): void; faceNorth(): void; home(): void; whole(): void; headingRad(): number }`, `createCameraOps(C, viewer, getFraming: () => Framing, getBbox: () => [w, s, e, n]): CameraOps`
  - `configureControls.ts`: `configureControls(C, viewer, ops: CameraOps, getBbox): () => void` (returns undo)

- [ ] **Step 1: Write the failing tests**

Append to `home.test.ts`:

```ts
import { framingFor, STYLISED_RANGE_M } from "./home";

describe("framingFor", () => {
  const home = { lon: 101.5, lat: 3.18, range_m: 6000 };
  it("stylised opens close and oblique", () => {
    expect(framingFor("stylised", home)).toEqual({ ...home, range_m: STYLISED_RANGE_M, pitchDeg: -35 });
    expect(STYLISED_RANGE_M).toBe(1200);
  });
  it("realistic keeps the site's range at -45 degrees", () => {
    expect(framingFor("realistic", home)).toEqual({ ...home, pitchDeg: -45 });
  });
  it("never zooms further out than the site's own home", () => {
    expect(framingFor("stylised", { ...home, range_m: 800 }).range_m).toBe(800);
  });
});
```

`configureControls.test.ts` (fake viewer; checks the mapping, the per-frame clamp and the shift-wheel orbit):

```ts
import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "./cameraMath";
import { configureControls } from "./configureControls";

function fakes() {
  const actions = new Map<string, (e: unknown) => void>();
  class Handler {
    setInputAction = vi.fn((fn: (e: unknown) => void, type: number, mod?: number) =>
      actions.set(`${type}:${mod ?? ""}`, fn),
    );
    destroy = vi.fn();
  }
  const pre = new Set<() => void>();
  const camera = {
    pitch: -0.6,
    heading: 0,
    positionCartographic: { longitude: 0, latitude: 0, height: 500 },
    setView: vi.fn(),
  };
  const ssc: Record<string, unknown> = {};
  const widgetHandler = { removeInputAction: vi.fn() };
  const viewer = {
    isDestroyed: () => false,
    cesiumWidget: { screenSpaceEventHandler: widgetHandler },
    scene: {
      canvas: {},
      camera,
      screenSpaceCameraController: ssc,
      preUpdate: {
        addEventListener: (cb: () => void) => {
          pre.add(cb);
          return () => pre.delete(cb);
        },
      },
      requestRender: vi.fn(),
    },
  };
  const C = {
    ScreenSpaceEventHandler: Handler,
    ScreenSpaceEventType: { WHEEL: 1, LEFT_DOUBLE_CLICK: 2 },
    KeyboardEventModifier: { SHIFT: 10, CTRL: 11 },
    CameraEventType: { LEFT_DRAG: 0, RIGHT_DRAG: 1, MIDDLE_DRAG: 2, WHEEL: 3, PINCH: 4 },
    Cartesian3: { fromRadians: (lo: number, la: number, h: number) => ({ lo, la, h }) },
    Math: { toRadians: (d: number) => (d * Math.PI) / 180, toDegrees: (r: number) => (r * 180) / Math.PI },
  };
  const ops = { orbit: vi.fn(), move: vi.fn(), zoom: vi.fn(), faceNorth: vi.fn(), home: vi.fn(), whole: vi.fn(), headingRad: () => 0 };
  return { C, viewer, camera, ssc, actions, pre, ops, widgetHandler };
}

const BBOX: [number, number, number, number] = [101.46, 3.15, 101.53, 3.24];

describe("configureControls", () => {
  it("left-drag pans, right/middle/ctrl-drag/pinch orbit, wheel/pinch zoom, limits set", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    expect(f.ssc.rotateEventTypes).toBe(0);
    expect(f.ssc.tiltEventTypes).toEqual([1, 2, 4, { eventType: 0, modifier: 11 }]);
    expect(f.ssc.zoomEventTypes).toEqual([3, 4]);
    expect(f.ssc.lookEventTypes).toBeUndefined();
    expect(f.ssc.minimumZoomDistance).toBe(LIMITS.minRangeM);
    expect(f.ssc.maximumZoomDistance).toBe(LIMITS.maxRangeM);
    expect(f.widgetHandler.removeInputAction).toHaveBeenCalledWith(2);
  });

  it("clamps pitch every frame (a drag stops at 5 degrees short of the horizon)", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    f.camera.pitch = 0.1;
    for (const cb of f.pre) cb();
    expect(f.camera.setView).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: expect.objectContaining({ pitch: LIMITS.maxPitchRad }) }),
    );
  });

  it("pulls the camera back inside bbox + 5 km", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    f.camera.positionCartographic = { longitude: (110 * Math.PI) / 180, latitude: (3.2 * Math.PI) / 180, height: 900 };
    for (const cb of f.pre) cb();
    const arg = f.camera.setView.mock.calls.at(-1)?.[0] as { destination: { lo: number; h: number } };
    expect((arg.destination.lo * 180) / Math.PI).toBeLessThan(101.6);
    expect(arg.destination.h).toBe(900);
  });

  it("shift + wheel tilts via ops.orbit", () => {
    const f = fakes();
    configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    f.actions.get("1:10")?.(120);
    expect(f.ops.orbit).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it("undo restores nothing twice and destroys its handler", () => {
    const f = fakes();
    const undo = configureControls(f.C as never, f.viewer as never, f.ops, () => BBOX);
    undo();
    expect(f.pre.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/home.test.ts src/features/scene/cesium/controls/configureControls.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `home.ts`**

Replace the stylised part of `home.ts` (from `STYLISED_RANGE_M` to the end) with:

```ts
/** The stylised city opens close and oblique (a diorama), never further out than the site home. */
export const STYLISED_RANGE_M = 1200;
export const STYLISED_PITCH_DEG = -35;
export const STYLISED_FOV_DEG = 30;
export const DEFAULT_PITCH_DEG = -45;
export const DEFAULT_FOV_DEG = 60;

export type Framing = HomeView & { pitchDeg: number };

export function stylisedHomeView(home: HomeView): HomeView {
  return { ...home, range_m: Math.min(home.range_m, STYLISED_RANGE_M) };
}

export function framingFor(style: "stylised" | "realistic", home: HomeView): Framing {
  return style === "stylised"
    ? { ...stylisedHomeView(home), pitchDeg: STYLISED_PITCH_DEG }
    : { ...home, pitchDeg: DEFAULT_PITCH_DEG };
}
```

Update any existing `home.test.ts` assertion that expected `STYLISED_RANGE_M` to be 2500.

- [ ] **Step 4: Implement `cameraOps.ts`**

```ts
import type * as Cesium from "cesium";
import type { Framing } from "../home";
import { moveVector, orbitStep, STEP } from "./cameraMath";

export interface CameraOps {
  orbit(dHeading: number, dPitch: number): void;
  move(right: number, forward: number): void;
  zoom(factor: number): void;
  faceNorth(): void;
  home(): void;
  whole(): void;
  headingRad(): number;
}

type Bbox = [number, number, number, number];

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Camera actions shared by the buttons, the keyboard and double-click. */
export function createCameraOps(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  getFraming: () => Framing,
  getBbox: () => Bbox,
): CameraOps {
  const { scene } = viewer;
  const camera = scene.camera;

  /** Ground point at the screen centre, else straight below the camera. */
  const pivot = (): Cesium.Cartesian3 => {
    const c = scene.canvas;
    const hit = camera.pickEllipsoid(new C.Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
    if (hit) return hit;
    const g = camera.positionCartographic;
    return C.Cartesian3.fromRadians(g.longitude, g.latitude, 0);
  };

  const orbitAbout = (dHeading: number, dPitch: number, zoomFactor = 1) => {
    const target = pivot();
    const range = C.Cartesian3.distance(camera.position, target);
    const next = orbitStep(
      { heading: camera.heading, pitch: camera.pitch, range },
      dHeading,
      dPitch,
      zoomFactor,
    );
    camera.lookAt(target, new C.HeadingPitchRange(next.heading, next.pitch, next.range));
    camera.lookAtTransform(C.Matrix4.IDENTITY);
    scene.requestRender();
  };

  const frame = (f: Framing, fly: boolean) => {
    const target = C.Cartesian3.fromDegrees(f.lon, f.lat, 0);
    const offset = new C.HeadingPitchRange(0, C.Math.toRadians(f.pitchDeg), f.range_m);
    const sphere = new C.BoundingSphere(target, 1);
    if (fly && !reducedMotion()) camera.flyToBoundingSphere(sphere, { offset, duration: 1.2 });
    else camera.viewBoundingSphere(sphere, offset);
    camera.lookAtTransform(C.Matrix4.IDENTITY);
    scene.requestRender();
  };

  return {
    orbit: (dh, dp) => orbitAbout(dh, dp),
    zoom: (factor) => orbitAbout(0, 0, factor),
    move(right, forward) {
      const h = camera.positionCartographic.height;
      const step = Math.max(10, h * STEP.moveShare);
      const [e, n] = moveVector(camera.heading, right * step, forward * step);
      const enu = C.Transforms.eastNorthUpToFixedFrame(camera.position);
      const dir = C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(e, n, 0), new C.Cartesian3());
      const len = C.Cartesian3.magnitude(dir);
      if (len > 0) camera.move(C.Cartesian3.normalize(dir, dir), len);
      scene.requestRender();
    },
    faceNorth: () => orbitAbout(-camera.heading, 0),
    home: () => frame(getFraming(), true),
    whole() {
      const [w, s, e, n] = getBbox();
      const dest = C.Rectangle.fromDegrees(w, s, e, n);
      const orientation = { heading: 0, pitch: C.Math.toRadians(-50), roll: 0 };
      if (reducedMotion()) camera.setView({ destination: dest, orientation });
      else camera.flyTo({ destination: dest, orientation, duration: 1.2 });
      scene.requestRender();
    },
    headingRad: () => camera.heading,
  };
}

/** Frame without animation (initial home view). */
export function frameNow(C: typeof Cesium, viewer: Cesium.Viewer, f: Framing) {
  viewer.camera.lookAt(
    C.Cartesian3.fromDegrees(f.lon, f.lat, 0),
    new C.HeadingPitchRange(0, C.Math.toRadians(f.pitchDeg), f.range_m),
  );
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}
```

- [ ] **Step 5: Implement `configureControls.ts`**

```ts
import type * as Cesium from "cesium";
import { clampPitch, clampToBounds, LIMITS } from "./cameraMath";
import type { CameraOps } from "./cameraOps";

type Bbox = [number, number, number, number];

/** Shift+wheel tilt: radians per wheel unit (a notch is ~100-120). */
const WHEEL_TILT = 0.0015;

/**
 * Mouse/touch mapping agreed with the owner:
 *   left-drag  = constant-height pan, grabbed point stays under the cursor (Cesium 3D "rotate")
 *   right-drag, middle-drag, ctrl+left-drag, two-finger = orbit about the point under the cursor
 *   wheel / pinch = zoom towards the cursor; shift+wheel = tilt; double-click = glide in.
 * Limits are enforced every frame so a drag stops at them (no snap back).
 */
export function configureControls(
  C: typeof Cesium,
  viewer: Cesium.Viewer,
  ops: CameraOps,
  getBbox: () => Bbox,
): () => void {
  const { scene } = viewer;
  const ssc = scene.screenSpaceCameraController;
  const E = C.CameraEventType;
  const K = C.KeyboardEventModifier;
  ssc.rotateEventTypes = E.LEFT_DRAG;
  ssc.tiltEventTypes = [E.RIGHT_DRAG, E.MIDDLE_DRAG, E.PINCH, { eventType: E.LEFT_DRAG, modifier: K.CTRL }];
  ssc.zoomEventTypes = [E.WHEEL, E.PINCH];
  ssc.lookEventTypes = undefined as unknown as Cesium.CameraEventType;
  ssc.minimumZoomDistance = LIMITS.minRangeM;
  ssc.maximumZoomDistance = LIMITS.maxRangeM;
  ssc.enableCollisionDetection = true;

  // The viewer's default double-click tracks entities; replace it with "glide in".
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  const handler = new C.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction(
    (delta: number) => ops.orbit(0, -delta * WHEEL_TILT),
    C.ScreenSpaceEventType.WHEEL,
    K.SHIFT,
  );
  handler.setInputAction(() => ops.zoom(0.5), C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  const camera = scene.camera;
  const offLimits = scene.preUpdate.addEventListener(() => {
    const p = clampPitch(camera.pitch);
    const g = camera.positionCartographic;
    const lon = C.Math.toDegrees(g.longitude);
    const lat = C.Math.toDegrees(g.latitude);
    const [cl, ca] = clampToBounds(lon, lat, getBbox(), LIMITS.boundsMarginM);
    const moved = cl !== lon || ca !== lat;
    if (p === camera.pitch && !moved) return;
    camera.setView({
      destination: moved
        ? C.Cartesian3.fromRadians(C.Math.toRadians(cl), C.Math.toRadians(ca), g.height)
        : undefined,
      orientation: { heading: camera.heading, pitch: p, roll: 0 },
    });
  });

  return () => {
    offLimits();
    if (!handler.isDestroyed?.()) handler.destroy();
  };
}
```

Note for the implementer: `double-click → ops.zoom(0.5)` zooms about the screen-centre pivot. If manual testing shows it should zoom about the clicked point, change the handler to `(e) => { const hit = camera.pickEllipsoid(e.position); … camera.flyTo({ destination: point above hit at half range }) }` and add a test; the spec only requires "glide in to that spot", so prefer the clicked point if it works on the first try.

Update the fake in the test if `handler.isDestroyed` is undefined (the code guards with `?.`).

- [ ] **Step 6: Wire into `CesiumScene.tsx` and `camera.ts`**

In `CesiumScene.tsx`:
- Replace `frameHome` with `frameNow` from `./controls/cameraOps` and pass `framingFor(style, homeView(siteData))` in the reframe effect (lines 111-118).
- When the style changes, set the vertical FOV: inside a new effect on `[viewer, style]`:

```ts
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const apply = () => {
      const f = viewer.camera.frustum;
      if (!(f instanceof Cesium.PerspectiveFrustum)) return;
      if (style !== "stylised") {
        f.fov = Cesium.Math.toRadians(DEFAULT_FOV_DEG); // Cesium's own default, unchanged
      } else {
        // Cesium's fov is the HORIZONTAL angle when the canvas is wider than tall: convert so the
        // vertical angle is STYLISED_FOV_DEG.
        f.fov = fovForVertical(STYLISED_FOV_DEG, viewer.canvas.clientWidth, viewer.canvas.clientHeight);
      }
      viewer.scene.requestRender();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(viewer.canvas);
    return () => ro.disconnect();
  }, [viewer, style]);
```

Add to `home.ts`, and test it in `home.test.ts` (landscape 1600×900 at 30° vertical gives about 50.4° horizontal; portrait gives exactly 30°):

```ts
/** Cesium PerspectiveFrustum.fov for a wanted vertical angle (fov is horizontal on landscape). */
export function fovForVertical(vDeg: number, w: number, h: number): number {
  const v = (vDeg * Math.PI) / 180;
  if (!(w > h) || h <= 0) return v;
  return 2 * Math.atan(Math.tan(v / 2) * (w / h));
}
```

```ts
import { fovForVertical } from "./home";
it("fovForVertical converts to Cesium's horizontal fov on landscape canvases", () => {
  expect((fovForVertical(30, 1600, 900) * 180) / Math.PI).toBeCloseTo(50.4, 0);
  expect((fovForVertical(30, 900, 1600) * 180) / Math.PI).toBeCloseTo(30, 6);
});
```

- Create the ops once per viewer and configure controls; expose them to the DOM chrome (Task 6) through a new prop `onOps?: (ops: CameraOps | null) => void` on `SceneSetup`:

```ts
  const framingRef = useRef(framingFor(style, homeView(siteData)));
  framingRef.current = framingFor(style, homeView(siteData));
  const bboxRef = useRef<[number, number, number, number]>([101.46, 3.15, 101.53, 3.24]);
  if (siteData?.bbox?.length === 4) bboxRef.current = siteData.bbox as [number, number, number, number];
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const ops = createCameraOps(Cesium, viewer, () => framingRef.current, () => bboxRef.current);
    const undo = configureControls(Cesium, viewer, ops, () => bboxRef.current);
    onOps?.(ops);
    return () => {
      onOps?.(null);
      undo();
    };
  }, [viewer, onOps]);
```

  (`siteData` is declared earlier in `SceneSetup`; move its `useSite()` line above this effect if needed.)

In `camera.ts`, make `go()` use the stylised pitch when the stylised style is active. Change the signature to `go(viewer, sphere, rangeM?, pitchDeg = -45)` and in `useCameraIntents` read the style: `const style = useScene.getState().mapStyle` is not reliable before settle, so take it as a hook argument: `useCameraIntents(focusPoint, onMoved, pitchDeg)` and call it from `SceneSetup` with `style === "stylised" ? STYLISED_PITCH_DEG : DEFAULT_PITCH_DEG`. Pass `pitchDeg` through to every `go(...)` call.

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Manual check (Stylised, mock LLM, no Google tiles)**

Run `pnpm dev` with `LLM_PROVIDER=mock`, open http://localhost:5173 and check:
- It opens at about 1.2 km, oblique, with buildings filling the frame.
- Left-drag pans at a constant height, with the grabbed point under the cursor.
- Right-drag orbits.
- The wheel zooms towards the cursor.
- Shift+wheel tilts.
- Ctrl+drag orbits.
- Double-click glides in.
- You can't tilt to the horizon or wander off into the sea.
- Clicking a place marker still opens its card, and a drag never opens one.

Record what you saw.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/scene/cesium/controls/cameraOps.ts apps/web/src/features/scene/cesium/controls/configureControls.ts apps/web/src/features/scene/cesium/controls/configureControls.test.ts apps/web/src/features/scene/cesium/home.ts apps/web/src/features/scene/cesium/home.test.ts apps/web/src/features/scene/cesium/camera.ts apps/web/src/features/scene/cesium/CesiumScene.tsx
git commit -m "feat(web): friendly 3D mouse controls, camera limits and a close stylised home view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 6: On-screen camera controls, keyboard and first-visit hint

**Files:**
- Create: `apps/web/src/features/scene/cesium/controls/cameraUiStore.ts`
- Create: `apps/web/src/features/scene/cesium/controls/CameraControls.tsx`
- Create: `apps/web/src/features/scene/cesium/controls/CameraControls.dom.test.tsx`
- Modify: `apps/web/src/features/scene/cesium/CesiumScene.tsx` (section `tabIndex`, `onKeyDown`, render `CameraControls`)
- Modify: `apps/web/src/features/map-ui/SettingsPopover.tsx` (Camera controls toggle)
- Modify: `apps/web/e2e/heroes.spec.ts` (List view has no camera cluster)

**Interfaces:**
- Consumes: `CameraOps` (Task 5), `keyAction` (Task 4).
- Produces:
  - `useCameraUi`: `{ alwaysShow: boolean; hintDismissed: boolean; setAlwaysShow(v: boolean): void; dismissHint(): void }`, persisted in `tl.camera.alwaysShow` and `tl.camera.hint`
  - `<CameraControls ops={CameraOps | null} />`
  - `handleMapKey(e: React.KeyboardEvent, ops: CameraOps | null): void`

- [ ] **Step 1: Write the failing test**

`CameraControls.dom.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STEP } from "./cameraMath";
import type { CameraOps } from "./cameraOps";
import { CameraControls, handleMapKey } from "./CameraControls";
import { useCameraUi } from "./cameraUiStore";

const ops = (): CameraOps => ({
  orbit: vi.fn(),
  move: vi.fn(),
  zoom: vi.fn(),
  faceNorth: vi.fn(),
  home: vi.fn(),
  whole: vi.fn(),
  headingRad: () => 0,
});

describe("CameraControls", () => {
  beforeEach(() => {
    localStorage.clear();
    useCameraUi.setState({ alwaysShow: false, hintDismissed: false });
  });

  it("shows only the compass until the corner is hovered or focused", () => {
    render(<CameraControls ops={ops()} />);
    expect(screen.getByRole("button", { name: "Face north (N)" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Zoom in/ })).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("group", { name: "Camera" }));
    expect(screen.getByRole("button", { name: "Zoom in (+)" })).toBeInTheDocument();
  });

  it("buttons call the camera actions", () => {
    const o = ops();
    useCameraUi.setState({ alwaysShow: true });
    render(<CameraControls ops={o} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in (+)" }));
    expect(o.zoom).toHaveBeenCalledWith(STEP.zoomIn);
    fireEvent.click(screen.getByRole("button", { name: "Rotate left (Q)" }));
    expect(o.orbit).toHaveBeenCalledWith(-STEP.orbitRad, 0);
    fireEvent.click(screen.getByRole("button", { name: "Tilt up (R)" }));
    expect(o.orbit).toHaveBeenCalledWith(0, STEP.tiltRad);
    fireEvent.click(screen.getByRole("button", { name: "Home view" }));
    expect(o.home).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Whole township" }));
    expect(o.whole).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Face north (N)" }));
    expect(o.faceNorth).toHaveBeenCalled();
  });

  it("first-visit hint can be dismissed and stays dismissed", () => {
    render(<CameraControls ops={ops()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss camera tips" }));
    expect(screen.queryByText(/Drag to move/)).toBeNull();
    expect(localStorage.getItem("tl.camera.hint")).toBe("dismissed");
  });

  it("map keys act; keys from a text field never do", () => {
    const o = ops();
    const ev = (key: string, target: Element) =>
      ({ key, target, preventDefault: vi.fn(), altKey: false, ctrlKey: false, metaKey: false }) as never;
    const div = document.createElement("div");
    handleMapKey(ev("w", div), o);
    expect(o.move).toHaveBeenCalledWith(0, 1);
    const input = document.createElement("input");
    handleMapKey(ev("w", input), o);
    expect(o.move).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/controls/CameraControls.dom.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the store**

`cameraUiStore.ts`:

```ts
import { create } from "zustand";

const SHOW = "tl.camera.alwaysShow";
const HINT = "tl.camera.hint";
const read = (k: string) => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-viewer convenience only */
  }
};

interface CameraUi {
  alwaysShow: boolean;
  hintDismissed: boolean;
  setAlwaysShow: (v: boolean) => void;
  dismissHint: () => void;
}

export const useCameraUi = create<CameraUi>((set) => ({
  alwaysShow: read(SHOW) === "true",
  hintDismissed: read(HINT) === "dismissed",
  setAlwaysShow: (v) => {
    write(SHOW, String(v));
    set({ alwaysShow: v });
  },
  dismissHint: () => {
    write(HINT, "dismissed");
    set({ hintDismissed: true });
  },
}));
```

- [ ] **Step 4: Implement the component**

`CameraControls.tsx`:

```tsx
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useState } from "react";
import { keyAction, STEP } from "./cameraMath";
import type { CameraOps } from "./cameraOps";
import { useCameraUi } from "./cameraUiStore";

const TEXT_INPUT = /^(INPUT|TEXTAREA|SELECT)$/;

/** Keyboard on the focused map only; never from a text field or with a modifier held. */
export function handleMapKey(e: ReactKeyboardEvent, ops: CameraOps | null) {
  const t = e.target as HTMLElement;
  if (!ops || e.altKey || e.ctrlKey || e.metaKey) return;
  if (TEXT_INPUT.test(t.tagName) || t.isContentEditable) return;
  if (e.key.toLowerCase() === "n") {
    e.preventDefault();
    ops.faceNorth();
    return;
  }
  const a = keyAction(e.key);
  if (!a) return;
  e.preventDefault();
  if (a.kind === "move") ops.move(a.right, a.forward);
  else if (a.kind === "orbit") ops.orbit(a.dHeading, a.dPitch);
  else ops.zoom(a.factor);
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full border border-edge bg-surface/90 text-fg shadow-md backdrop-blur hover:bg-raised"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export function CameraControls({ ops }: { ops: CameraOps | null }) {
  const { alwaysShow, hintDismissed, dismissHint } = useCameraUi();
  const [peek, setPeek] = useState(false);
  const open = alwaysShow || peek;
  const heading = ops?.headingRad() ?? 0;
  if (!ops) return null;
  return (
    <>
      {!hintDismissed && (
        <div
          role="note"
          className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-edge bg-surface/90 px-4 py-2 text-sm text-fg shadow-md backdrop-blur"
        >
          <span>Drag to move · Scroll to zoom · Right-drag to rotate</span>
          <button
            type="button"
            aria-label="Dismiss camera tips"
            onClick={dismissHint}
            className="grid size-8 place-items-center rounded-full hover:bg-fg/10"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover/focus only reveals more buttons */}
      <div
        role="group"
        aria-label="Camera"
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        onFocus={() => setPeek(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setPeek(false);
        }}
        className="absolute bottom-4 right-[4.5rem] z-20 flex items-end gap-2"
      >
        {open && (
          <div className="flex flex-col gap-2 motion-safe:animate-[fadeIn_200ms_ease-out]">
            <Btn label="Home view" onClick={ops.home}>⌂</Btn>
            <Btn label="Whole township" onClick={ops.whole}>⤢</Btn>
            <Btn label="Zoom in (+)" onClick={() => ops.zoom(STEP.zoomIn)}>+</Btn>
            <Btn label="Zoom out (−)" onClick={() => ops.zoom(STEP.zoomOut)}>−</Btn>
          </div>
        )}
        {open && (
          <div className="flex flex-col gap-2">
            <Btn label="Tilt up (R)" onClick={() => ops.orbit(0, STEP.tiltRad)}>⤒</Btn>
            <Btn label="Tilt down (F)" onClick={() => ops.orbit(0, -STEP.tiltRad)}>⤓</Btn>
            <Btn label="Rotate left (Q)" onClick={() => ops.orbit(-STEP.orbitRad, 0)}>↺</Btn>
            <Btn label="Rotate right (E)" onClick={() => ops.orbit(STEP.orbitRad, 0)}>↻</Btn>
          </div>
        )}
        <Btn label="Face north (N)" onClick={ops.faceNorth}>
          <span style={{ display: "inline-block", transform: `rotate(${-heading}rad)` }}>➤</span>
        </Btn>
      </div>
    </>
  );
}
```

Add the keyframe once in `apps/web/src/index.css`:

```css
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

The compass arrow should follow the heading live. Re-render it on camera change: in `CesiumScene` (next step) subscribe to `viewer.camera.changed` (set `viewer.camera.percentageChanged = 0.01`) and bump a state counter passed as `key`-free prop `tick` to `CameraControls`. Add `tick?: number` to its props (unused except to trigger re-render).

- [ ] **Step 5: Wire into `CesiumScene` and Settings**

In `CesiumScene` (the default export):

```tsx
  const [ops, setOps] = useState<CameraOps | null>(null);
  const [tick, setTick] = useState(0);
  // …
  <section
    className="relative h-full w-full"
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the 3D map takes keyboard focus for WASD/QE/RF
    tabIndex={0}
    aria-label="3D map. Arrow keys or WASD move, Q and E rotate, R and F tilt, plus and minus zoom, N faces north."
    onKeyDown={(e) => handleMapKey(e, ops)}
  >
    {/* existing children */}
    <CameraControls ops={ops} tick={tick} />
```

Pass `onOps={setOps}` to `SceneSetup`, and inside `SceneSetup` add:

```ts
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.percentageChanged = 0.01;
    return viewer.camera.changed.addEventListener(() => onCameraChange?.());
  }, [viewer, onCameraChange]);
```

with a new prop `onCameraChange={() => setTick((t) => t + 1)}` (wrap it in `useCallback` in the parent).

In `SettingsPopover.tsx`, add a section after Map style:

```tsx
          {effective === "cesium" && (
            <div>
              <h3 className={H}>Camera controls</h3>
              <div role="radiogroup" aria-label="Camera controls" className="grid grid-cols-2 gap-2">
                <Radio checked={!alwaysShow} onClick={() => setAlwaysShow(false)}>
                  Compass only
                </Radio>
                <Radio checked={alwaysShow} onClick={() => setAlwaysShow(true)}>
                  Always show
                </Radio>
              </div>
            </div>
          )}
```

with `const { alwaysShow, setAlwaysShow } = useCameraUi();`.

In `apps/web/e2e/heroes.spec.ts`, add to an existing main-screen test (the List view runs in e2e):

```ts
  await expect(page.getByRole("group", { name: "Camera" })).toHaveCount(0);
```

- [ ] **Step 6: Run tests, lint, e2e**

Run: `pnpm --filter @tl/web exec vitest run && pnpm lint && pnpm --filter @tl/web e2e`
Expected: PASS.

- [ ] **Step 7: Manual check**

In the Stylised view check:
- Only the compass is visible at first.
- Hovering the corner reveals the cluster.
- Every button works.
- Tab reaches the map, and WASD/QE/RF/+/−/N work.
- Typing "wasd" in the chat box does not move the camera.
- The hint disappears for good once dismissed.
- Settings "Always show" keeps the cluster open.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/scene/cesium/controls/cameraUiStore.ts apps/web/src/features/scene/cesium/controls/CameraControls.tsx apps/web/src/features/scene/cesium/controls/CameraControls.dom.test.tsx apps/web/src/features/scene/cesium/CesiumScene.tsx apps/web/src/features/map-ui/SettingsPopover.tsx apps/web/src/index.css apps/web/e2e/heroes.spec.ts
git commit -m "feat(web): compass, camera cluster, map keyboard and first-visit hint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

**Phase 1 gate:** run the full CI checklist (Global Constraints), take Stylised screenshots (Day, Dusk, Night) at Home, log them in `docs/superpowers/overnight-log.md` with a real `date` timestamp, and show them to the owner.

---

# Phase 2: lighting, post-processing, crossfade, ground

### Task 7: Colour helpers and the three-part lighting model

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/colour.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/colour.test.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/lighting.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/lighting.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.ts` (add `light`, `sky`, `horizon`, `shadows`, `bloom`; `lerpPalette`)
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts` (shader uses `tl_light` + `tl_fog`)
- Modify: `apps/web/src/features/scene/cesium/stylised/props.ts` (materials from `litColorMaterial`)

**Interfaces:**
- Produces:
  - `colour.ts`: `hexToRgb(hex): [r, g, b]` (0–1), `rgbToHex([r, g, b]): string`, `mixHex(a, b, t): string`, `deltaE(a, b): number` (CIE76 in Lab)
  - `Palette` additions: `light: { key: string; fill: string; bounce: string; keyDir: [number, number, number]; keyIntensity: number; ambient: number }`, `skyTop: string`, `horizon: string`, `shadows: boolean`, `bloom: boolean`
  - `lerpPalette(a: Palette, b: Palette, t: number): Palette` (colours mixed; numbers lerped; booleans/arrays-of-numbers taken from `t < 0.5 ? a : b`)
  - `lighting.ts`: `LIGHTING_GLSL: string` (declares `vec3 tl_light(vec3 normalEC)` and `vec3 tl_fog(vec3 c, vec3 positionToEyeEC)`), `lightUniforms(C, p: Palette, at: {lon, lat}): Record<string, unknown>`, `litColorMaterial(C, css: string, p: Palette, at): Cesium.Material`, `setLightUniforms(m: Cesium.Material, u)`

- [ ] **Step 1: Write the failing tests**

`colour.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deltaE, hexToRgb, mixHex, rgbToHex } from "./colour";

describe("colour", () => {
  it("round-trips hex", () => {
    expect(rgbToHex(hexToRgb("#5b45a0"))).toBe("#5b45a0");
  });
  it("mixes linearly in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mixHex("#123456", "#abcdef", 1)).toBe("#abcdef");
  });
  it("deltaE is 0 for equal colours and large for black vs white", () => {
    expect(deltaE("#336699", "#336699")).toBeCloseTo(0);
    expect(deltaE("#000000", "#ffffff")).toBeGreaterThan(99);
  });
});
```

`lighting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LIGHTING_GLSL, lightUniforms } from "./lighting";
import { paletteFor } from "./palette";

const C = {
  Color: { fromCssColorString: (css: string) => ({ css }) },
  Cartesian3: class {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
  },
};

describe("lighting", () => {
  it("declares tl_light and tl_fog", () => {
    expect(LIGHTING_GLSL).toMatch(/vec3 tl_light\(vec3 normalEC\)/);
    expect(LIGHTING_GLSL).toMatch(/vec3 tl_fog\(vec3 c, vec3 positionToEyeEC\)/);
  });
  it("uniforms carry the palette's key, fill, bounce, horizon and unit vectors", () => {
    const p = paletteFor("dusk");
    const u = lightUniforms(C as never, p, { lon: 101.51, lat: 3.18 }) as Record<string, any>;
    expect(u.keyColor).toEqual({ css: p.light.key });
    expect(u.fillColor).toEqual({ css: p.light.fill });
    expect(u.bounceColor).toEqual({ css: p.light.bounce });
    expect(u.horizonColor).toEqual({ css: p.horizon });
    expect(Math.hypot(u.keyWC.x, u.keyWC.y, u.keyWC.z)).toBeCloseTo(1);
    expect(Math.hypot(u.upWC.x, u.upWC.y, u.upWC.z)).toBeCloseTo(1);
  });
});
```

Add to `palette.test.ts`:

```ts
import { lerpPalette } from "./palette";
  it("lerpPalette is a at 0, b at 1, and mixes colours in between", () => {
    expect(lerpPalette(day, night, 0)).toEqual(day);
    expect(lerpPalette(day, night, 1)).toEqual(night);
    const mid = lerpPalette(day, night, 0.5);
    expect(mid.sky).not.toBe(day.sky);
    expect(mid.sky).not.toBe(night.sky);
    expect(mid.glow).toBeCloseTo(0.5);
  });
  it("every mood defines key/fill/bounce light, sky gradient and horizon", () => {
    for (const p of [day, dusk, night]) {
      for (const c of [p.light.key, p.light.fill, p.light.bounce, p.skyTop, p.horizon])
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(night.shadows).toBe(false);
    expect(day.bloom).toBe(false);
    expect(dusk.bloom && night.bloom).toBe(true);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/`
Expected: FAIL.

- [ ] **Step 3: Implement `colour.ts`**

```ts
export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a.toLowerCase();
  if (t >= 1) return b.toLowerCase();
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);

function lab(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex).map(lin) as Rgb;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference. */
export function deltaE(a: string, b: string): number {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
```

- [ ] **Step 4: Extend the palette**

Add to `interface Palette`:

```ts
  light: {
    key: string;
    fill: string;
    bounce: string;
    /** ENU direction the key light travels (same convention as `sun.dir`). */
    keyDir: [number, number, number];
    keyIntensity: number;
    ambient: number;
  };
  /** CSS sky gradient behind the transparent canvas. */
  skyTop: string;
  horizon: string;
  shadows: boolean;
  bloom: boolean;
```

Values (add to each palette object):

```ts
// DAY
  light: { key: "#fff1d6", fill: "#cfe3ff", bounce: "#e8dccf", keyDir: [0.5, -0.6, -0.8], keyIntensity: 0.85, ambient: 0.55 },
  skyTop: "#7fb2e5", horizon: "#e9f1f7", shadows: true, bloom: false,
// DUSK
  light: { key: "#ffb38a", fill: "#8f8be0", bounce: "#d9a7a0", keyDir: [0.75, -0.2, -0.3], keyIntensity: 0.9, ambient: 0.45 },
  skyTop: "#6f5aa8", horizon: "#f8cdb0", shadows: true, bloom: true,
// NIGHT
  light: { key: "#8fa6ff", fill: "#3d2f6b", bounce: "#1a1430", keyDir: [0.4, -0.5, -0.25], keyIntensity: 0.35, ambient: 0.4 },
  skyTop: "#120d26", horizon: "#3d2f6b", shadows: false, bloom: true,
```

Add `lerpPalette`:

```ts
import { mixHex } from "./colour";

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function lerpAny(a: unknown, b: unknown, t: number): unknown {
  if (isHex(a) && isHex(b)) return mixHex(a, b, t);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    return a.every(isHex) ? a.map((v, i) => mixHex(v as string, b[i] as string, t)) : t < 0.5 ? a : b;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a)) out[k] = lerpAny((a as never)[k], (b as never)[k], t);
    return out;
  }
  return t < 0.5 ? a : b;
}

/** Palette between a (t=0) and b (t=1): colours mixed, numbers lerped, flags switch at 0.5. */
export const lerpPalette = (a: Palette, b: Palette, t: number): Palette =>
  t <= 0 ? a : t >= 1 ? b : (lerpAny(a, b, t) as Palette);
```

- [ ] **Step 5: Implement `lighting.ts`**

```ts
import type * as Cesium from "cesium";
import { ecef, enuToEcef } from "./buildingsMesh";
import type { Palette } from "./palette";

/**
 * Shared GLSL for every stylised material: warm key + sky fill (from above) + ground bounce (from
 * below), and distance fog towards the mood's horizon colour. Uniform names are fixed: keyColor,
 * fillColor, bounceColor, horizonColor, keyWC, upWC, keyIntensity, ambient, fogDensity.
 */
export const LIGHTING_GLSL = /* glsl */ `
vec3 tl_light(vec3 normalEC) {
  vec3 n = normalize(normalEC);
  vec3 l = normalize(czm_viewRotation * keyWC);
  vec3 up = normalize(czm_viewRotation * upWC);
  float key = max(dot(n, l), 0.0) * keyIntensity;
  float sky = 0.5 + 0.5 * dot(n, up);
  return ambient * mix(bounceColor.rgb, fillColor.rgb, sky) + key * keyColor.rgb;
}
vec3 tl_fog(vec3 c, vec3 positionToEyeEC) {
  float d = length(positionToEyeEC) * fogDensity;
  return mix(c, horizonColor.rgb, clamp(1.0 - exp(-d * d), 0.0, 0.85));
}
`;

const unit = (C: Pick<typeof Cesium, "Cartesian3">, v: [number, number, number]) => {
  const n = Math.hypot(...v) || 1;
  return new C.Cartesian3(v[0] / n, v[1] / n, v[2] / n);
};

export function lightUniforms(
  C: Pick<typeof Cesium, "Color" | "Cartesian3">,
  p: Palette,
  at: { lon: number; lat: number },
): Record<string, unknown> {
  const col = (c: string) => C.Color.fromCssColorString(c);
  const toLight = enuToEcef(p.light.keyDir.map((d) => -d) as [number, number, number], at.lon, at.lat);
  return {
    keyColor: col(p.light.key),
    fillColor: col(p.light.fill),
    bounceColor: col(p.light.bounce),
    horizonColor: col(p.horizon),
    keyWC: unit(C, toLight),
    upWC: unit(C, ecef(at.lon, at.lat, 0)),
    keyIntensity: p.light.keyIntensity,
    ambient: p.light.ambient,
    fogDensity: p.fog,
  };
}

const LIT_COLOR_SOURCE = /* glsl */ `
${LIGHTING_GLSL}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  m.diffuse = tl_fog(color.rgb * tl_light(materialInput.normalEC), materialInput.positionToEyeEC);
  return m;
}
`;

/** A flat-colour material lit by the stylised lighting model (use with MaterialAppearance flat: true). */
export function litColorMaterial(
  C: Pick<typeof Cesium, "Material" | "Color" | "Cartesian3">,
  css: string,
  p: Palette,
  at: { lon: number; lat: number },
): Cesium.Material {
  return new C.Material({
    fabric: {
      uniforms: { color: C.Color.fromCssColorString(css), ...lightUniforms(C, p, at) },
      source: LIT_COLOR_SOURCE,
    },
    translucent: false,
  });
}

export function setLightUniforms(m: Cesium.Material, u: Record<string, unknown>) {
  Object.assign(m.uniforms, u);
}
```

- [ ] **Step 6: Use it in buildings and props**

In `buildingsPrimitive.ts` `WINDOW_SHADER`:
- Prepend `${LIGHTING_GLSL}` after `tl_hash`.
- Replace the `vec3 l = …; float lambert = …; float shade = …;` lines with `vec3 lit = tl_light(materialInput.normalEC);`.
- Replace every `* shade` with `* lit`, and `mix(shade, 1.0, 0.5)` with `mix(lit, vec3(1.0), 0.35)`.
- Wrap the final diffuse as `m.diffuse = tl_fog(mix(near, far, fade), materialInput.positionToEyeEC);`.
- Remove `sunWC`, `ambient` and `sunIntensity` from `uniformsFor`, and spread `...lightUniforms(C, palette, at)` instead.
- Add `"Cartesian3"` to `CesiumLike` if it isn't already there.
- `sunVector` is now unused, so delete it.

In `props.ts`:
- Replace `C.Material.fromType("Color", {...})` with `litColorMaterial(C, colour(palette), palette, at)`.
- Use `new C.MaterialAppearance({ material: mat, flat: true, translucent: false, closed: true })`.
- Add `at: { lon: number; lat: number }` to `buildProps`' options (callers pass `home`).
- `setTheme(t)` becomes: for each part, `mat.uniforms.color = C.Color.fromCssColorString(colour(p)); setLightUniforms(mat, lightUniforms(C, p, at));`.

Add `"Material"` to `PropsCesium` (and make `fakeCesium.test-util.ts`'s `Material` constructible: `Material: Object.assign(function (o: { fabric: { uniforms: Record<string, unknown> } }) { return new FakeMaterial("fabric", o.fabric.uniforms); }, { fromType: … })`). Update the props tests that asserted `fromType("Color")`.

- [ ] **Step 7: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck`
Expected: PASS.

Manual check (Stylised):
- Walls facing the key light are warm.
- Shaded walls pick up the fill colour, so they're never black.
- Far buildings fade towards the horizon colour.
- Day, Dusk and Night each read differently.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/colour.ts apps/web/src/features/scene/cesium/stylised/colour.test.ts apps/web/src/features/scene/cesium/stylised/lighting.ts apps/web/src/features/scene/cesium/stylised/lighting.test.ts apps/web/src/features/scene/cesium/stylised/palette.ts apps/web/src/features/scene/cesium/stylised/palette.test.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/stylised/props.ts apps/web/src/features/scene/cesium/stylised/props.test.ts apps/web/src/features/scene/cesium/stylised/fakeCesium.test-util.ts
git commit -m "feat(web): key, fill and bounce lighting with horizon fog for the stylised city" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 8: Quality tiers (pure) and post-processing, shadows, sky gradient

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/quality.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/quality.test.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/postfx.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/postfx.test.ts`
- Create: `apps/web/src/features/scene/sceneSettingsStore.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx` (apply postfx, transparent background)
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts` and `props.ts` (`shadows` option on primitives)
- Modify: `apps/web/src/features/scene/cesium/CesiumScene.tsx` (`contextOptions`, sky gradient background on the section)

**Interfaces:**
- Produces:
  - `quality.ts`: `type Tier = "high" | "medium" | "low"`, `TIERS: Record<Tier, TierSpec>`, `interface TierSpec { shadows: "soft" | "hard" | "off"; shadowMapSize: number; ao: "on" | "low" | "off"; bloom: boolean; maxPixelRatio: number; birds: number; clouds: number; detailRangeM: number }`, `pickTier(gpu: string | undefined, memGb: number | undefined): Tier`, `lowerTier(t: Tier): Tier`, `createFrameMonitor(onDrop: () => void, opts?): { sample(dtMs: number, moving: boolean): void }`
  - `sceneSettingsStore.ts`: `useSceneSettings` `{ motion: boolean; quality: "auto" | Tier; setMotion(v): void; setQuality(q): void }` persisted in `tl.motion`, `tl.quality`; `motion` defaults to `!prefersReducedMotion()`
  - `postfx.ts`: `applyPostFx(C, viewer, p: Palette, tier: TierSpec): void`, `skyCss(p: Palette): string`

- [ ] **Step 1: Write the failing tests**

`quality.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createFrameMonitor, lowerTier, pickTier, TIERS } from "./quality";

describe("quality tiers", () => {
  it("picks high for discrete GPUs, low for software, medium when unknown", () => {
    expect(pickTier("ANGLE (NVIDIA GeForce RTX 3060)", 16)).toBe("high");
    expect(pickTier("ANGLE (Intel(R) Iris(R) Xe Graphics)", 16)).toBe("medium");
    expect(pickTier("Google SwiftShader", 8)).toBe("low");
    expect(pickTier(undefined, 2)).toBe("low");
    expect(pickTier(undefined, undefined)).toBe("medium");
  });
  it("lowerTier steps down and stops at low", () => {
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("medium")).toBe("low");
    expect(lowerTier("low")).toBe("low");
  });
  it("tiers match the spec table", () => {
    expect(TIERS.high).toMatchObject({ shadows: "soft", shadowMapSize: 2048, ao: "on", maxPixelRatio: 2 });
    expect(TIERS.medium).toMatchObject({ shadows: "hard", shadowMapSize: 1024, ao: "low", maxPixelRatio: 1.5 });
    expect(TIERS.low).toMatchObject({ shadows: "off", ao: "off", bloom: false, maxPixelRatio: 1, clouds: 0 });
  });
  it("the monitor drops once after ~3 s of slow moving frames and ignores idle frames", () => {
    const onDrop = vi.fn();
    const m = createFrameMonitor(onDrop, { windowMs: 3000, minFps: 24 });
    for (let i = 0; i < 200; i++) m.sample(50, false); // idle: ignored
    expect(onDrop).not.toHaveBeenCalled();
    for (let i = 0; i < 70; i++) m.sample(50, true); // 20 fps for 3.5 s
    expect(onDrop).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) m.sample(50, true); // window restarted after a drop
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
```

`postfx.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { paletteFor } from "./palette";
import { applyPostFx, skyCss } from "./postfx";
import { TIERS } from "./quality";

function viewer() {
  const stage = () => ({ enabled: false, uniforms: {} as Record<string, number> });
  return {
    shadows: false,
    resolutionScale: 1,
    scene: {
      postProcessStages: { fxaa: stage(), ambientOcclusion: stage(), bloom: stage() },
      shadowMap: { softShadows: false, size: 0, maximumDistance: 0, darkness: 0 },
      requestRender: vi.fn(),
    },
  };
}
const C = {};

describe("applyPostFx", () => {
  it("high tier at dusk: soft shadows, AO, bloom, FXAA", () => {
    const v = viewer();
    applyPostFx(C as never, v as never, paletteFor("dusk"), TIERS.high);
    expect(v.shadows).toBe(true);
    expect(v.scene.shadowMap).toMatchObject({ softShadows: true, size: 2048, maximumDistance: 3000 });
    expect(v.scene.postProcessStages.ambientOcclusion.enabled).toBe(true);
    expect(v.scene.postProcessStages.bloom.enabled).toBe(true);
    expect(v.scene.postProcessStages.fxaa.enabled).toBe(true);
  });
  it("night never casts shadows; day never blooms; low tier disables everything costly", () => {
    const v = viewer();
    applyPostFx(C as never, v as never, paletteFor("night"), TIERS.high);
    expect(v.shadows).toBe(false);
    applyPostFx(C as never, v as never, paletteFor("day"), TIERS.high);
    expect(v.scene.postProcessStages.bloom.enabled).toBe(false);
    applyPostFx(C as never, v as never, paletteFor("dusk"), TIERS.low);
    expect(v.shadows).toBe(false);
    expect(v.scene.postProcessStages.ambientOcclusion.enabled).toBe(false);
    expect(v.scene.postProcessStages.bloom.enabled).toBe(false);
  });
  it("skyCss is a vertical gradient from the palette", () => {
    const p = paletteFor("dusk");
    expect(skyCss(p)).toBe(`linear-gradient(180deg, ${p.skyTop} 0%, ${p.horizon} 100%)`);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/quality.test.ts src/features/scene/cesium/stylised/postfx.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `quality.ts`**

```ts
export type Tier = "high" | "medium" | "low";

export interface TierSpec {
  shadows: "soft" | "hard" | "off";
  shadowMapSize: number;
  ao: "on" | "low" | "off";
  bloom: boolean;
  maxPixelRatio: number;
  birds: number;
  clouds: number;
  /** Small details (roof clutter, lamps, light pools) are drawn within this camera distance. */
  detailRangeM: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { shadows: "soft", shadowMapSize: 2048, ao: "on", bloom: true, maxPixelRatio: 2, birds: 5, clouds: 10, detailRangeM: 3000 },
  medium: { shadows: "hard", shadowMapSize: 1024, ao: "low", bloom: true, maxPixelRatio: 1.5, birds: 3, clouds: 6, detailRangeM: 1500 },
  low: { shadows: "off", shadowMapSize: 0, ao: "off", bloom: false, maxPixelRatio: 1, birds: 3, clouds: 0, detailRangeM: 0 },
};

const DISCRETE = /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|\brx \d|apple m\d (pro|max|ultra)/i;
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

export function pickTier(gpu: string | undefined, memGb: number | undefined): Tier {
  if (gpu && SOFTWARE.test(gpu)) return "low";
  if (memGb !== undefined && memGb <= 2) return "low";
  if (gpu && DISCRETE.test(gpu)) return "high";
  return "medium";
}

export const lowerTier = (t: Tier): Tier => (t === "high" ? "medium" : "low");

/** Median frame time over `windowMs` of camera movement; below `minFps` calls onDrop once per window. */
export function createFrameMonitor(onDrop: () => void, { windowMs = 3000, minFps = 24 } = {}) {
  let samples: number[] = [];
  let elapsed = 0;
  return {
    sample(dtMs: number, moving: boolean) {
      if (!moving || dtMs <= 0 || dtMs > 1000) return;
      samples.push(dtMs);
      elapsed += dtMs;
      if (elapsed < windowMs) return;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      samples = [];
      elapsed = 0;
      if (1000 / median < minFps) onDrop();
    },
  };
}

/** GPU name when the browser exposes it (WEBGL_debug_renderer_info). */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined): string | undefined {
  try {
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Implement `sceneSettingsStore.ts`**

```ts
import { create } from "zustand";
import type { Tier } from "./cesium/stylised/quality";

export type QualityChoice = "auto" | Tier;
const MOTION = "tl.motion";
const QUALITY = "tl.quality";

const read = (k: string) => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-viewer convenience only */
  }
};
export const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const storedMotion = read(MOTION);
const storedQuality = read(QUALITY);

interface SceneSettings {
  motion: boolean;
  quality: QualityChoice;
  setMotion: (v: boolean) => void;
  setQuality: (q: QualityChoice) => void;
}

export const useSceneSettings = create<SceneSettings>((set) => ({
  motion: storedMotion === null ? !prefersReducedMotion() : storedMotion === "true",
  quality: (["auto", "high", "medium", "low"] as const).includes(storedQuality as QualityChoice)
    ? (storedQuality as QualityChoice)
    : "auto",
  setMotion: (motion) => {
    write(MOTION, String(motion));
    set({ motion });
  },
  setQuality: (quality) => {
    write(QUALITY, quality);
    set({ quality });
  },
}));
```

- [ ] **Step 5: Implement `postfx.ts`**

```ts
import type * as Cesium from "cesium";
import type { Palette } from "./palette";
import type { TierSpec } from "./quality";

type Stage = { enabled: boolean; uniforms: Record<string, number | boolean> };
interface FxViewer {
  shadows: boolean;
  resolutionScale: number;
  scene: {
    postProcessStages: { fxaa: Stage; ambientOcclusion: Stage; bloom: Stage };
    shadowMap: { softShadows: boolean; size: number; maximumDistance: number; darkness: number };
    requestRender(): void;
  };
}

/** Display-only post-processing for the stylised city, per mood and quality tier. */
export function applyPostFx(_C: typeof Cesium, viewer: FxViewer, p: Palette, tier: TierSpec): void {
  const { scene } = viewer;
  const s = scene.postProcessStages;
  s.fxaa.enabled = true;

  const ao = s.ambientOcclusion;
  ao.enabled = tier.ao !== "off";
  Object.assign(ao.uniforms, {
    intensity: tier.ao === "low" ? 2.0 : 3.0,
    bias: 0.1,
    lengthCap: 0.26,
    stepSize: tier.ao === "low" ? 2.0 : 1.0,
    frustumLength: 1000,
    blurStepSize: 0.86,
    ambientOcclusionOnly: false,
  });

  const bloom = s.bloom;
  bloom.enabled = p.bloom && tier.bloom;
  Object.assign(bloom.uniforms, { glowOnly: false, contrast: 128, brightness: -0.3, delta: 1.0, sigma: 2.5, stepSize: 1.0 });

  viewer.shadows = p.shadows && tier.shadows !== "off";
  if (viewer.shadows) {
    scene.shadowMap.softShadows = tier.shadows === "soft";
    scene.shadowMap.size = tier.shadowMapSize;
    scene.shadowMap.maximumDistance = 3000;
    scene.shadowMap.darkness = 0.45;
  }

  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  viewer.resolutionScale = Math.min(dpr, tier.maxPixelRatio) / dpr;
  scene.requestRender();
}

export const skyCss = (p: Palette) => `linear-gradient(180deg, ${p.skyTop} 0%, ${p.horizon} 100%)`;
```

Note for the implementer: the shadow map follows `scene.light`, which `reskin` already sets from the palette. After Task 7, set it from `palette.light.keyDir` instead of `sun.dir` (change `sunLight` in `reskin.ts` to use `p.light.keyDir` and `p.light.key`).

- [ ] **Step 6: Wire it up**

- In `CesiumScene.tsx` add `contextOptions={{ webgl: { alpha: true } }}` to `<Viewer>`. For the stylised style, give the `<section>` `style={{ background: skyCss(paletteFor(theme)) }}`, reading `theme` from `useTheme`.
- In `StylisedCity.tsx` `applyStylisedLook`, set `scene.backgroundColor = Cesium.Color.TRANSPARENT` and keep restoring the previous value (it already does). In `reskin.ts`, stop writing `scene.backgroundColor` (delete the line).
- In `StylisedCity.tsx`, compute the tier from `useSceneSettings().quality`:
  - `"auto"` uses `pickTier(gpuName(viewer.scene.context._gl), navigator.deviceMemory)`. Use a `try` block and access `_gl` through `(viewer.scene as unknown as { context: { _gl?: WebGLRenderingContext } }).context._gl`.
  - Keep the automatic tier in state, and lower it through `createFrameMonitor`. Feed it from `viewer.scene.postRender` with `performance.now()` deltas, where `moving` is true while `viewer.camera` has changed within the last 300 ms (track it with `camera.changed`).
  - Call `applyPostFx(Cesium, viewer, paletteFor(theme), TIERS[tier])` in an effect on `[viewer, theme, tier]`.
  - On unmount, disable AO, bloom and shadows (restore the defaults).
- Primitives: pass `shadows: Cesium.ShadowMode.ENABLED` to the building primitives and `Cesium.ShadowMode.CAST_ONLY` to the tree primitives. Car primitives get `Cesium.ShadowMode.ENABLED`. Set `viewer.scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY`.

- [ ] **Step 7: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck`
Expected: PASS.

Manual check (Stylised, `?perf=1` once Task 17 exists; until then use DevTools' FPS meter):
- Contact darkening is visible where walls meet the ground.
- Buildings cast shadows by Day and Dusk.
- Windows glow at Dusk and Night.
- The sky gradient shows above the horizon.

Known risk: roads and water are ClassificationPrimitives painted over the globe, and shadows on the globe may not darken them. If the roads look unshadowed next to shadowed ground, record it as a quality note. Don't switch road rendering in this task.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/quality.ts apps/web/src/features/scene/cesium/stylised/quality.test.ts apps/web/src/features/scene/cesium/stylised/postfx.ts apps/web/src/features/scene/cesium/stylised/postfx.test.ts apps/web/src/features/scene/sceneSettingsStore.ts apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/stylised/props.ts apps/web/src/features/scene/cesium/stylised/reskin.ts apps/web/src/features/scene/cesium/stylised/reskin.test.ts apps/web/src/features/scene/cesium/CesiumScene.tsx
git commit -m "feat(web): shadows, ambient occlusion, bloom, sky gradient and quality tiers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 9: Palette-driven re-skin and the 2 s crossfade

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/crossfade.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/crossfade.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/reskin.ts` + `reskin.test.ts`
- Modify: `buildingsPrimitive.ts`, `ground.ts`, `props.ts` (`setTheme(t)` becomes `setPalette(p: Palette, final: boolean)`)
- Modify: `StylisedCity.tsx` (drive the fade)

**Interfaces:**
- Produces:
  - `interface Reskinnable { setPalette(p: Palette, final: boolean): void }`. `final` is true on the last frame of a fade. Ground switches its per-instance colours only when `final` is true or the fade passes its midpoint.
  - `reskinPalette(C, viewer, handles, p: Palette, at, final: boolean): void`
  - `startCrossfade(from: Palette, to: Palette, apply: (p: Palette, t: number) => void, opts?: { ms?: number; now?: () => number; raf?: (cb: () => void) => number; caf?: (id: number) => void; reduced?: boolean }): () => void` (returns cancel; `t` in [0, 1])

- [ ] **Step 1: Write the failing test**

`crossfade.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { startCrossfade } from "./crossfade";
import { paletteFor } from "./palette";

function clock() {
  let t = 0;
  const q: (() => void)[] = [];
  return {
    now: () => t,
    raf: (cb: () => void) => q.push(cb),
    caf: vi.fn(),
    step(ms: number) {
      t += ms;
      const run = q.splice(0);
      for (const cb of run) cb();
    },
  };
}

describe("startCrossfade", () => {
  it("applies intermediate palettes and ends exactly on the target", () => {
    const c = clock();
    const seen: number[] = [];
    const apply = vi.fn((_p, t: number) => seen.push(t));
    startCrossfade(paletteFor("day"), paletteFor("night"), apply, { ms: 2000, ...c });
    for (let i = 0; i < 25; i++) c.step(100);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(apply.mock.calls.at(-1)?.[0]).toEqual(paletteFor("night"));
    expect(seen.some((t) => t > 0.3 && t < 0.7)).toBe(true);
  });
  it("reduced motion applies the target once", () => {
    const apply = vi.fn();
    startCrossfade(paletteFor("day"), paletteFor("dusk"), apply, { reduced: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(paletteFor("dusk"), 1);
  });
  it("cancel stops further frames", () => {
    const c = clock();
    const apply = vi.fn();
    const cancel = startCrossfade(paletteFor("day"), paletteFor("night"), apply, { ms: 2000, ...c });
    c.step(100);
    cancel();
    const n = apply.mock.calls.length;
    c.step(100);
    expect(apply.mock.calls.length).toBe(n);
  });
});
```

Update `reskin.test.ts`:
- Call `reskinPalette(C, v, handles, paletteFor("day"), AT, true)`.
- Expect `setPalette` to be called with `(paletteFor("day"), true)`.
- Drop the `backgroundColor` assertion, which Task 8 removed.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/crossfade.test.ts src/features/scene/cesium/stylised/reskin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `crossfade.ts`**

```ts
import { lerpPalette, type Palette } from "./palette";

const ease = (t: number) => t * t * (3 - 2 * t);

export function startCrossfade(
  from: Palette,
  to: Palette,
  apply: (p: Palette, t: number) => void,
  {
    ms = 2000,
    now = () => performance.now(),
    raf = (cb: () => void) => requestAnimationFrame(cb),
    caf = (id: number) => cancelAnimationFrame(id),
    reduced = false,
  }: {
    ms?: number;
    now?: () => number;
    raf?: (cb: () => void) => number;
    caf?: (id: number) => void;
    reduced?: boolean;
  } = {},
): () => void {
  if (reduced || ms <= 0) {
    apply(to, 1);
    return () => {};
  }
  const t0 = now();
  let id = 0;
  let live = true;
  const frame = () => {
    if (!live) return;
    const t = Math.min(1, (now() - t0) / ms);
    apply(t >= 1 ? to : lerpPalette(from, to, ease(t)), t);
    if (t < 1) id = raf(frame);
  };
  apply(from, 0);
  id = raf(frame);
  return () => {
    live = false;
    caf(id);
  };
}
```

- [ ] **Step 4: Switch layers to `setPalette`**

- `reskin.ts`:
  - Rename `Reskinnable.setTheme` to `setPalette(p, final)`.
  - Add `reskinPalette(C, viewer, handles, p, at, final)`, which writes the globe base colour and fog, calls `h?.setPalette(p, final)`, sets `scene.light = sunLight(C, p, at)` (using `p.light.keyDir`, `p.light.key` and `p.light.keyIntensity * 2.5`), then requests a render.
  - Keep `reskin(C, viewer, handles, theme, at)` as a thin wrapper: `reskinPalette(C, viewer, handles, paletteFor(theme), at, true)`.
- `buildingsPrimitive.ts`: `setPalette(p)` does `Object.assign(m.uniforms, uniformsFor(C, p, at))` for each material.
- `props.ts`: `setPalette(p)` writes the colour and light uniforms, as in Task 7.
- `ground.ts`: `setPalette(p, final)` stores `want = p`, and calls `sync()` only when `final` is true (and also when called with a palette whose `road` equals the current target, so the midpoint switch works). The caller decides the midpoint: in `StylisedCity`, call `ground.setPalette(to, true)` once when the fade's `t >= 0.5`, and never pass intermediate palettes to the ground.
- Fix the ground and props tests that called `setTheme("day")`: call `setPalette(paletteFor("day"), true)` instead.

- [ ] **Step 5: Drive the fade in `StylisedCity.tsx`**

Replace the final `reskin` effect with:

```tsx
  const shown = useRef(paletteFor(useTheme.getState().theme));
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const to = paletteFor(theme);
    let groundDone = false;
    const cancel = startCrossfade(
      shown.current,
      to,
      (p, t) => {
        if (viewer.isDestroyed()) return;
        shown.current = p;
        reskinPalette(Cesium, viewer, [buildings.current, props.current], p, home, t >= 1);
        if (!groundDone && t >= 0.5) {
          groundDone = true;
          ground.current?.setPalette(to, true);
        }
      },
      { reduced: prefersReducedMotion() },
    );
    return cancel;
  }, [viewer, theme, home]);
```

Import `prefersReducedMotion` from `../../sceneSettingsStore`. Newly built layers (buildings, ground, props) are created with `paletteFor(useTheme.getState().theme)` as today, so a fade cancelled midway and a layer built mid-fade both end on the latest palette (Review Focus 4).

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck && pnpm lint`
Expected: PASS.

Manual check:
- Switching Day to Night in the theme menu fades smoothly over about 2 s, and the ground switches halfway.
- Toggling quickly ends on the last choice.
- With OS reduced motion on, it snaps.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/crossfade.ts apps/web/src/features/scene/cesium/stylised/crossfade.test.ts apps/web/src/features/scene/cesium/stylised/reskin.ts apps/web/src/features/scene/cesium/stylised/reskin.test.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/stylised/ground.ts apps/web/src/features/scene/cesium/stylised/ground.test.ts apps/web/src/features/scene/cesium/stylised/props.ts apps/web/src/features/scene/cesium/stylised/props.test.ts apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx
git commit -m "feat(web): two-second palette crossfade between moods" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 10: Parks data (display only)

**Files:**
- Modify: `data/scripts/build_buildings.py` (`--parks` mode)
- Modify: `data/scripts/tests/test_build_buildings.py` (find the existing test file with `ls data/scripts/tests`; add tests there)
- Modify: `apps/api/src/townshiplens_api/routes/core.py:171-249`
- Modify: `apps/api/tests/test_buildings_layer.py` (or the existing buildings-layer test file; find with `grep -rln "layers/buildings" apps/api/tests`)
- Modify: `apps/web/src/lib/api.ts` (type flows from the generated client)
- Generated: `packages/api-client/{openapi.json,src/schema.d.ts}`
- Data (separate commit): `data/seed/elmina/base/parks.geojson`
- Modify: `data/README.md`

**Interfaces:**
- Produces:
  - `build_buildings.py`: `parks_query_for(tile) -> str` and `build_parks(elements) -> list[dict]` (Polygon features with properties `{id, kind}`, where `kind` is one of `park|garden|playground|grass|recreation_ground`)
  - API: `BuildingsLayer.parks: dict[str, Any]` (an empty FeatureCollection when the file is absent)

- [ ] **Step 1: Write the failing Python tests**

Add to the build_buildings test file:

```python
from data.scripts import build_buildings as bb  # match the existing import style in this file


def test_parks_query_asks_for_park_like_ways_only():
    q = bb.parks_query_for((3.15, 101.46, 3.17, 101.48))
    assert 'way["leisure"~"^(park|garden|playground)$"]' in q
    assert 'way["landuse"~"^(grass|recreation_ground)$"]' in q
    assert "building" not in q


def test_build_parks_keeps_closed_rings_and_labels_kind():
    ring = [{"lon": 101.5, "lat": 3.18}, {"lon": 101.501, "lat": 3.18},
            {"lon": 101.501, "lat": 3.181}, {"lon": 101.5, "lat": 3.18}]
    els = [
        {"type": "way", "id": 1, "tags": {"leisure": "park"}, "geometry": ring},
        {"type": "way", "id": 2, "tags": {"landuse": "grass"}, "geometry": ring},
        {"type": "way", "id": 3, "tags": {"leisure": "park"}, "geometry": ring[:2]},  # open: dropped
    ]
    feats = bb.build_parks(els)
    assert [f["properties"]["kind"] for f in feats] == ["park", "grass"]
    assert feats[0]["geometry"]["type"] == "Polygon"
    assert feats[0]["properties"]["id"] == "way/1"
```

Add to the API buildings test:

```python
def test_buildings_layer_has_empty_parks_when_absent(client_with_buildings):
    r = client_with_buildings.get("/layers/buildings")
    assert r.status_code == 200
    assert r.json()["parks"] == {"type": "FeatureCollection", "features": []}
```

(Use the fixture name the existing tests use for a world with buildings; read the file first.)

- [ ] **Step 2: Run to see them fail**

Run: `uv run pytest data/scripts/tests -k parks -q && uv run pytest apps/api -k buildings -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `build_buildings.py` add:

```python
PARK_KINDS = ("park", "garden", "playground", "grass", "recreation_ground")


def parks_query_for(tile: tuple[float, float, float, float]) -> str:
    s, w, n, e = tile
    b = f"({s:.6f},{w:.6f},{n:.6f},{e:.6f})"
    return (
        "[out:json][timeout:180];("
        f'way["leisure"~"^(park|garden|playground)$"]{b};'
        f'way["landuse"~"^(grass|recreation_ground)$"]{b};'
        ");out geom tags;"
    )


def build_parks(elements: list[dict]) -> list[dict]:
    """Display-only park/green outlines for the stylised city (never used for any fact)."""
    out: list[dict] = []
    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        kind = tags.get("leisure") or tags.get("landuse")
        if kind not in PARK_KINDS:
            continue
        pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el.get("geometry") or []]
        if len(pts) < 4 or pts[0] != pts[-1]:
            continue
        out.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [pts]},
            "properties": {"id": f"way/{el['id']}", "kind": kind},
        })
    return out
```

In `main()`, add `ap.add_argument("--parks", action="store_true", help="only (re)build base/parks.geojson")`. After the dry-run block:

```python
    if args.parks:
        overpass.MAX_REQUESTS = args.max_requests
        try:
            els: list[dict] = []
            for tile in tiles(bbox, args.step):
                els.extend(overpass.query(parks_query_for(tile)).get("elements", []))
        except overpass.OverpassError as exc:
            print(f"BLOCKED: {exc}; overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
            raise SystemExit(2) from None
        parks = build_parks(els)
        text = _dump(parks)
        (OUT / "base").mkdir(parents=True, exist_ok=True)
        (OUT / "base" / "parks.geojson").write_text(text, encoding="utf-8", newline="\n")
        print(f"parks: {len(parks)}  {len(text.encode('utf-8'))} bytes")
        print(f"overpass HTTP requests this run: {overpass.REQUESTS_MADE}")
        return
```

In `core.py`:
- Add `parks: dict[str, Any] = {"type": "FeatureCollection", "features": []}` to `BuildingsLayer`, with the comment `# Display-only park/green outlines (OSM). Never a fact.`
- Add `p_path = data / "base" / "parks.geojson"`, and include `_mtime(p_path)` in the cache `key`.
- Pass `parks=_polygons_only(_read_collection(p_path))` to the payload.

- [ ] **Step 4: Run tests, regenerate the client**

Run: `uv run pytest -q && pnpm gen && git diff --stat packages/api-client`
Expected: tests PASS, and the client diff shows `parks` added.

- [ ] **Step 5: Commit the code**

```bash
git add data/scripts/build_buildings.py data/scripts/tests apps/api/src/townshiplens_api/routes/core.py apps/api/tests packages/api-client/openapi.json packages/api-client/src/schema.d.ts
git commit -m "feat(api): display-only park outlines in the buildings layer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

- [ ] **Step 6: Fetch the data (network, small)**

Run: `uv run python data/scripts/build_buildings.py --parks --dry-run`, then `uv run python data/scripts/build_buildings.py --parks --max-requests 40`.
Expected: `parks: N` with N > 0, and a request count ≤ 40. If Overpass blocks the request, record BLOCKED in the overnight log and continue. The ground task treats missing parks as an empty collection.

Add a "Parks (display only)" paragraph to `data/README.md`: it's the source query, it's not part of `pnpm data:build`, and it's never used for facts.

```bash
git add data/seed/elmina/base/parks.geojson data/README.md
git commit -m "data: OSM park outlines for the stylised city" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 11: Ground upgrade: asphalt, pavements and kerbs, road markings, parks, shoreline

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/lines.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/lines.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/ground.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/ground.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.ts` (+ test: new colour keys, ΔE water rule)
- Modify: `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx` (pass parks)

**Interfaces:**
- Consumes: `deltaE` (Task 7); `parks` FeatureCollection from `useBuildings()` (Task 10).
- Produces:
  - `lines.ts`: `offsetLine(coords: [number, number][], m: number): [number, number][]` (left side for positive `m`, lon/lat), `dashSegments(coords, dashM: number, gapM: number): [number, number][][]`
  - `Palette` additions: `pavement`, `kerb`, `roadMark`, `park`, `parkEdge`, `shore` (hex)
  - `buildGround(C, viewer, { roads, water, parks, palette })`, where `parks: WaterPolygon[]` (same ring shape), and `parksFromLayer(fc): WaterPolygon[]` (exported from `ground.ts`; same parsing as `waterFromLayer`)

- [ ] **Step 1: Write the failing tests**

`lines.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dashSegments, offsetLine } from "./lines";

const M = 111_320;

describe("offsetLine", () => {
  it("moves an eastward line north for a positive (left) offset", () => {
    const out = offsetLine([[101.5, 3.18], [101.51, 3.18]], 5);
    expect(out).toHaveLength(2);
    for (const [, lat] of out) expect((lat - 3.18) * M).toBeCloseTo(5, 1);
  });
  it("keeps a corner joined (miter) without exploding on sharp turns", () => {
    const out = offsetLine([[101.5, 3.18], [101.501, 3.18], [101.5, 3.1801]], 3);
    expect(out).toHaveLength(3);
    for (const [lon, lat] of out) {
      expect(Math.abs(lon - 101.5) * M).toBeLessThan(200);
      expect(Math.abs(lat - 3.18) * M).toBeLessThan(200);
    }
  });
});

describe("dashSegments", () => {
  it("cuts a 90 m line into 3 m dashes every 9 m", () => {
    const line: [number, number][] = [[101.5, 3.18], [101.5 + 90 / (M * Math.cos((3.18 * Math.PI) / 180)), 3.18]];
    const d = dashSegments(line, 3, 6);
    expect(d.length).toBe(10);
    const [a, b] = d[0]!;
    const len = Math.hypot((b![0] - a![0]) * M * Math.cos((3.18 * Math.PI) / 180), (b![1] - a![1]) * M);
    expect(len).toBeCloseTo(3, 1);
  });
});
```

Add to `palette.test.ts`:

```ts
import { deltaE } from "./colour";
  it("decorative water and shoreline stay far from the flood-scenario colour (deltaE > 25)", () => {
    for (const p of [day, dusk, night]) {
      expect(deltaE(p.water, WATER_COLOR)).toBeGreaterThan(25);
      expect(deltaE(p.shore, WATER_COLOR)).toBeGreaterThan(25);
    }
  });
  it("defines every ground colour", () => {
    for (const p of [day, dusk, night])
      for (const c of [p.pavement, p.kerb, p.roadMark, p.park, p.parkEdge, p.shore])
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
```

Add to `ground.test.ts` (using the existing fakes):

```ts
  it("draws pavements, kerbs and marks for residential/major roads, parks and shoreline", () => {
    const { C, primitives } = fakeCesium();
    const roads = [
      { id: "a", coords: [[101.5, 3.18], [101.51, 3.18]] as [number, number][], widthM: 10, kind: "major" as const },
      { id: "b", coords: [[101.5, 3.18], [101.5, 3.19]] as [number, number][], widthM: 2.5, kind: "footway" as const },
    ];
    const ring: [number, number][] = [[101.5, 3.18], [101.501, 3.18], [101.501, 3.181], [101.5, 3.18]];
    buildGround(C as never, viewerFake() as never, { roads, water: [[ring]], parks: [[ring]], palette: paletteFor("day") });
    const ids = primitives.flatMap((p) => ((p.options.geometryInstances as { options: { id: string } }[]) ?? []).map((g) => g.options.id.split(":")[0]));
    for (const k of ["road", "pavement", "kerb", "roadMark", "park", "parkEdge", "water", "shore"]) expect(ids).toContain(k);
    // the footway gets neither pavement nor kerb
    expect(ids.filter((k) => k === "pavement")).toHaveLength(2);
  });
```

(`viewerFake()` is whatever helper the existing ground tests use to build `{ scene: { groundPrimitives, postRender, requestRender } }`; reuse it.)

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/`
Expected: FAIL.

- [ ] **Step 3: Implement `lines.ts`**

```ts
/** Pure line helpers in lon/lat with local metric maths (display-only decoration). */
const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

type Pt = [number, number];

export function offsetLine(coords: Pt[], m: number): Pt[] {
  if (coords.length < 2) return coords.slice();
  const lat0 = coords[0]![1];
  const kx = Math.cos(lat0 * RAD) * M_PER_DEG;
  const xy = coords.map(([lon, lat]) => [lon * kx, lat * M_PER_DEG] as Pt);
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len]; // left of travel
  };
  const out: Pt[] = [];
  for (let i = 0; i < xy.length; i++) {
    const nPrev = i > 0 ? normal(xy[i - 1]!, xy[i]!) : null;
    const nNext = i < xy.length - 1 ? normal(xy[i]!, xy[i + 1]!) : null;
    let n: Pt;
    if (nPrev && nNext) {
      const sx = nPrev[0] + nNext[0];
      const sy = nPrev[1] + nNext[1];
      const sl = Math.hypot(sx, sy);
      // miter, limited to 2x the offset on sharp turns
      const cos = sl / 2;
      const scale = sl < 1e-6 ? 1 : Math.min(2, 1 / Math.max(cos, 0.5));
      n = sl < 1e-6 ? nPrev : [(sx / sl) * scale, (sy / sl) * scale];
    } else n = (nPrev ?? nNext)!;
    out.push([(xy[i]![0] + n[0] * m) / kx, (xy[i]![1] + n[1] * m) / M_PER_DEG]);
  }
  return out;
}

export function dashSegments(coords: Pt[], dashM: number, gapM: number): Pt[][] {
  const out: Pt[][] = [];
  const period = dashM + gapM;
  let pos = 0; // metres along the line where the current period started
  let walked = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[i + 1]!;
    const k = Math.cos(((y1 + y2) / 2) * RAD) * M_PER_DEG;
    const len = Math.hypot((x2 - x1) * k, (y2 - y1) * M_PER_DEG);
    if (len === 0) continue;
    const at = (d: number): Pt => {
      const f = (d - walked) / len;
      return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
    };
    while (pos < walked + len) {
      const a = Math.max(pos, walked);
      const b = Math.min(pos + dashM, walked + len);
      if (b > a + 0.01 && pos + dashM <= walked + len + 1e-6) out.push([at(a), at(b)]);
      if (pos + dashM > walked + len) break;
      pos += period;
    }
    walked += len;
  }
  return out;
}
```

- [ ] **Step 4: Implement the ground and palette changes**

Palette values (add to each):

```ts
// DAY
  pavement: "#d8cdc4", kerb: "#a89cb4", roadMark: "#f4efe6", park: "#a9d39a", parkEdge: "#7fb478", shore: "#cfe6df",
// DUSK
  pavement: "#c9aaa8", kerb: "#8a7598", roadMark: "#f3dccb", park: "#86b38a", parkEdge: "#5f9470", shore: "#9fc5c3",
// NIGHT
  pavement: "#2a2148", kerb: "#463a74", roadMark: "#6d5fa3", park: "#1f4a45", parkEdge: "#2c6158", shore: "#3c6e66",
```

Also set `road` to asphalt grey-violet: Day `#8f8a9e`, Dusk `#6f6684`, Night `#2f2a45`. Check that `water` passes the ΔE > 25 test in each mood. If it fails, darken or shift `water` towards teal (it must also stay a hue > 20° from `WATER_COLOR`, as in the existing test).

In `ground.ts`:
- Widen the part key to `"road" | "pavement" | "kerb" | "roadMark" | "park" | "parkEdge" | "water" | "shore"`.
- Add `parks: WaterPolygon[]` to the options, and export `parksFromLayer = waterFromLayer` (same parsing; a separate name for readability).
- Build order, bottom to top (each part `lowerToBottom` when added, so add them in **reverse** of the desired bottom-to-top order): add `roadMark`, `kerb`, `road`, `pavement`, `shore`, `water`, `parkEdge`, `park`. Draw order then ends up park → parkEdge → water → shore → pavement → road → kerb → roadMark, with every overlay line drawn on top of all of these.
- Geometry, using the same `CorridorGeometry` / `PolygonGeometry` constructors and `VOLUME_HALF_M` as today:
  - `pavement`: for each road with kind `residential` or `major`, two corridors along `offsetLine(r.coords, ±(r.widthM / 2 + 1))`, width 2.
  - `kerb`: two corridors along `offsetLine(r.coords, ±(r.widthM / 2))`, width 0.35.
  - `roadMark`: for `major` roads only, each segment of `dashSegments(r.coords, 3, 6)` as a corridor of width 0.25.
  - `park`: polygons from `parks`. `parkEdge`: a corridor along each park's outer ring, width 3.
  - `shore`: a corridor along each water polygon's outer ring, width 4.
- Colours come from `palette[key]`. `sync()` already works per key.

In `StylisedCity.tsx`:
- `const parks = useMemo(() => (data?.parks ? parksFromLayer(data.parks) : NO_WATER), [data]);`.
- Pass `parks` to `buildGround` and add it to that effect's dependencies.
- Extend the honesty comment to say that parks are decorative outlines.

- [ ] **Step 5: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck`
Expected: PASS.

Manual check:
- Roads are asphalt grey-violet, with lighter pavements and a kerb line.
- Major roads have white dashes.
- Parks are green with an edge.
- Lakes have a lighter shore.
- The night orange dash is gone.
- **Route, path-status and flood lines are still drawn on top everywhere**: ask the mock "Stroller route from Car Park B to the playground" and look along the route.
- Note the frame rate before and after in the overnight log.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/lines.ts apps/web/src/features/scene/cesium/stylised/lines.test.ts apps/web/src/features/scene/cesium/stylised/ground.ts apps/web/src/features/scene/cesium/stylised/ground.test.ts apps/web/src/features/scene/cesium/stylised/palette.ts apps/web/src/features/scene/cesium/stylised/palette.test.ts apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx
git commit -m "feat(web): asphalt roads, pavements and kerbs, road markings, parks and shoreline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

**Phase 2 gate:** run the full CI checklist, then take before/after screenshots (Day, Dusk, Night, Home + close-up + Whole township) with fps numbers in the overnight log, and show them to the owner.

---

# Phase 3: building shapes and props

### Task 12: Building geometry: parapet, ground floor, setback, smooth normals, window styles, six tones

**Files:**
- Modify: `apps/web/src/features/scene/cesium/stylised/model.ts` (tones and window style)
- Modify: `apps/web/src/features/scene/cesium/stylised/model.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsMesh.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsMesh.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts` (shader)
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.ts` (+ test: six wall/roof tones, shopfront colour)

**Interfaces:**
- Produces:
  - `model.ts`:
    - `type Tone = "t0" | "t1" | "t2" | "t3" | "t4" | "t5"`
    - `type WindowStyle = "grid" | "strip" | "curtain"`
    - `windowStyleFor(kind: string, floors: number): WindowStyle`. Curtain when floors ≥ 12; strip for `commercial|office|retail`; grid otherwise.
    - `Building.tone: Tone` and `Building.style: WindowStyle`
  - `buildingsMesh.ts`:
    - `GROUND_FLOOR_M = 4.2`, `PARAPET_M = 0.6`, `PARAPET_INSET_M = 0.3`, `SETBACK_MIN_FLOORS = 9`, `SETBACK_AT = 0.6`, `SETBACK_SCALE = 0.82`
    - `isConvex(ring): boolean`
    - `shrinkRing(ring, m): ring`
    - `meshBudget(ring, b): { vertices: number; indices: number }`
    - st encoding: `s0 = (toneIndex * 3 + styleIndex) * TONE_STRIDE + seed`. `t`: 0 at base, 1 at 4.2 m (ground floor), then `1 + (h − 4.2) / 3.2`. The flags are `t = -1` for the roof and `t = -2` for the parapet cap and inner face.
  - `Palette.wall` and `Palette.roof` become `Record<Tone, string>`, plus `shopfront: string` and `glassSky: [string, string]` (curtain-wall reflection gradient).

- [ ] **Step 1: Write the failing tests**

Add to `model.test.ts`:

```ts
import { windowStyleFor } from "./model";
  it("window style follows kind and height", () => {
    expect(windowStyleFor("residential", 4)).toBe("grid");
    expect(windowStyleFor("commercial", 4)).toBe("strip");
    expect(windowStyleFor("residential", 14)).toBe("curtain");
  });
  it("spreads buildings over six tones deterministically", () => {
    const fc = { type: "FeatureCollection", features: Array.from({ length: 600 }, (_, i) => ({
      type: "Feature", properties: { id: `b${i}`, height_m: 9 },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0.0001, 0], [0.0001, 0.0001], [0, 0]]] },
    })) };
    const tones = new Set(toBuildings(fc).buildings.map((b) => b.tone));
    expect(tones.size).toBe(6);
    expect(toBuildings(fc).buildings[7]!.tone).toBe(toBuildings(fc).buildings[7]!.tone);
  });
```

Add to `buildingsMesh.test.ts`, using the existing `triangulate` helper (an ear clipper or `fan`) that the file already uses:

```ts
import { GROUND_FLOOR_M, isConvex, meshBudget, PARAPET_M, shrinkRing } from "./buildingsMesh";

const square = (m: number): [number, number][] => {
  const d = m / 111_320;
  return [[101.5, 3.18], [101.5 + d, 3.18], [101.5 + d, 3.18 + d], [101.5, 3.18 + d], [101.5, 3.18]];
};

describe("building shapes", () => {
  it("isConvex / shrinkRing", () => {
    expect(isConvex(square(20).slice(0, 4))).toBe(true);
    const s = shrinkRing(square(20).slice(0, 4), 0.3);
    const w = (s[1]![0] - s[0]![0]) * 111_320 * Math.cos((3.18 * Math.PI) / 180);
    expect(w).toBeCloseTo(19.4, 0);
  });
  it("walls are split at the ground floor and the parapet rises above the roof", () => {
    const b = { ...buildingFixture(), height: 12, minHeight: 0, floors: 3, ring: square(20) };
    const mesh = buildMesh([b], triangulate);
    const ts = new Set(Array.from(mesh.st.filter((_, i) => i % 2 === 1)).map((t) => Math.round(t * 100) / 100));
    expect(ts.has(1)).toBe(true); // ground-floor line
    expect(ts.has(-1)).toBe(true); // roof
    expect(ts.has(-2)).toBe(true); // parapet
    const heights = heightsOf(mesh); // helper: ellipsoidal height of each vertex
    expect(Math.max(...heights)).toBeCloseTo(12 + PARAPET_M, 1);
    expect(heights.some((h) => Math.abs(h - GROUND_FLOOR_M) < 0.05)).toBe(true);
  });
  it("tall convex buildings get one setback; concave ones do not", () => {
    const tall = { ...buildingFixture(), height: 40, floors: 12, ring: square(30) };
    const m = buildMesh([tall], triangulate);
    expect(meshBudget(square(30).slice(0, 4), tall).vertices).toBe(m.positions.length / 3);
    const hs = heightsOf(m);
    expect(hs.some((h) => Math.abs(h - 40 * 0.6) < 0.1)).toBe(true);
  });
  it("vertex and index counts stay within the budget", () => {
    const b = { ...buildingFixture(), height: 12, floors: 3, ring: square(20) };
    const mesh = buildMesh([b], triangulate);
    const want = meshBudget(square(20).slice(0, 4), b);
    expect(mesh.positions.length / 3).toBe(want.vertices);
    expect(mesh.indices.length).toBeLessThanOrEqual(want.indices);
  });
});
```

Add two helpers in that test file if they aren't there yet:
- `buildingFixture()`, which returns a full `Building` (`tone: "t0"`, `style: "grid"`, `litSeed: 0.5`, …).
- `heightsOf(mesh)`, which converts each ECEF vertex to an ellipsoidal height. Approximate it as `|p| − |ecef(lon0, lat0, 0)|`, which is accurate to centimetres within a building.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/model.test.ts src/features/scene/cesium/stylised/buildingsMesh.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `model.ts` changes**

```ts
export type Tone = "t0" | "t1" | "t2" | "t3" | "t4" | "t5";
export const TONE_LIST: Tone[] = ["t0", "t1", "t2", "t3", "t4", "t5"];
export type WindowStyle = "grid" | "strip" | "curtain";
export const STYLE_LIST: WindowStyle[] = ["grid", "strip", "curtain"];

export function windowStyleFor(kind: string, floors: number): WindowStyle {
  if (floors >= 12) return "curtain";
  if (/^(commercial|office|retail)$/.test(kind)) return "strip";
  return "grid";
}
```

In `toBuildings`, replace the tone line with `tone: TONE_LIST[Math.min(5, Math.floor(hashUnit(id, "tone") * 6))]!,` and add `style: windowStyleFor(kind, floors)`. Compute `kind` and `floors` into locals first. Change `Building.tone` to `Tone` and add `style: WindowStyle`.

- [ ] **Step 4: Implement the mesh**

Rewrite `buildMesh` in `buildingsMesh.ts`. Keep `ecef`, `enuBasis`, `enuToEcef` and `cleanRing` unchanged, and add:

```ts
export const GROUND_FLOOR_M = 4.2;
export const PARAPET_M = 0.6;
export const PARAPET_INSET_M = 0.3;
export const SETBACK_MIN_FLOORS = 9;
export const SETBACK_AT = 0.6;
export const SETBACK_SCALE = 0.82;
const SMOOTH_MIN_VERTS = 12;
const SMOOTH_MAX_EDGE_M = 4;

const toneIndex = (t: Building["tone"]) => Number(t.slice(1));
const styleIndex = (s: Building["style"]) => ["grid", "strip", "curtain"].indexOf(s);

/** Floors coordinate t at height h above the building base (ground floor is taller). */
export const tAt = (h: number) => (h <= GROUND_FLOOR_M ? h / GROUND_FLOOR_M : 1 + (h - GROUND_FLOOR_M) / 3.2);

export function isConvex(ring: [number, number][]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const [cx, cy] = ring[(i + 2) % ring.length]!;
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-18) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Inset an open ring by ~m metres towards its centroid (exact for convex, close for mild concave). */
export function shrinkRing(ring: [number, number][], m: number): [number, number][] {
  const n = ring.length;
  const cx = ring.reduce((s, p) => s + p[0], 0) / n;
  const cy = ring.reduce((s, p) => s + p[1], 0) / n;
  const kx = Math.cos(cy * RAD) * M_PER_DEG;
  return ring.map(([x, y]) => {
    const dx = (x - cx) * kx;
    const dy = (y - cy) * M_PER_DEG;
    const d = Math.hypot(dx, dy) || 1;
    const f = Math.max(0, (d - m) / d);
    return [cx + (dx * f) / kx, cy + (dy * f) / M_PER_DEG];
  });
}

const hasSetback = (ring: [number, number][], b: Building) =>
  b.floors >= SETBACK_MIN_FLOORS && ring.length <= 12 && isConvex(ring);

/**
 * Per building (n = ring vertices):
 *   walls: n quads per band. Bands: ground floor, upper floors (or lower + upper with a setback),
 *     plus an outer parapet band. That is 4 vertices and 6 indices per quad.
 *   setback ledge: one roof-flagged ring triangulation (n verts, (n-2)*3 idx).
 *   parapet inner face: n quads. Parapet cap: n quads (thin ring between outer and inner).
 *   roof: n verts, (n-2)*3 idx.
 */
export function meshBudget(ring: [number, number][], b: Building) {
  const n = ring.length;
  const bands = (hasSetback(ring, b) ? 3 : 2) + 1; // ground, upper(s), outer parapet
  const quads = n * bands + n /* parapet inner */ + n /* parapet cap */;
  const ledge = hasSetback(ring, b) ? 1 : 0;
  return {
    vertices: quads * 4 + n * (1 + ledge),
    indices: quads * 6 + (n - 2) * 3 * (1 + ledge),
  };
}
```

Then implement `buildMesh` with this algorithm (pseudocode-free; write it out):
1. `rings = buildings.map(b => cleanRing(b.ring))`. Pre-size the arrays from the sum of `meshBudget`, skipping rings with fewer than 3 vertices.
2. Per building:
   - `lo = b.minHeight`, `top = b.height`, `gf = Math.min(top, lo + GROUND_FLOOR_M)`, `s0 = (toneIndex(b.tone) * 3 + styleIndex(b.style)) * TONE_STRIDE + Math.round(b.litSeed * 997)`.
   - `outer = ring`. `upperRing` is `ring` without a setback; with one, the walls above `lo + (top − lo) * SETBACK_AT` use `ring` scaled about its centroid by `SETBACK_SCALE` (use a `scaleRing` helper like `shrinkRing`, but proportional).
   - `wallBand(r, h0, h1, tFlag?)` emits one quad per edge exactly like today's wall loop: s advances by whole columns (`Math.max(1, Math.round(len / COL_M))`), t0 = `tAt(h0 - lo)`, t1 = `tAt(h1 - lo)`, or both equal to `tFlag` when given. It uses the outward normal. For smooth normals, when `r.length >= SMOOTH_MIN_VERTS` and every edge is ≤ `SMOOTH_MAX_EDGE_M`, each vertex's normal is the normalised average of the two adjacent edge normals.
   - Emit: `wallBand(outer, lo, gf)`; `wallBand(outer, gf, top)` without a setback, or `wallBand(outer, gf, sb)`, then a ledge (a roof-flagged triangulation of `outer` at height `sb`), then `wallBand(upperRing, sb, top)`.
   - Parapet: `wallBand(upperRing, top, top + PARAPET_M, -2)`. The inner face is `inner = shrinkRing(upperRing, PARAPET_INSET_M)`, emitted as quads from `top + PARAPET_M` down to `top` with the inward normal (negate the outward one) and t = -2. The cap is one quad per edge joining `upperRing[i], upperRing[j]` and `inner[j], inner[i]` at `top + PARAPET_M`, with the up normal and t = -2.
   - Roof at `top` from `inner`, triangulated in local metres exactly as today, with t = -1.
3. Return `{ positions, normals, st, indices }`, trimming indices as today.

- [ ] **Step 5: Shader and palette**

Palette: change `wall` and `roof` to six tones, and add `shopfront` and `glassSky`:

```ts
// DAY
  wall: { t0: "#f1d9c4", t1: "#d9d3f0", t2: "#f3c6cf", t3: "#e8e1d3", t4: "#c9dfe0", t5: "#f2e2b8" },
  roof: { t0: "#c27a5c", t1: "#7f86b8", t2: "#d07a8c", t3: "#8d8476", t4: "#5f8f8f", t5: "#b98a4a" },
  shopfront: "#3d2f6b", glassSky: ["#9fc6ea", "#eaf3fb"],
// DUSK
  wall: { t0: "#e3b49a", t1: "#a99ad6", t2: "#e7a2b4", t3: "#cfb3a3", t4: "#8fb0bd", t5: "#e8c08e" },
  roof: { t0: "#b4745e", t1: "#7f70b8", t2: "#cc6c86", t3: "#8a6f74", t4: "#4f7f8a", t5: "#b07a48" },
  shopfront: "#3d2f6b", glassSky: ["#c48fb0", "#f8cdb0"],
// NIGHT
  wall: { t0: "#4a3b82", t1: "#4f4590", t2: "#6a4377", t3: "#3f3a66", t4: "#36507a", t5: "#5a4a6a" },
  roof: { t0: "#8c76c6", t1: "#a98bd0", t2: "#d98ca8", t3: "#7a6fa8", t4: "#6f8fc0", t5: "#b496b8" },
  shopfront: "#140f2a", glassSky: ["#1f1838", "#3d2f6b"],
```

Shader (`WINDOW_SHADER` in `buildingsPrimitive.ts`):
- Decode `float cls = floor(st.s / STRIDE); float tone = floor(cls / 3.0); float style = cls - tone * 3.0;`.
- Pick the wall and roof colours from six uniforms: `wall0`…`wall5` and `roof0`…`roof5`. Use a small `vec3 pick6(float i, vec3 a, …)` helper with `if` chains.
- The roof is `st.t < -1.5`, so the parapet cap and inner face are a slightly darker roof colour (`roof * 0.85`). Use the roof colour for `-1.5 <= st.t < 0.0`.
- Ground floor (`st.t < 1.0`):
  - `style == 0.0` (homes): plain wall with one door cell. The door is where `fract(g.x) > 0.4 && fract(g.x) < 0.6 && g.t < 0.75` on cells with `tl_hash(vec2(cell.x, 0.0)) < 0.25`, coloured `shopfront`.
  - Otherwise: wide glazing (`f.y` between 0.15 and 0.85, `f.x` between 0.05 and 0.95) in the `shopfront` colour. At dusk and night it is lit with `litA * glow * 0.8`.
- Upper floors:
  - `style == 0.0`: today's punched grid.
  - `style == 1.0`: horizontal strips (`win = step(0.3, f.y) * step(f.y, 0.75)`, x unrestricted).
  - `style == 2.0`: curtain (`win = 1.0` except for thin mullions `step(0.06, f.x) * step(f.y, 0.94)`). The glass colour is `mix(glassSky0, glassSky1, clamp(st.t / 20.0, 0.0, 1.0))` by day, `darkWin` at night, and lit cells follow `litFrac` as today.
- Keep the distance fade, emission and fog logic from Task 7.

`uniformsFor` passes the six wall and six roof colours, `shopfront`, `glassSky0` and `glassSky1`. Update `buildingsPrimitive.test.ts` assertions on uniform names.

- [ ] **Step 6: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck`
Expected: PASS.

Manual check:
- Roof lips are visible.
- Shopfront bands run along commercial streets.
- Tall towers have a setback and curtain glass.
- Round towers look round.
- The first frame of the city still appears within about 3 s.
- The frame rate is no worse than 10% below the Phase 2 number.

If the build time doubles, record it and drop smooth normals first.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/model.ts apps/web/src/features/scene/cesium/stylised/model.test.ts apps/web/src/features/scene/cesium/stylised/buildingsMesh.ts apps/web/src/features/scene/cesium/stylised/buildingsMesh.test.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.test.ts apps/web/src/features/scene/cesium/stylised/palette.ts apps/web/src/features/scene/cesium/stylised/palette.test.ts
git commit -m "feat(web): parapets, shopfronts, setbacks, round towers and window styles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 13: Props: street lamps and light pools, roof clutter, two-tier trees, more car colours

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/roofs.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/roofs.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/props.ts` + `props.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/palette.ts` (+ test)
- Modify: `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx`

**Interfaces:**
- Consumes: `slotsAlong`-style seeding (props.ts), `hashUnit`, `TierSpec.detailRangeM` (Task 8).
- Produces:
  - `roofs.ts`: `interface RoofItem { lon: number; lat: number; z: number; kind: "ac" | "tank"; sizeM: number }`, `roofClutter(buildings: Building[], seed: string, { minAreaM2 = 250, max = 4000 } = {}): RoofItem[]`
  - `props.ts`: `streetLamps(roads: Road[], seed: string, { spacingM = 30, max = 3000 } = {}): Lamp[]` where `Lamp = { lon: number; lat: number }`; `Tree` gains `tier2: boolean`; `buildProps(C, { trees, cars, lamps, roofItems, palette, at, detailRangeM }, collection)`
  - Palette: `tree: [string, string, string]`, `car: [string, string, string, string, string]`, `lampPost: string`, `lampHead: string`, `lightPool: string`, `roofItem: string`

- [ ] **Step 1: Write the failing tests**

`roofs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { roofClutter } from "./roofs";

const b = (id: string, sizeM: number, floors = 4) => {
  const d = sizeM / 111_320;
  return {
    id, ring: [[101.5, 3.18], [101.5 + d, 3.18], [101.5 + d, 3.18 + d], [101.5, 3.18 + d], [101.5, 3.18]] as [number, number][],
    height: floors * 3.2 + 1, minHeight: 0, kind: "residential", tone: "t0" as const, style: "grid" as const,
    floors, perimeterM: sizeM * 4, cols: 8, litSeed: 0.3,
  };
};

describe("roofClutter", () => {
  it("only on roofs above the area threshold, sitting on the roof, deterministic", () => {
    const items = roofClutter([b("small", 10), b("big", 40)], "s");
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.z).toBeCloseTo(4 * 3.2 + 1, 5);
    expect(roofClutter([b("small", 10), b("big", 40)], "s")).toEqual(items);
    expect(roofClutter([b("small", 10)], "s")).toEqual([]);
  });
  it("respects the cap", () => {
    const many = Array.from({ length: 500 }, (_, i) => b(`b${i}`, 40));
    expect(roofClutter(many, "s", { max: 100 }).length).toBe(100);
  });
});
```

Add to `props.test.ts`:

```ts
import { streetLamps } from "./props";
  it("lamps line residential and major roads only, seeded", () => {
    const roads = [
      { id: "r", coords: [[101.5, 3.18], [101.51, 3.18]] as [number, number][], widthM: 6, kind: "residential" as const },
      { id: "f", coords: [[101.5, 3.18], [101.5, 3.19]] as [number, number][], widthM: 2.5, kind: "footway" as const },
    ];
    const lamps = streetLamps(roads, "s");
    expect(lamps.length).toBeGreaterThan(20);
    expect(lamps.every((l) => Math.abs(l.lat - 3.18) * 111_320 < 10)).toBe(true);
    expect(streetLamps(roads, "s")).toEqual(lamps);
  });
  it("decorative props are never pickable", () => {
    const { C, primitives } = fakeCesium();
    buildProps(C as never, { trees: [{ lon: 101.5, lat: 3.18, h: 6, tier2: true }], cars: [], lamps: [{ lon: 101.5, lat: 3.18 }], roofItems: [], palette: paletteFor("night"), at: { lon: 101.5, lat: 3.18 }, detailRangeM: 1500 });
    expect(primitives.length).toBeGreaterThan(0);
    for (const p of primitives) expect(p.options.allowPicking).toBe(false);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/roofs.test.ts src/features/scene/cesium/stylised/props.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `roofs.ts`**

```ts
import { cleanRing, isConvex, shrinkRing } from "./buildingsMesh";
import { type Building, hashUnit } from "./model";

export interface RoofItem {
  lon: number;
  lat: number;
  z: number;
  kind: "ac" | "tank";
  sizeM: number;
}

const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

function areaM2(ring: [number, number][]): number {
  const k = Math.cos(ring[0]![1] * RAD) * M_PER_DEG;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * k * ring[i]![1] * M_PER_DEG - ring[i]![0] * k * ring[j]![1] * M_PER_DEG;
  return Math.abs(a / 2);
}

/** Seeded AC boxes and water tanks on larger flat roofs (display only). */
export function roofClutter(
  buildings: Building[],
  seed: string,
  { minAreaM2 = 250, max = 4000 } = {},
): RoofItem[] {
  const out: { v: RoofItem; r: number }[] = [];
  for (const b of buildings) {
    const ring = cleanRing(b.ring);
    if (ring.length < 3 || !isConvex(ring)) continue;
    const area = areaM2(ring);
    if (area < minAreaM2) continue;
    const inner = shrinkRing(ring, 2.5);
    const n = Math.min(4, Math.floor(area / 250));
    for (let i = 0; i < n; i++) {
      const key = `${seed}:${b.id}:${i}`;
      const a = inner[Math.floor(hashUnit(key, "v") * inner.length)]!;
      const c = inner[Math.floor(hashUnit(key, "w") * inner.length)]!;
      const f = hashUnit(key, "f");
      const tank = hashUnit(key, "k") < 0.3;
      out.push({
        r: hashUnit(key, "cap"),
        v: {
          lon: a[0] + (c[0] - a[0]) * f,
          lat: a[1] + (c[1] - a[1]) * f,
          z: b.height,
          kind: tank ? "tank" : "ac",
          sizeM: tank ? 1.6 : 1.1 + hashUnit(key, "s") * 0.6,
        },
      });
    }
  }
  if (out.length <= max) return out.map((o) => o.v);
  return out.sort((x, y) => x.r - y.r).slice(0, max).map((o) => o.v);
}
```

(Export `isConvex` and `shrinkRing` from `buildingsMesh.ts`; Task 12 added them.)

- [ ] **Step 4: Implement the props changes**

Palette (add to each, and extend `tree` to three and `car` to five entries):

```ts
// DAY
  tree: ["#5fb88a", "#3b8c66", "#8cc66a"], car: ["#e0686a", "#5a8fd9", "#f4f1ea", "#f2c14e", "#4a4a5a"],
  lampPost: "#5a5280", lampHead: "#f4efe6", lightPool: "#000000", roofItem: "#b8b2c8",
// DUSK
  tree: ["#4f9a7a", "#2f7466", "#7aa860"], car: ["#e0686a", "#5a8fd9", "#f4f1ea", "#f2c14e", "#4a4a5a"],
  lampPost: "#3d2f6b", lampHead: "#ffd08a", lightPool: "#ffb86b", roofItem: "#9f8fb0",
// NIGHT
  tree: ["#2f8c7e", "#1d5a5f", "#3f7a5a"], car: ["#c8628c", "#4f78c8", "#d8c9a6", "#c9a24a", "#2a2a3a"],
  lampPost: "#2a2148", lampHead: "#ffcf7a", lightPool: "#f6a94a", roofItem: "#3f3a66",
```

`props.ts`:
- `streetLamps`: `slotsAlong(r, \`${seed}:lamp\`, spacingM)` on roads whose kind is `residential` or `major`, offset by `(n % 2 ? 1 : -1) * (r.widthM / 2 + 1.5)`, capped by `cap(…, max)`.
- Trees: when `tier2` is set (choose it in `streetTrees` / `treesToPoints` as `hashUnit(key, "t2") < 0.5`), add a second, smaller canopy instance at `h * 0.85` with radius `r * 0.7`. The tone index is `Math.floor(hashUnit(..., "tree") * 3)`.
- Cars: tone `0..4` from `Math.floor(hashUnit(key, "tone") * 5)`, and five car groups.
- Lamps:
  - A post is a cylinder (radius 0.08, length 4.5, centred at z 2.25), colour `lampPost`.
  - A head is a box (0.5 × 0.25 × 0.15 at z 4.5), colour `lampHead`. Its material is `litColorMaterial` with an added `emission` uniform: write a tiny variant source, `m.emission = color.rgb * glow;`, and set the uniform `glow = palette.glow`.
  - A light pool is a flat ellipse (`EllipseGeometry`, semi-axes 5 m, height 0.05) with a translucent material. Use `Material.fromType("Color", { color: Color.fromCssColorString(lightPool).withAlpha(0.35 * glow) })`, `MaterialAppearance({ translucent: true, flat: true })`, `asynchronous: true`, `allowPicking: false`. When `glow == 0` (Day), set `show = false` on the pool primitive.
- Roof items: boxes sized `sizeM` (tanks are cylinders radius `sizeM / 2`, height `sizeM`), placed at `z + sizeM / 2`, colour `roofItem`, with `shadows: ShadowMode.ENABLED`.
- Distance: wrap the lamp, pool and roof-item instances with `attributes: { distanceDisplayCondition: C.DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(new C.DistanceDisplayCondition(0, detailRangeM)) }`. When `detailRangeM === 0` (Low tier), don't build them at all.
- Add the new Cesium names to `PropsCesium` and to the fake (`EllipseGeometry`, `DistanceDisplayCondition`, `DistanceDisplayConditionGeometryInstanceAttribute`, `ShadowMode`, `Color.withAlpha`).
- `setPalette(p)` updates every material, sets the lamp `glow` uniform, sets the pool alpha, and sets `pool.show = p.glow > 0`.

`StylisedCity.tsx`:
- Compute `lamps = streetLamps(roads, PROPS_SEED)`.
- Compute `roofItems = roofClutter(parsed ? [...parsed.classes.values()].flat() : [], PROPS_SEED)`.
- Pass both, plus `at: home` and `detailRangeM: TIERS[tier].detailRangeM`, to `buildProps`. Add `tier` to that effect's dependencies.

- [ ] **Step 5: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck`
Expected: PASS.

Manual check:
- Lamps line the streets, and at Dusk and Night their heads glow with warm pools on the ground.
- Roofs show AC units and tanks.
- Trees have two tiers in three greens.
- There are five car colours.
- At the Whole township view the small details disappear: check the draw-call count via `?perf=1` (Task 17) or Spector.js.
- The draw-call budget stays under about 60.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/roofs.ts apps/web/src/features/scene/cesium/stylised/roofs.test.ts apps/web/src/features/scene/cesium/stylised/props.ts apps/web/src/features/scene/cesium/stylised/props.test.ts apps/web/src/features/scene/cesium/stylised/fakeCesium.test-util.ts apps/web/src/features/scene/cesium/stylised/palette.ts apps/web/src/features/scene/cesium/stylised/palette.test.ts apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx apps/web/src/features/scene/cesium/stylised/buildingsMesh.ts
git commit -m "feat(web): street lamps with light pools, roof clutter, two-tier trees, more car colours" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

**Phase 3 gate:** run the full CI checklist, take screenshots and fps numbers into the overnight log, and show them to the owner.

---

# Phase 4: motion and quality

### Task 14: The animation clock and Motion setting

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/motion/clock.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/motion/clock.test.ts`
- Modify: `apps/web/src/features/map-ui/SettingsPopover.tsx` (Motion and Quality sections)
- Modify: `apps/web/src/features/map-ui/SettingsPopover.dom.test.tsx`

**Interfaces:**
- Consumes: `useSceneSettings` (Task 8).
- Produces: `createMotionClock({ fps = 30, requestRender, onTick, now, raf, caf }): { setActive(active: boolean): void; time(): number; destroy(): void }`. `onTick(seconds)` runs at most `fps` times a second while active, `time()` is the seconds since creation, and nothing is scheduled while inactive. Also `motionActive({ enabled, visible, onScreen, reduced }): boolean`.

- [ ] **Step 1: Write the failing tests**

`clock.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMotionClock, motionActive } from "./clock";

function rafClock() {
  let t = 0;
  const q = new Map<number, () => void>();
  let id = 0;
  return {
    now: () => t,
    raf: (cb: () => void) => {
      q.set(++id, cb);
      return id;
    },
    caf: (i: number) => q.delete(i),
    frame(ms: number) {
      t += ms;
      const run = [...q.values()];
      q.clear();
      for (const cb of run) cb();
    },
    pending: () => q.size,
  };
}

describe("motion clock", () => {
  it("renders at most 30 times a second while active", () => {
    const c = rafClock();
    const requestRender = vi.fn();
    const clock = createMotionClock({ fps: 30, requestRender, onTick: vi.fn(), ...c });
    clock.setActive(true);
    for (let i = 0; i < 60; i++) c.frame(1000 / 60); // one second at 60 Hz
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(requestRender.mock.calls.length).toBeLessThanOrEqual(31);
  });
  it("schedules nothing while inactive", () => {
    const c = rafClock();
    const requestRender = vi.fn();
    const clock = createMotionClock({ requestRender, onTick: vi.fn(), ...c });
    clock.setActive(true);
    c.frame(16);
    clock.setActive(false);
    c.frame(16);
    expect(c.pending()).toBe(0);
    const n = requestRender.mock.calls.length;
    c.frame(1000);
    expect(requestRender.mock.calls.length).toBe(n);
  });
  it("motionActive needs enabled, visible, on screen and no reduced motion", () => {
    expect(motionActive({ enabled: true, visible: true, onScreen: true, reduced: false })).toBe(true);
    expect(motionActive({ enabled: true, visible: false, onScreen: true, reduced: false })).toBe(false);
    expect(motionActive({ enabled: true, visible: true, onScreen: false, reduced: false })).toBe(false);
    expect(motionActive({ enabled: false, visible: true, onScreen: true, reduced: false })).toBe(false);
    expect(motionActive({ enabled: true, visible: true, onScreen: true, reduced: true })).toBe(false);
  });
});
```

In `SettingsPopover.dom.test.tsx`, add a test: with the Cesium view active (mock `useEffectiveView` to return `"cesium"`, as the existing map-style tests do), the "Motion" radiogroup with "On" and "Off" and the "Quality" radiogroup with "Auto", "High", "Medium" and "Low" exist. Clicking "Off" sets `useSceneSettings.getState().motion` to false.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/motion/clock.test.ts src/features/map-ui/SettingsPopover.dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`clock.ts`:

```ts
export const motionActive = (s: { enabled: boolean; visible: boolean; onScreen: boolean; reduced: boolean }) =>
  s.enabled && s.visible && s.onScreen && !s.reduced;

/**
 * One loop for all decorative motion. The viewer keeps requestRenderMode; this asks for at most
 * `fps` renders a second while active and nothing otherwise.
 */
export function createMotionClock({
  fps = 30,
  requestRender,
  onTick,
  now = () => performance.now(),
  raf = (cb: () => void) => requestAnimationFrame(cb),
  caf = (id: number) => cancelAnimationFrame(id),
}: {
  fps?: number;
  requestRender: () => void;
  onTick: (seconds: number) => void;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
}) {
  const t0 = now();
  const minDt = 1000 / fps - 0.5;
  let last = -Infinity;
  let id = 0;
  let active = false;
  const frame = () => {
    if (!active) return;
    const t = now();
    if (t - last >= minDt) {
      last = t;
      onTick((t - t0) / 1000);
      requestRender();
    }
    id = raf(frame);
  };
  return {
    setActive(a: boolean) {
      if (a === active) return;
      active = a;
      if (a) id = raf(frame);
      else caf(id);
    },
    time: () => (now() - t0) / 1000,
    destroy() {
      active = false;
      caf(id);
    },
  };
}
```

`SettingsPopover.tsx` (inside `effective === "cesium"`, after Camera controls):

```tsx
              <div>
                <h3 className={H}>Motion</h3>
                <div role="radiogroup" aria-label="Motion" className="grid grid-cols-2 gap-2">
                  <Radio checked={motion} onClick={() => setMotion(true)}>On</Radio>
                  <Radio checked={!motion} onClick={() => setMotion(false)}>Off</Radio>
                </div>
              </div>
              <div>
                <h3 className={H}>Quality</h3>
                <div role="radiogroup" aria-label="Quality" className="grid grid-cols-4 gap-2">
                  {(["auto", "high", "medium", "low"] as const).map((q) => (
                    <Radio key={q} checked={quality === q} onClick={() => setQuality(q)}>
                      {q[0]!.toUpperCase() + q.slice(1)}
                    </Radio>
                  ))}
                </div>
              </div>
```

with `const { motion, quality, setMotion, setQuality } = useSceneSettings();`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @tl/web exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/motion/clock.ts apps/web/src/features/scene/cesium/stylised/motion/clock.test.ts apps/web/src/features/map-ui/SettingsPopover.tsx apps/web/src/features/map-ui/SettingsPopover.dom.test.tsx
git commit -m "feat(web): capped animation clock with Motion and Quality settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 15: Birds, clouds and cloud shadows

**Files:**
- Create: `apps/web/src/features/scene/cesium/stylised/motion/flocks.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/motion/flocks.test.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/motion/sky.ts`
- Create: `apps/web/src/features/scene/cesium/stylised/motion/sky.test.ts`
- Modify: `apps/web/src/features/scene/cesium/stylised/lighting.ts` (cloud-shadow GLSL + `time` / `cloudShadow` uniforms)
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts` (apply cloud shadow)
- Modify: `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx` (mount sky, clock)

**Interfaces:**
- Consumes: `createMotionClock`, `motionActive` (Task 14); `TierSpec.birds` / `clouds` (Task 8); `hashUnit`.
- Produces:
  - `flocks.ts`:
    - `interface Loop { cx: number; cy: number; rx: number; ry: number; z: number; period: number; phase: number }` (metres east/north of `at`, seconds)
    - `flockLoops(at, anchors: [number, number][], n: number, seed: string): Loop[]`, where the anchors are park or water centroids. Without anchors, use `at`.
    - `loopPoint(l: Loop, tSec: number): [east, north, up]`
    - `cloudSpots(n, seed, extentM): { x: number; y: number; z: number; scale: number }[]`
    - `cloudOffset(tSec: number, speedMps = 3, extentM): [dx, dy]`, which wraps
  - `sky.ts`: `buildSky(C, viewer, { at, loops, clouds, palette, birdsPerFlock }) => { setPalette(p): void; tick(t: number): void; setVisible(birds: boolean, clouds: boolean): void; destroy(): void }`
  - `lighting.ts`: `CLOUD_GLSL` with `float tl_cloud(vec3 positionWC)`, plus the uniforms `time`, `cloudShadow` (0 to 0.15) and `cloudOrigin` (vec3).

- [ ] **Step 1: Write the failing tests**

`flocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cloudOffset, cloudSpots, flockLoops, loopPoint } from "./flocks";

const AT = { lon: 101.51, lat: 3.18 };

describe("flocks", () => {
  it("loops are closed, 40-90 m up, deterministic", () => {
    const loops = flockLoops(AT, [[101.511, 3.181]], 4, "s");
    expect(loops).toHaveLength(4);
    expect(flockLoops(AT, [[101.511, 3.181]], 4, "s")).toEqual(loops);
    for (const l of loops) {
      expect(l.z).toBeGreaterThanOrEqual(40);
      expect(l.z).toBeLessThanOrEqual(90);
      const a = loopPoint(l, 0);
      const b = loopPoint(l, l.period);
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
    }
  });
  it("clouds sit 250-400 m up and drift with wrap-around", () => {
    for (const c of cloudSpots(8, "s", 4000)) {
      expect(c.z).toBeGreaterThanOrEqual(250);
      expect(c.z).toBeLessThanOrEqual(400);
    }
    const [dx] = cloudOffset(10_000, 3, 4000);
    expect(Math.abs(dx)).toBeLessThanOrEqual(4000);
  });
});
```

`sky.test.ts` (fake Cesium as in `props.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { fakeCesium } from "../fakeCesium.test-util";
import { paletteFor } from "../palette";
import { buildSky } from "./sky";

describe("buildSky", () => {
  it("birds and clouds are not pickable and cast no shadows; night hides them", () => {
    const { C, primitives } = fakeCesium();
    const sky = buildSky(C as never, { scene: { primitives: { add: (p: unknown) => p, remove: () => true }, requestRender: () => {} } } as never, {
      at: { lon: 101.51, lat: 3.18 },
      loops: [{ cx: 0, cy: 0, rx: 100, ry: 60, z: 60, period: 40, phase: 0 }],
      clouds: [{ x: 0, y: 0, z: 300, scale: 1 }],
      palette: paletteFor("day"),
      birdsPerFlock: 7,
    });
    expect(primitives.length).toBeGreaterThan(0);
    for (const p of primitives) {
      expect(p.options.allowPicking).toBe(false);
      expect(p.options.shadows ?? 0).toBe(0); // ShadowMode.DISABLED
    }
    sky.setPalette(paletteFor("night"));
    expect(primitives.every((p) => (p as unknown as { show: boolean }).show === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/motion/`
Expected: FAIL.

- [ ] **Step 3: Implement `flocks.ts`**

```ts
import { hashUnit } from "../model";

const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

export interface Loop {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  z: number;
  period: number;
  phase: number;
}

export function flockLoops(
  at: { lon: number; lat: number },
  anchors: [number, number][],
  n: number,
  seed: string,
): Loop[] {
  const kx = Math.cos(at.lat * RAD) * M_PER_DEG;
  const pts = anchors.length > 0 ? anchors : [[at.lon, at.lat] as [number, number]];
  return Array.from({ length: n }, (_, i) => {
    const key = `${seed}:flock:${i}`;
    const [lon, lat] = pts[Math.floor(hashUnit(key, "a") * pts.length)]!;
    return {
      cx: (lon - at.lon) * kx,
      cy: (lat - at.lat) * M_PER_DEG,
      rx: 80 + hashUnit(key, "rx") * 120,
      ry: 50 + hashUnit(key, "ry") * 80,
      z: 40 + hashUnit(key, "z") * 50,
      period: 35 + hashUnit(key, "p") * 25,
      phase: hashUnit(key, "ph") * Math.PI * 2,
    };
  });
}

/** Smooth closed loop (ellipse with a gentle figure-eight wobble and bob). */
export function loopPoint(l: Loop, tSec: number): [number, number, number] {
  const a = (tSec / l.period) * Math.PI * 2 + l.phase;
  return [
    l.cx + l.rx * Math.cos(a),
    l.cy + l.ry * Math.sin(a) + 0.2 * l.ry * Math.sin(2 * a),
    l.z + 3 * Math.sin(3 * a),
  ];
}

export function cloudSpots(n: number, seed: string, extentM: number) {
  return Array.from({ length: n }, (_, i) => {
    const key = `${seed}:cloud:${i}`;
    return {
      x: (hashUnit(key, "x") - 0.5) * extentM,
      y: (hashUnit(key, "y") - 0.5) * extentM,
      z: 250 + hashUnit(key, "z") * 150,
      scale: 0.7 + hashUnit(key, "s") * 0.8,
    };
  });
}

/** Drift east-north-east at `speedMps`, wrapping within [-extent/2, extent/2]. */
export function cloudOffset(tSec: number, speedMps = 3, extentM = 4000): [number, number] {
  const wrap = (v: number) => ((((v + extentM / 2) % extentM) + extentM) % extentM) - extentM / 2;
  return [wrap(tSec * speedMps * 0.92), wrap(tSec * speedMps * 0.38)];
}
```

- [ ] **Step 4: Implement `sky.ts` and the cloud shadow**

`sky.ts`:
- **Shared animated vertex shader** (exported as `ANIMATED_VS`). A copy of Cesium 1.146's `TexturedMaterialAppearanceVS` with one displacement line. It uses the built-in `czm_frameNumber` as its clock (frames only advance while rendering, so motion freezes for free when the loop is paused):

```glsl
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;
void main() {
  vec4 p = czm_computePosition();
  float t = czm_frameNumber / 30.0;
#ifdef TL_BIRD
  // st.s: -1 left wing tip, 0 body, +1 right wing tip; st.t: bird index. Local frame: z is up.
  p.z += abs(st.s) * sin(t * 12.0 + st.t * 1.7) * 0.6;
#endif
#ifdef TL_SWAY
  // st.t runs 0 (bottom) to 1 (top) on the canopy ellipsoid: sway grows towards the top.
  vec3 up = normalize(position3DHigh + position3DLow);
  vec3 side = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
  float phase = fract(position3DHigh.x * 0.013) * 6.2831;
  p.xyz += side * sin(t * 1.3 + phase) * 0.25 * st.t * st.t;
#endif
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_st = st;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
```

  Build each variant with `"#define TL_BIRD\n" + ANIMATED_VS` or `"#define TL_SWAY\n" + ANIMATED_VS`, and pass it as `new C.MaterialAppearance({ material, flat: true, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, vertexShaderSource })`. The geometry must carry `st` (`vertexFormat: TEXTURED.vertexFormat`). Check the attribute names against `node_modules/cesium/Source/Shaders/Appearances/TexturedMaterialAppearanceVS.glsl` and match them exactly.
- **Birds:** one `Primitive` per **flock** (3–5 in total), each with `modelMatrix = eastNorthUpToFixedFrame(at) × translate(loopPoint(loop, t)) × rotateZ(tangent heading)`, updated on every `tick(t)`. Each flock holds 5–9 birds at fixed seeded local offsets (±6 m). The bird geometry is a custom 4-triangle `Geometry` (body ridge plus two wings, about 0.9 m wingspan) with `st.s` = −1 / 0 / +1 at left tip / body / right tip and `st.t` = bird index. The appearance uses the `TL_BIRD` vertex shader, so the wings really flap. The colour is a dark violet-grey in all moods (`mixHex(palette.light.fill, "#2a2148", 0.5)`).
- **Clouds:** one `Primitive` per cloud (6–10 in total). Each is 3–5 flattened `EllipsoidGeometry` puffs at seeded offsets, using `litColorMaterial(C, "#ffffff", …)` with an extra `alpha 0.92` (translucent `MaterialAppearance`). Each tick, set `modelMatrix` to `eastNorthUpToFixedFrame(at)` × the translation `(x + dx, y + dy, z)` from `cloudOffset`.
- `shadows: C.ShadowMode.DISABLED` and `allowPicking: false` on everything.
- `setPalette(p)`: hide everything when `p.glow >= 1` (Night). Clouds get `p.light.key` mixed into white for the dusk tint.
- `setVisible(birds, clouds)` follows the tier (Low: 0 clouds) and the Motion setting.

`lighting.ts`, added to `LIGHTING_GLSL`:

```glsl
float tl_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** 1.0 = no shadow; down to 1.0 - cloudShadow under a passing cloud. */
float tl_cloud(vec3 positionWC) {
  vec2 p = (positionWC.xy - cloudOrigin.xy) / 350.0 - vec2(time * 0.008, time * 0.003);
  float n = tl_noise(p) * 0.6 + tl_noise(p * 2.1) * 0.4;
  return 1.0 - cloudShadow * smoothstep(0.55, 0.8, n);
}
```

Add uniforms `time: 0`, `cloudShadow: p.glow >= 1 ? 0 : 0.15` and `cloudOrigin` (the ECEF position of `at`) to `lightUniforms`. In the building shader and `LIT_COLOR_SOURCE`, multiply the diffuse by `tl_cloud(positionWC)`, where `vec3 positionWC = (czm_inverseView * vec4(-materialInput.positionToEyeEC, 1.0)).xyz;`.

Note: the ECEF xy plane is not the local ground plane, but over a 5 km township the distortion is invisible for soft noise. Accept it.

- [ ] **Step 5: Mount in `StylisedCity.tsx`**

- Build the sky after details are shown (like the props):
  - `loops = flockLoops(home, parkCentroids, TIERS[tier].birds, PROPS_SEED)`, where `parkCentroids` is the first vertex of each park ring, or water when there are no parks.
  - `clouds = cloudSpots(TIERS[tier].clouds, PROPS_SEED, 5000)`.
- Create one motion clock per viewer:
  - `onTick = (t) => { sky.tick(t); for (const m of [buildingMaterials, propMaterials]) m.uniforms.time = t; }`. Expose a `setTime(t)` on the buildings and props handles that writes the `time` uniform on their materials.
  - `requestRender = () => viewer.scene.requestRender()`.
- Activity:
  - `setActive(motionActive({ enabled: motion, visible: document.visibilityState === "visible", onScreen, reduced: prefersReducedMotion() }))`.
  - Re-evaluate it on `visibilitychange`, on an `IntersectionObserver` on `viewer.container`, and when `motion` changes.
- With motion off: `sky.setVisible(false, true)` (birds hidden, clouds frozen where they are).
- Destroy the clock and the sky on unmount.

- [ ] **Step 6: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck`
Expected: PASS.

Manual check:
- Day: flocks circle over the parks, clouds drift, and soft shadow patches move across roofs.
- Dusk: tinted clouds.
- Night: no birds or clouds.
- Motion Off: birds gone, clouds still.
- Switching to another browser tab drops the GPU usage, seen in DevTools Performance as no frames while hidden.
- fps with motion on is ≥ 30 on the dev laptop at Medium.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/motion/ apps/web/src/features/scene/cesium/stylised/lighting.ts apps/web/src/features/scene/cesium/stylised/lighting.test.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/stylised/props.ts apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx apps/web/src/features/scene/cesium/stylised/fakeCesium.test-util.ts
git commit -m "feat(web): decorative birds, drifting clouds and cloud shadows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 16: Ambient motion: tree sway, water shimmer, lamp fade, window flicker

**Files:**
- Modify: `apps/web/src/features/scene/cesium/stylised/props.ts` (tree sway)
- Modify: `apps/web/src/features/scene/cesium/stylised/ground.ts` (shimmer on base water only)
- Modify: `apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts` (night window flicker)
- Modify: `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx` (lamp fade)
- Test: `props.test.ts`, `ground.test.ts`, `buildingsPrimitive.test.ts`

**Interfaces:**
- Consumes: the `time` uniform (Task 15); `setPalette` (Task 9).
- Produces:
  - `ground.ts`: `buildGround(...)` returns `{ setPalette, setTime(t: number), destroy }`. Only the `water` part uses `WATER_SHIMMER_GLSL`.
  - `WINDOW_SHADER` uses `time` to flip about 3% of lit windows every 20 s at night.
  - Canopy primitives use `"#define TL_SWAY\n" + ANIMATED_VS` (Task 15).

- [ ] **Step 1: Write the failing tests**

Add to `ground.test.ts`:

```ts
  it("only base water shimmers; flood layers are never touched by this module", () => {
    const { C, primitives } = fakeCesium();
    const g = buildGround(C as never, viewerFake() as never, { roads: [road()], water: [[ring()]], parks: [], palette: paletteFor("day") });
    const water = primitives.find((p) => (p.options.geometryInstances as { options: { id: string } }[])[0]?.options.id.startsWith("water:"));
    const others = primitives.filter((p) => p !== water);
    expect(water?.options.appearance).toHaveProperty("options.material.uniforms.time");
    for (const p of others) expect(JSON.stringify(p.options.appearance ?? {})).not.toContain("shimmer");
    g.setTime(5);
  });
```

Water now needs a material, so it can no longer be a `ClassificationPrimitive` with `PerInstanceColorAppearance`. Change the water part to a `GroundPrimitive` over the small number of lake polygons only. Its appearance is `EllipsoidSurfaceAppearance({ material })`, and the material is a fabric with the `color`, `shoreColor` and `time` uniforms. Roads stay as `ClassificationPrimitive`. A handful of lakes costs nothing next to the 16k road volumes the `ground.ts` comment warns about. Set `classificationType: TERRAIN` and `allowPicking: false`. The fake needs `GroundPrimitive` and `EllipsoidSurfaceAppearance` (the latter exists already). The test helper `ring()` returns a closed square ring, and `road()` returns a residential road.

Add to `props.test.ts`:

```ts
  it("only canopies get the swaying vertex shader", () => {
    const { C, primitives } = fakeCesium();
    buildProps(C as never, { trees: [{ lon: 101.5, lat: 3.18, h: 6, tier2: false }], cars: [{ lon: 101.5, lat: 3.18, headingRad: 0, tone: 0 }], lamps: [], roofItems: [], palette: paletteFor("day"), at: { lon: 101.5, lat: 3.18 }, detailRangeM: 1500 });
    const vs = (p: (typeof primitives)[number]) =>
      String((p.options.appearance as { options?: { vertexShaderSource?: string } })?.options?.vertexShaderSource ?? "");
    const swaying = primitives.filter((p) => vs(p).includes("TL_SWAY"));
    expect(swaying.length).toBe(2); // two canopy tones present in the fixture palette groups
    expect(primitives.filter((p) => !swaying.includes(p)).every((p) => !vs(p).includes("TL_SWAY"))).toBe(true);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/stylised/`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Tree sway.** Give the two canopy primitives the `TL_SWAY` variant of `ANIMATED_VS` (from `motion/sky.ts`, Task 15) as their `vertexShaderSource`. Build the canopy `EllipsoidGeometry` with `vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat`, so `st` exists (its `t` runs bottom to top). Trunks don't sway. Tag the canopy materials with a `swayAmp: 0.25` uniform (documentation only; the amplitude lives in the shader) so the test can find them.
- **Water shimmer:**

```glsl
czm_material czm_getMaterial(czm_materialInput mi) {
  czm_material m = czm_getDefaultMaterial(mi);
  vec2 p = mi.st * 40.0;
  float w = sin(p.x * 1.7 + time * 0.8) * sin(p.y * 1.3 - time * 0.6);
  m.diffuse = mix(color.rgb, shoreColor.rgb, 0.12 + 0.08 * w);
  return m;
}
```

  Uniforms: `color` = `palette.water`, `shoreColor` = `palette.shore`, `time`. `setPalette` updates both colours, and `setTime(t)` writes `time`.
- **Window flicker** in `WINDOW_SHADER`: change `isLit` to `float epoch = floor(time / 20.0); float flip = step(0.97, tl_hash(cell + epoch * 13.0)) * glow; float isLit = abs(step(tl_hash(cell), litFrac) - flip);`. With `glow == 0` (Day) nothing flips.
- **Lamp fade.** In the crossfade `apply` (Task 9), the lamp `glow` and pool alpha already follow `p.glow`. The 2 s mood fade therefore covers "fade on over about 3 s at dusk". Extend the crossfade duration to 3000 ms when either end is Dusk and the other is Day. Pass `ms` from `StylisedCity`: `(theme === "dusk" && shownTheme === "day") || (theme === "day" && shownTheme === "dusk") ? 3000 : 2000`.
- Wire `ground.setTime` into the motion clock's `onTick`.

- [ ] **Step 4: Run tests and look at it**

Run: `pnpm --filter @tl/web exec vitest run && pnpm --filter @tl/web typecheck && pnpm lint`
Expected: PASS.

Manual check:
- The lake shimmers gently.
- **A flood scenario (River level +3 m in settings) shows no shimmer** on the flood layer.
- At Night a window occasionally switches.
- Lamps fade in over Day to Dusk.
- Leaves shimmer.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scene/cesium/stylised/props.ts apps/web/src/features/scene/cesium/stylised/props.test.ts apps/web/src/features/scene/cesium/stylised/ground.ts apps/web/src/features/scene/cesium/stylised/ground.test.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.ts apps/web/src/features/scene/cesium/stylised/buildingsPrimitive.test.ts apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx apps/web/src/features/scene/cesium/stylised/fakeCesium.test-util.ts
git commit -m "feat(web): leaf shimmer, base-water ripple, lamp fade and night window flicker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 17: Perf overlay, auto tier drop and the List-view offer

**Files:**
- Create: `apps/web/src/features/scene/cesium/PerfOverlay.tsx`
- Create: `apps/web/src/features/scene/cesium/PerfOverlay.dom.test.tsx`
- Modify: `apps/web/src/features/scene/cesium/CesiumScene.tsx`
- Modify: `apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx` (report the tier and fps; the low-fps offer)

**Interfaces:**
- Consumes: `createFrameMonitor`, `lowerTier`, `Tier` (Task 8); `useScene().setView` (existing).
- Produces:
  - `usePerfStats` (a zustand store `{ fps: number; frameMs: number; drawCalls: number; tier: Tier; update(p: Partial<…>): void }`)
  - `<PerfOverlay />` rendered only when `location.search` includes `perf=1`
  - A `role="status"` banner, "The 3D map is running slowly on this device." with a "Use the list view" button. It's shown when the tier is already Low and the median stays under 15 fps for a monitor window.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PerfOverlay, usePerfStats } from "./PerfOverlay";

describe("PerfOverlay", () => {
  it("renders nothing without ?perf=1", () => {
    window.history.replaceState(null, "", "/");
    const { container } = render(<PerfOverlay />);
    expect(container.textContent).toBe("");
  });
  it("shows fps, frame time, draw calls and tier with ?perf=1", () => {
    window.history.replaceState(null, "", "/?perf=1");
    usePerfStats.getState().update({ fps: 42, frameMs: 23.8, drawCalls: 51, tier: "medium" });
    render(<PerfOverlay />);
    expect(screen.getByText(/42 fps/)).toBeInTheDocument();
    expect(screen.getByText(/51 draws/)).toBeInTheDocument();
    expect(screen.getByText(/medium/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @tl/web exec vitest run src/features/scene/cesium/PerfOverlay.dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { create } from "zustand";
import type { Tier } from "./stylised/quality";

interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  tier: Tier;
  update: (p: Partial<Omit<PerfStats, "update">>) => void;
}

export const usePerfStats = create<PerfStats>((set) => ({
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  tier: "medium",
  update: (p) => set(p),
}));

export function PerfOverlay() {
  const s = usePerfStats();
  if (typeof location === "undefined" || !new URLSearchParams(location.search).has("perf")) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-30 rounded-md bg-black/70 px-2 py-1 font-mono text-xs text-white">
      {Math.round(s.fps)} fps · {s.frameMs.toFixed(1)} ms · {s.drawCalls} draws · {s.tier}
    </div>
  );
}
```

In `StylisedCity.tsx`, on `postRender`:
- Compute `frameMs` from `performance.now()` deltas, and `fps` as a moving average over 30 frames.
- Draw calls: use `viewer.scene.debugShowFramesPerSecond` off. Count with `(viewer.scene as unknown as { _frameState?: { commandList: unknown[] } })._frameState?.commandList.length ?? 0`, guarded by `try`. It's dev-only and its comment should say so.
- Throttle `usePerfStats.getState().update({ … })` to 4 Hz.
- Feed the frame monitor (Task 8). On drop, `setAutoTier(lowerTier)`. When the tier is already `"low"`, the monitor gets a second instance with `minFps: 15`, whose drop sets `slow = true` and shows the banner. The banner's button calls `useScene.getState().setView("list")`.

In `CesiumScene.tsx`, render `<PerfOverlay />` inside the section.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @tl/web exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scene/cesium/PerfOverlay.tsx apps/web/src/features/scene/cesium/PerfOverlay.dom.test.tsx apps/web/src/features/scene/cesium/CesiumScene.tsx apps/web/src/features/scene/cesium/stylised/StylisedCity.tsx
git commit -m "feat(web): perf overlay, automatic quality drop and slow-device list offer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```

---

### Task 18: Docs, ADR, final verification

**Files:**
- Create: `docs/00-overview/decisions/00NN-time-of-day-theme-and-decorative-motion.md` (next free number: `ls docs/00-overview/decisions`)
- Modify: `apps/web/README.md`
- Modify: `docs/superpowers/overnight-log.md`

- [ ] **Step 1: Write the ADR**

```markdown
# ADR 00NN: Time-of-day theme and decorative motion in the stylised city

Status: accepted (2026-10-16)

## Context
The owner wants the stylised 3D city to follow the Elmina clock (Day / Dusk / Night) with a manual override, and to show gentle motion (birds, clouds, ambient) so the map feels alive.

## Decision
- The mood is display-only lighting from `themeAt()` (Asia/Kuala_Lumpur): Day 07:00-18:00, Dusk 18:00-19:30, Night 19:30-07:00. It never changes a fact. UI chrome has two skins (Light for Day and Dusk, Dark for Night).
- All motion is decorative, seeded and deterministic, never tied to data: birds, clouds and cloud shadows, leaf shimmer, base-water ripple, lamp fade, night window flicker.
- No moving traffic (it could read as live traffic data). No invented landmarks or signage.
- Water animation is confined to decorative base water and never touches flood-scenario layers (tested).
- Motion runs from one capped (30 fps) loop that stops when hidden, off-screen, disabled or under prefers-reduced-motion.
- Pavements and parks are drawn flat so they can never hide route or path-status lines.

## Consequences
Extra GPU load, bounded by quality tiers (High / Medium / Low, auto-detected, auto-lowered). The "Decorative details are illustrative." label covers every addition.
```

- [ ] **Step 2: Update `apps/web/README.md`**

Add sections:
- **Theme:** Auto / Day / Dusk / Night; the clock; skins.
- **3D controls:** the mouse, touch and keyboard table; the camera cluster; the hint.
- **Motion:** what moves and how to switch it off.
- **Quality:** the tiers, `?perf=1`, and the auto drop.
- **Honesty:** the decorative rules.

- [ ] **Step 3: Full verification**

Run, with `set -o pipefail`, each of the seven CI checks from Global Constraints. Record each as PASS / FAIL / BLOCKED / NOT RUN.

Then a manual visual pass (Stylised, mock LLM):
- Day, Dusk and Night at Home, a close-up and Whole township.
- fps from `?perf=1` at each tier.
- The mock stroller-route question: the route is visible on top of everything.
- A flood scenario (+3 m): no shimmer on it, and the disclaimer still shows.

Append both to `docs/superpowers/overnight-log.md` with a real `date` timestamp. Put the screenshots in the scratchpad, not the repo, and share them with the owner.

- [ ] **Step 4: Commit**

```bash
git add docs/00-overview/decisions apps/web/README.md docs/superpowers/overnight-log.md
git commit -m "docs: time-of-day theme, 3D controls, motion and quality" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Rnvv6m5ktKm1j1JxB2b5ZZ"
```
