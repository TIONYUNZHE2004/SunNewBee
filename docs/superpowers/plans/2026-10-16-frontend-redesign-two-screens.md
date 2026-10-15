# Frontend Redesign: Two Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web UI with two screens (map + assistant, and Tickets), in the KAMUI night/day theme, reusing the existing chat, scene and API logic, then evaluate quality.

**Architecture:** Keep the engine (`useChatStream`, `chatReducer`, `sceneStore`, Cesium/Mapbox/List renderers, `@tl/api-client`, `placeModel`, `floodPath`, the verification-request API helpers). Add a token layer (semantic CSS variables, Tailwind 4 `@theme inline`, `data-theme="day|night"`), a small UI kit (`Button`, `StatusChip`), a new shell and two routes, an assistant panel, map UI (settings popover, notes, overlay cards), and a Tickets feature built on the existing verification-request helpers. Delete the superseded `/manage`, DemoBar, prototype and old resident page.

**Tech Stack:** React 19.3, react-router 8.4, zustand 5, TanStack Query 5, Tailwind 4.3, Vite 8, vitest 5 + Testing Library, Playwright 1.64, Cesium 1.146 / Resium 1.27, Mapbox GL 3.33.

**Spec:** `docs/superpowers/specs/2026-10-16-frontend-redesign-two-screens-design.md`. Brief: `docs/03-product/frontend-redesign-brief.md`. Visual reference only: `TownshipLens Frontend Redesign-handoff.zip` (`project/TownshipLens.dc.html`; extracted copy at `C:\Users\shaoxian04\AppData\Local\Temp\h\townshiplens-frontend-redesign\project\`).

## Global Constraints

- Work on branch `feat/redesign-two-screens` (from `main`). Commit per task with explicit `git add <paths>` (never `git commit -am`). Commit messages: Conventional style with scope, e.g. `feat(web): …`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VM1udC8anuaV2mPTobj2Zi`. **Do not push.**
- Wording (everywhere, enforced by tests): never `safe` / `selamat` / `安全`; never a water depth on a path; flood content says "indicative" and "not a forecast" with MBSA / JPS / NADMA links; `Not checked yet` (unverified), `No known barrier` (map-derived), `Verified` only for staff-checked facts; data gap = `No mapped connection (data gap)`; demo evidence = `Demo value · not surveyed`; OSM evacuation centres = `Candidate`, never official unless `official_pps`.
- Status is never colour alone: icon + border style + text label.
- Touch targets ≥ 44 px (`min-h-11`); every control has an accessible name; keyboard operable; streaming text in `aria-live="polite"`.
- Staff token: `sessionStorage` key `tl.staffToken` via existing `useStaffToken`; never in the bundle; header `X-Staff-Token`.
- Tickets show structured fields only, never residents' words (PDPA).
- Dependencies: only MIT/Apache-2.0/BSD; **add none**. Fonts (Marcellus, Jost, both OFL) load via `<link>` in `index.html`.
- Cost: `LLM_PROVIDER=mock` always; list view in e2e; at most ~6 real 3D tile loads in total (Task 16), logged.
- Verify with `set -o pipefail`. Report each check PASS / FAIL / BLOCKED / NOT RUN; say when mock-backed.
- Reused modules keep their existing tests green. Windows: Git Bash/PowerShell; use `pnpm`, `uv`.
- Rulings (append to `.superpowers/sdd/redesign/ledger.md`, "Ruling: what — why — cost if wrong"): (1) day/night state lives in the theme store (`ui/theme.ts`), not `sceneStore`, to keep one source; Project 2 reads it. (2) Place/flood-path cards are adapted, not rewritten: the staff editing parts move to Tickets. (3) Any `features/manage/*` file still imported by kept code after the deletion task is `git mv`d next to its importer, not deleted.

## Review Focus

Failure modes the spec implies that no single task's happy path covers (each has a test in the named task):

1. A refused answer (`Done.answer_status === "cannot_answer"`) must render as "Can't answer that yet", not as an error and not as a normal answer (Task 4, 7).
2. No staff token / wrong token (401/503/403) on save must show "Staff access needed", keep the typed value, and never lose the ticket (Task 11).
3. A ticket with no recorded value must not offer Confirm (server rejects verify without a value); the form defaults to "Record what you found" (Task 11).
4. `localStorage`/`sessionStorage` throwing (private window) must not crash theme or token code (Task 1, 11).
5. 3D unavailable (no keys / no WebGL) must still show a working List view with the same place/path access and flood note (Task 8, 12).
6. A place with `team_survey_placeholder` evidence must never show as verified, in either theme (Task 2, 9, 14).

---

## File Structure

```
apps/web/index.html                         + font <link>s
apps/web/src/index.css                      tokens, themes, chip styles
apps/web/src/ui/theme.ts                    theme store (+ test)
apps/web/src/ui/ThemeToggle.tsx
apps/web/src/ui/Button.tsx
apps/web/src/ui/status.ts                   one status map (all wording)   (+ test)
apps/web/src/ui/StatusChip.tsx
apps/web/src/app/modeStore.ts               resident | management
apps/web/src/app/Shell.tsx                  header + footer + <Outlet/>
apps/web/src/app/routes.tsx                 "/" and "/tickets"
apps/web/src/features/main/MainPage.tsx
apps/web/src/features/assistant/{starters.ts,AnswerCard.tsx,AssistantPanel.tsx}
apps/web/src/features/map-ui/{MapStage.tsx,SettingsPopover.tsx,FloodNote.tsx,RouteTag.tsx,TravelLabels.ts}
apps/web/src/features/tickets/{ticketModel.ts,TicketsPage.tsx,TicketList.tsx,TicketDetail.tsx,OutcomeForm.tsx,BeforeAfter.tsx,StaffAccess.tsx,useTickets.ts}
moved from features/manage → features/tickets: manageApi.ts, resolveForm.ts, useStaffToken.ts, attributeCatalogue.ts, attributeForm.ts, queueLabels.ts, useQueueNames.ts, queueFilters.ts (+ their tests)
deleted: features/manage (rest), features/demo, features/prototype-redesign, app/ResidentPage.tsx, features/scene/SceneHost.tsx (replaced by MapStage), unreferenced old components
```

---

### Task 1: Baseline, ledger, theme tokens and theme store

**Files:**
- Create: `.superpowers/sdd/redesign/ledger.md` (gitignored), `apps/web/src/ui/theme.ts`, `apps/web/src/ui/theme.test.ts`
- Modify: `apps/web/index.html`, `apps/web/src/index.css`, `apps/web/src/main.tsx`

**Interfaces:**
- Produces: `type Theme = "day" | "night"`; `useTheme: UseBoundStore<{theme: Theme; setTheme(t: Theme): void; toggle(): void}>`; `loadTheme(store?, mql?): Theme`; `applyTheme(t: Theme, el?: HTMLElement): void` (sets `data-theme`). Tailwind semantic colours (usable as `bg-bg`, `bg-surface`, `bg-raised`, `text-fg`, `text-fg-soft`, `border-edge`, `bg-accent`, `text-on-accent`, `ring-focus`) plus the **legacy aliases** `ink, ink-soft, paper, card, line, brand, brand-dark, brand-tint, warn-tint, danger-tint, danger` re-pointed at the semantic variables so every kept component is themed automatically.

- [ ] **Step 1: Baseline** (record in ledger; do not fix pre-existing failures here)

```bash
set -o pipefail
pnpm --filter @tl/web typecheck 2>&1 | tail -5
pnpm --filter @tl/web test 2>&1 | tail -8
```
Write results to the ledger as the baseline.

- [ ] **Step 2: Write the failing test** `apps/web/src/ui/theme.test.ts`

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, loadTheme, useTheme } from "./theme";

const mql = (light: boolean) => ({ matches: light }) as MediaQueryList;

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  it("defaults to night when the device prefers dark", () => {
    expect(loadTheme(localStorage, mql(false))).toBe("night");
  });
  it("defaults to day when the device prefers light", () => {
    expect(loadTheme(localStorage, mql(true))).toBe("day");
  });
  it("a stored choice wins over the device", () => {
    localStorage.setItem("tl.theme", "day");
    expect(loadTheme(localStorage, mql(false))).toBe("day");
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
    expect(loadTheme(bad, mql(false))).toBe("night");
  });
  it("applyTheme sets data-theme and toggle flips it", () => {
    applyTheme("day");
    expect(document.documentElement.dataset.theme).toBe("day");
    useTheme.getState().setTheme("night");
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("day");
    expect(document.documentElement.dataset.theme).toBe("day");
  });
  it("setTheme tolerates setItem throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => useTheme.getState().setTheme("night")).not.toThrow();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3: Run it, expect FAIL** (`Cannot find module './theme'`)

Run: `pnpm --filter @tl/web exec vitest run src/ui/theme.test.ts`

- [ ] **Step 4: Implement** `apps/web/src/ui/theme.ts`

```ts
import { create } from "zustand";

export type Theme = "day" | "night";
const KEY = "tl.theme";

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};
const browserMql = (): MediaQueryList | undefined =>
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : undefined;

/** Stored choice, else the device preference (light => day), else night. Never throws. */
export function loadTheme(store: Store | undefined = browserStore(), mql = browserMql()): Theme {
  try {
    const v = store?.getItem(KEY);
    if (v === "day" || v === "night") return v;
  } catch {
    /* storage unavailable */
  }
  return mql?.matches ? "day" : "night";
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    try {
      browserStore()?.setItem(KEY, theme);
    } catch {
      /* per-viewer convenience only */
    }
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "night" ? "day" : "night"),
}));
```

- [ ] **Step 5: Add fonts** to `apps/web/index.html` `<head>` (before existing tags that follow):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Marcellus&display=swap" rel="stylesheet" />
```

- [ ] **Step 6: Rewrite** `apps/web/src/index.css` (keep the reduced-motion block at the end):

```css
@import "tailwindcss";

/* Night is the default (the mockup palette). Day swaps the same semantic variables. */
:root,
:root[data-theme="night"] {
  color-scheme: dark;
  --c-bg: #1f1838;
  --c-surface: #241c42;
  --c-raised: #2e2552;
  --c-fg: #ffffff;
  --c-fg-soft: rgba(255, 255, 255, 0.82);
  --c-edge: rgba(255, 255, 255, 0.16);
  --c-accent: #fdf0ea;
  --c-on-accent: #3d2f6b;
  --c-focus: #f6a94a;
  --c-lantern: #f6a94a;
  --c-lilac: #c9b5ea;
  --c-flood: #bcd7f7;
  --c-rose: #c24a68;
  --c-peach: #f8cdb0;
  --c-warn-tint: rgba(246, 169, 74, 0.12);
  --c-danger-tint: rgba(194, 74, 104, 0.18);
  --c-brand-tint: rgba(255, 255, 255, 0.06);
}
:root[data-theme="day"] {
  color-scheme: light;
  --c-bg: #fdf0ea;
  --c-surface: #ffffff;
  --c-raised: #fff7f2;
  --c-fg: #1f1838;
  --c-fg-soft: #4a3d78;
  --c-edge: rgba(61, 47, 107, 0.28);
  --c-accent: #3d2f6b;
  --c-on-accent: #fdf0ea;
  --c-focus: #8a4b00;
  --c-lantern: #8a4b00;
  --c-lilac: #5b4390;
  --c-flood: #1d4f91;
  --c-rose: #a8324f;
  --c-peach: #7a4a2a;
  --c-warn-tint: #fdf0dc;
  --c-danger-tint: #fbe4e9;
  --c-brand-tint: rgba(61, 47, 107, 0.08);
}

@theme inline {
  --color-bg: var(--c-bg);
  --color-surface: var(--c-surface);
  --color-raised: var(--c-raised);
  --color-fg: var(--c-fg);
  --color-fg-soft: var(--c-fg-soft);
  --color-edge: var(--c-edge);
  --color-accent: var(--c-accent);
  --color-on-accent: var(--c-on-accent);
  --color-focus: var(--c-focus);
  --color-lantern: var(--c-lantern);
  --color-lilac: var(--c-lilac);
  --color-flood: var(--c-flood);
  --color-rose: var(--c-rose);
  --color-peach: var(--c-peach);
  /* legacy names used by kept components, re-pointed at the semantic variables */
  --color-ink: var(--c-fg);
  --color-ink-soft: var(--c-fg-soft);
  --color-paper: var(--c-bg);
  --color-card: var(--c-surface);
  --color-line: var(--c-edge);
  --color-brand: var(--c-accent);
  --color-brand-dark: var(--c-accent);
  --color-brand-tint: var(--c-brand-tint);
  --color-warn-tint: var(--c-warn-tint);
  --color-danger-tint: var(--c-danger-tint);
  --color-danger: var(--c-rose);
  --font-display: "Marcellus", "Optima", serif;
  --font-sans: "Jost", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif;
}

body {
  margin: 0;
  background: var(--c-bg);
  color: var(--c-fg);
  font-family: var(--font-sans);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--c-focus);
  outline-offset: 2px;
}

/* Status chips: tone sets colour, border style is a separate non-colour cue. */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border-width: 1px;
  font: 600 0.72rem/1.3 var(--font-sans);
}
.chip-solid { border-style: solid; }
.chip-dashed { border-style: dashed; }
.chip-dotted { border-style: dotted; }
.chip-cream { background: var(--c-accent); color: var(--c-on-accent); border-color: var(--c-accent); }
.chip-amber { color: var(--c-lantern); border-color: var(--c-lantern); }
.chip-lilac { color: var(--c-lilac); border-color: var(--c-lilac); }
.chip-muted { color: var(--c-fg-soft); border-color: var(--c-edge); }
.chip-rose { background: var(--c-rose); color: #fff; border-color: var(--c-rose); }
.chip-flood { color: var(--c-flood); border-color: var(--c-flood); background: color-mix(in srgb, var(--c-flood) 14%, transparent); }
.chip-peach { color: var(--c-peach); border-color: var(--c-peach); }

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
    transition-duration: 0.01ms;
    scroll-behavior: auto;
  }
}
```

- [ ] **Step 7: Apply the theme on boot.** In `apps/web/src/main.tsx` add `import { applyTheme, useTheme } from "./ui/theme";` and, before `createRoot(...)`, `applyTheme(useTheme.getState().theme);`.

- [ ] **Step 8: Run tests + typecheck**, expect PASS

Run: `pnpm --filter @tl/web exec vitest run src/ui/theme.test.ts && pnpm --filter @tl/web typecheck`

- [ ] **Step 9: Commit**

```bash
git add apps/web/index.html apps/web/src/index.css apps/web/src/main.tsx apps/web/src/ui/theme.ts apps/web/src/ui/theme.test.ts
git commit -m "feat(web): KAMUI tokens, day/night theme store and fonts"
```

---

### Task 2: Status map, StatusChip, Button

**Files:**
- Create: `apps/web/src/ui/status.ts`, `apps/web/src/ui/StatusChip.tsx`, `apps/web/src/ui/Button.tsx`, `apps/web/src/ui/status.test.tsx`

**Interfaces:**
- Produces: `StatusKey`, `STATUS: Record<StatusKey, {icon: string; label: string; border: "solid"|"dashed"|"dotted"; tone: Tone}>`, `<StatusChip status={StatusKey} label?={string} />`, `<Button variant?="primary"|"outline" ...button props />`. `StatusKey` includes `demo` (label `Demo value · not surveyed`).

- [ ] **Step 1: Failing test** `apps/web/src/ui/status.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUS, type StatusKey } from "./status";
import { StatusChip } from "./StatusChip";

describe("status map", () => {
  const keys = Object.keys(STATUS) as StatusKey[];
  it("never uses banned words", () => {
    for (const k of keys) expect(STATUS[k].label).not.toMatch(/\bsafe\b|selamat|安全/i);
  });
  it("uses the required wording", () => {
    expect(STATUS.unchecked.label).toBe("Not checked yet");
    expect(STATUS.clear.label).toBe("No known barrier");
    expect(STATUS.gap.label).toBe("No mapped connection (data gap)");
    expect(STATUS.demo.label).toBe("Demo value · not surveyed");
    expect(STATUS.candidate.label).toMatch(/^Candidate/);
    expect(STATUS.likely.label).toMatch(/indicative/i);
    expect(STATUS.possibly.label).toMatch(/indicative/i);
  });
  it("every status has an icon and a label, so colour is never the only cue", () => {
    for (const k of keys) {
      expect(STATUS[k].icon.length).toBeGreaterThan(0);
      expect(STATUS[k].label.length).toBeGreaterThan(0);
    }
  });
  it("unverified statuses differ from verified by border style too", () => {
    expect(STATUS.unchecked.border).not.toBe(STATUS.verified.border);
    expect(STATUS.possibly.border).not.toBe(STATUS.likely.border);
  });
  it("renders icon aria-hidden and the label as text", () => {
    render(<StatusChip status="unchecked" />);
    const chip = screen.getByText("Not checked yet");
    expect(chip.closest(".chip-dashed")).not.toBeNull();
  });
  it("label override keeps the status cues", () => {
    render(<StatusChip status="verified" label="Verified 3 Oct 2026" />);
    expect(screen.getByText("Verified 3 Oct 2026")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter @tl/web exec vitest run src/ui/status.test.tsx`

- [ ] **Step 3: Implement** `apps/web/src/ui/status.ts`

```ts
export type Tone = "cream" | "amber" | "lilac" | "muted" | "rose" | "flood" | "peach";
export type StatusKey =
  | "verified" | "reported" | "unchecked" | "unknown" | "clear" | "blocked"
  | "likely" | "possibly" | "candidate" | "official" | "gap" | "rejected" | "demo";

export interface StatusDef {
  icon: string;
  label: string;
  border: "solid" | "dashed" | "dotted";
  tone: Tone;
}

/** The only place status wording lives (brief: wording rules). */
export const STATUS: Record<StatusKey, StatusDef> = {
  verified: { icon: "✓", label: "Verified", border: "solid", tone: "cream" },
  reported: { icon: "!", label: "Reported", border: "solid", tone: "amber" },
  unchecked: { icon: "?", label: "Not checked yet", border: "dashed", tone: "lilac" },
  unknown: { icon: "–", label: "Unknown", border: "dotted", tone: "muted" },
  clear: { icon: "○", label: "No known barrier", border: "solid", tone: "muted" },
  blocked: { icon: "×", label: "Not passable", border: "solid", tone: "rose" },
  likely: { icon: "≈", label: "Likely flooded (indicative)", border: "solid", tone: "flood" },
  possibly: { icon: "~", label: "Possibly flooded (indicative)", border: "dashed", tone: "flood" },
  candidate: { icon: "◇", label: "Candidate · from map data", border: "dashed", tone: "peach" },
  official: { icon: "✓", label: "Official relief centre", border: "solid", tone: "cream" },
  gap: { icon: "∅", label: "No mapped connection (data gap)", border: "dotted", tone: "lilac" },
  rejected: { icon: "×", label: "Rejected", border: "solid", tone: "muted" },
  demo: { icon: "◌", label: "Demo value · not surveyed", border: "dashed", tone: "peach" },
};
```

`apps/web/src/ui/StatusChip.tsx`

```tsx
import { STATUS, type StatusKey } from "./status";

export function StatusChip({ status, label }: { status: StatusKey; label?: string }) {
  const s = STATUS[status];
  return (
    <span className={`chip chip-${s.border} chip-${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span>
      {label ?? s.label}
    </span>
  );
}
```

`apps/web/src/ui/Button.tsx`

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline";
  icon?: ReactNode;
};

export function Button({ variant = "primary", icon, className = "", children, ...rest }: Props) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50";
  const v =
    variant === "primary"
      ? "bg-accent text-on-accent shadow-md hover:brightness-105"
      : "border border-fg/70 bg-transparent text-fg hover:bg-fg/10";
  return (
    <button type="button" className={`${base} ${v} ${className}`} {...rest}>
      {children}
      {icon}
    </button>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS; typecheck.**
- [ ] **Step 5: Commit** `git add apps/web/src/ui && git commit -m "feat(web): status map, StatusChip and Button primitives"`

---

### Task 3: Scene store additions (`mapStyle`, `clearRoute`)

**Files:** Modify `apps/web/src/features/scene/sceneStore.ts`; extend `apps/web/src/features/scene/sceneStore.test.ts`.

**Interfaces:** Produces `mapStyle: "realistic" | "stylised"` (default `"realistic"`), `setMapStyle(s)`, `clearRoute()`.

- [ ] **Step 1: Add failing tests** at the end of `sceneStore.test.ts` (match the file's existing import/reset style; read its top first):

```ts
describe("redesign additions", () => {
  it("mapStyle defaults to realistic and can be set", () => {
    useScene.getState().reset();
    expect(useScene.getState().mapStyle).toBe("realistic");
    useScene.getState().setMapStyle("stylised");
    expect(useScene.getState().mapStyle).toBe("stylised");
  });
  it("clearRoute drops the highlighted route only", () => {
    useScene.getState().reset();
    useScene.getState().setScenario("stage_p3m");
    useScene.getState().applyIntent({
      kind: "route.highlight",
      route_id: "r1",
      geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    } as never);
    expect(useScene.getState().route?.id).toBe("r1");
    useScene.getState().clearRoute();
    expect(useScene.getState().route).toBeNull();
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter @tl/web exec vitest run src/features/scene/sceneStore.test.ts`
- [ ] **Step 3: Implement.** In `SceneState` add `mapStyle: "realistic" | "stylised"; setMapStyle: (s: "realistic" | "stylised") => void; clearRoute: () => void;`. In `initial` add `mapStyle: "realistic" as "realistic" | "stylised",`. In the store body add:

```ts
  setMapStyle: (mapStyle) => set({ mapStyle }),
  clearRoute: () => set({ route: null }),
```
- [ ] **Step 4: Run, expect PASS.** Commit `feat(web): scene store mapStyle and clearRoute`.

---

### Task 4: Reducer keeps the answer status (refusal vs answer)

**Files:** Modify `apps/web/src/features/chat/chatReducer.ts`, `chatReducer.test.ts`.

**Interfaces:** `AssistantMessage.answerStatus?: "answered" | "partial" | "cannot_answer" | string`; `reduceChatEvent` sets it on `done`. `isRefusal(m): boolean`.

- [ ] **Step 1: Failing test** (append to `chatReducer.test.ts`):

```ts
import { emptyAssistant, isRefusal, reduceChatEvent } from "./chatReducer";

describe("answer status", () => {
  it("keeps answer_status from the done event", () => {
    const m = reduceChatEvent(emptyAssistant("a"), {
      type: "done", message_id: "m", answer_status: "cannot_answer", model: "mock",
    } as never);
    expect(m.done).toBe(true);
    expect(m.answerStatus).toBe("cannot_answer");
    expect(isRefusal(m)).toBe(true);
  });
  it("an answered message is not a refusal; an errored one is not either", () => {
    const ok = reduceChatEvent(emptyAssistant("a"), {
      type: "done", message_id: "m", answer_status: "answered", model: "mock",
    } as never);
    expect(isRefusal(ok)).toBe(false);
    expect(isRefusal({ ...emptyAssistant("b"), error: "x", answerStatus: "cannot_answer" })).toBe(false);
  });
});
```
(If `chatReducer.test.ts` already imports from `./chatReducer`, merge the import.)

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Add `answerStatus?: string;` to `AssistantMessage`; change the `done` case to `return { ...m, done: true, answerStatus: ev.answer_status };`; add

```ts
/** "I can't answer that yet" is a normal outcome, shown calmly; a transport error is not. */
export const isRefusal = (m: AssistantMessage): boolean => !m.error && m.answerStatus === "cannot_answer";
```
- [ ] **Step 4: Run chat tests, expect PASS** (`pnpm --filter @tl/web exec vitest run src/features/chat`). Commit `feat(web): chat reducer keeps answer status`.

---

### Task 5: Mode store, shell, header, routes

**Files:**
- Create: `apps/web/src/app/modeStore.ts`, `apps/web/src/app/Shell.tsx`, `apps/web/src/ui/ThemeToggle.tsx`, `apps/web/src/app/Shell.dom.test.tsx`
- Modify: `apps/web/src/app/routes.tsx` (rewrite)
- Stub (replaced in later tasks): `apps/web/src/features/main/MainPage.tsx`, `apps/web/src/features/tickets/TicketsPage.tsx`

**Interfaces:** `useMode: {mode: "resident"|"management"; setMode(m)}`; `Shell` renders header (wordmark, township name from `useSite`, mode switch on `/` only, Tickets button with open count in management on `/`, Back to map on `/tickets`, ThemeToggle), `<main id="main">`, footer with ODbL attribution; routes `/` → `MainPage`, `/tickets` → `TicketsPage`.

- [ ] **Step 1: Failing test** `apps/web/src/app/Shell.dom.test.tsx`

```tsx
// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../test/helpers";
import { useMode } from "./modeStore";
import { Shell } from "./Shell";

const routes = [
  { element: <Shell />, children: [{ path: "/", element: <p>main</p> }, { path: "/tickets", element: <p>tickets</p> }] },
];

function setup(path = "/") {
  stubFetch((url) => {
    if (url.includes("/verification-requests")) return json([{ id: "v1" }, { id: "v2" }]);
    return json({ name: "City of Elmina", attribution: ["© OpenStreetMap contributors (ODbL)"] });
  });
  return renderWithClient(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe("Shell", () => {
  beforeEach(() => useMode.setState({ mode: "resident" }));

  it("shows the mode switch on the main screen and no Tickets button for residents", async () => {
    setup();
    const group = await screen.findByRole("radiogroup", { name: "Perspective" });
    expect(within(group).getByRole("radio", { name: "Resident" })).toBeChecked();
    expect(screen.queryByRole("button", { name: /Tickets/ })).toBeNull();
  });
  it("management shows a Tickets link with the open count", async () => {
    setup();
    await userEvent.click(await screen.findByRole("radio", { name: "Management" }));
    expect(await screen.findByRole("link", { name: /Tickets.*2 open/ })).toBeVisible();
  });
  it("tickets screen has Back to map and no mode switch", async () => {
    setup("/tickets");
    expect(await screen.findByRole("link", { name: "Back to map" })).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Perspective" })).toBeNull();
  });
  it("footer keeps the OpenStreetMap attribution", async () => {
    setup();
    expect(await screen.findByText(/OpenStreetMap contributors/)).toBeVisible();
  });
  it("has a skip link and a theme toggle with a name", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme|day|night/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**

`modeStore.ts`:
```ts
import { create } from "zustand";
export type Mode = "resident" | "management";
export const useMode = create<{ mode: Mode; setMode: (m: Mode) => void }>((set) => ({
  mode: "resident",
  setMode: (mode) => set({ mode }),
}));
```

`ui/ThemeToggle.tsx`:
```tsx
import { useTheme } from "./theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "night" ? "day" : "night";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      className="inline-flex size-11 items-center justify-center rounded-full border border-edge text-fg hover:bg-fg/10"
    >
      <span aria-hidden="true">{theme === "night" ? "☀" : "☾"}</span>
    </button>
  );
}
```

`Shell.tsx`: uses `NavLink`/`Link`, `useSite`, `useMode`, and a `useOpenTicketCount()` helper from `features/tickets/useTickets.ts` (create now as `useQuery(["tickets","open-count"], () => fetchVRs("?status=open"))` returning `data?.length ?? 0`; this file is completed in Task 10 but the count hook is needed now — create it with this single export and extend later). Header grid: left wordmark `font-display tracking-[0.22em]` "TOWNSHIPLENS" + site name; centre: on `/` a `role="radiogroup" aria-label="Perspective"` with two `role="radio" aria-checked` buttons ("Resident", "Management"), on `/tickets` the text `TICKETS · MANAGEMENT`; right: on `/` in management a `<Link to="/tickets">` styled as outline Button text `Tickets` plus a badge `<span aria-label="{n} open">`, so the accessible name is "Tickets {n} open"; on `/tickets` `<Link to="/">Back to map</Link>`; always `<ThemeToggle/>`. Skip link `<a href="#main">Skip to content</a>` (sr-only until focus). `<main id="main" tabIndex={-1} className="flex-1 min-h-0">`. Footer: `<footer className="border-t border-edge px-4 py-1 text-xs text-fg-soft">{attribution}</footer>` using `site.data?.attribution?.join(" · ") ?? "© OpenStreetMap contributors (ODbL)"`. Root: `flex min-h-screen flex-col bg-bg text-fg`; on large screens the main screen is `lg:h-screen` — set on `MainPage`, not the shell.

`routes.tsx`:
```tsx
import { createBrowserRouter } from "react-router";
import { MainPage } from "../features/main/MainPage";
import { TicketsPage } from "../features/tickets/TicketsPage";
import { Shell } from "./Shell";

export const router = createBrowserRouter([
  { element: <Shell />, children: [{ path: "/", element: <MainPage /> }, { path: "/tickets", element: <TicketsPage /> }] },
]);
```
Stubs: `export function MainPage() { return <p>Main</p>; }` and `export function TicketsPage() { return <p>Tickets</p>; }`.

- [ ] **Step 4: Run tests, typecheck.** Typecheck will fail where old files import deleted pieces only after Task 12; for now the old files remain and compile (they are just unreferenced).
- [ ] **Step 5: Commit** `feat(web): two-route shell with mode switch, tickets link and theme toggle`.

---

### Task 6: Move ticket logic out of `features/manage`

**Files:** `git mv` these (with their tests) from `apps/web/src/features/manage/` to `apps/web/src/features/tickets/`: `manageApi.ts`, `resolveForm.ts`, `resolveForm.test.ts`, `useStaffToken.ts`, `useStaffToken.test.ts`, `attributeCatalogue.ts`, `attributeCatalogue.test.ts`, `attributeForm.ts`, `attributeForm.test.ts`, `queueLabels.ts`, `queueLabels.test.ts`, `useQueueNames.ts`, `queueFilters.ts`, `queueFilters.test.ts`.

- [ ] **Step 1:** Run the moves.

```bash
cd apps/web/src/features
for f in manageApi resolveForm useStaffToken attributeCatalogue attributeForm queueLabels useQueueNames queueFilters; do
  git mv manage/$f.ts tickets/$f.ts
  [ -f manage/$f.test.ts ] && git mv manage/$f.test.ts tickets/$f.test.ts
done
git status --short | head -30
```
- [ ] **Step 2:** Fix imports with a project-wide replace of `manage/manageApi`→`tickets/manageApi` etc. for the moved files (search with Grep for `from ".*manage/(manageApi|resolveForm|useStaffToken|attributeCatalogue|attributeForm|queueLabels|useQueueNames|queueFilters)"` and `from "./(manageApi|…)"` inside remaining manage files). Remaining manage files will be deleted in Task 12, so only fix imports in files that survive (`places/PlaceCard.tsx` is rewritten in Task 9). To keep typecheck green meanwhile, update the remaining manage files' relative imports too (`../tickets/…`).
- [ ] **Step 3:** `pnpm --filter @tl/web typecheck && pnpm --filter @tl/web exec vitest run src/features/tickets src/features/manage` expect PASS.
- [ ] **Step 4: Commit** `refactor(web): move ticket logic from manage to tickets`.

---

### Task 7: Assistant panel (starters, answer card, input)

**Files:**
- Create: `apps/web/src/features/assistant/starters.ts`, `starters.test.ts`, `AnswerCard.tsx`, `AssistantPanel.tsx`, `AssistantPanel.dom.test.tsx`
- Reuse: `useChatStream`, `useChatDraft` (for `pendingAsk`), `CitationList`, `useElementNames`.

**Interfaces:**
- Produces: `STARTERS: Record<Mode, {text: string; profile?: Profile}[]>`, `copyFor(mode): {title, sub, placeholder}`, `<AnswerCard m={AssistantMessage} onRetry />`, `<AssistantPanel />`.

- [ ] **Step 1: Check each starter against the mock.** Run, for each starter text below, and record whether the answer is a real answer (not `cannot_answer`):

```bash
for q in "Stroller route from Car Park B to the playground" "Wheelchair route to the lakeside mall" "Nearest evacuation centre if the water rises 3 m" "Where to drop off recycling" "Which places are cut off at +3 m" "Which areas are isolated at +5 m" "Which routes to the mall are cut off at +3 m" "Tell me about a place"; do
  echo "== $q"; LLM_PROVIDER=mock uv run python -m townshiplens_agent.cli --profile stroller "$q" 2>&1 | tail -6
done
```
If the mock refuses a starter, reword that starter minimally toward the mock's recognised phrasing (see `packages/agent/src/townshiplens_agent/mock.py` and the previous `SUGGESTIONS` in `chat/suggestions.ts`) and keep the brief's meaning; record changes in the ledger. Management starters may legitimately return a refusal in the mock; note it, and keep the brief's wording.

- [ ] **Step 2: Failing tests** `starters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { copyFor, STARTERS } from "./starters";

describe("starters", () => {
  it("has four per mode and none contain banned words", () => {
    for (const m of ["resident", "management"] as const) {
      expect(STARTERS[m]).toHaveLength(4);
      for (const s of STARTERS[m]) expect(s.text).not.toMatch(/\bsafe\b|selamat|安全/i);
    }
  });
  it("copy changes with the mode", () => {
    expect(copyFor("resident").placeholder).toBe("Describe where you want to go");
    expect(copyFor("management").placeholder).toBe("Describe your plan or ask about an area");
    expect(copyFor("resident").sub).toMatch(/checked data/i);
    expect(copyFor("management").sub).toMatch(/tickets/i);
  });
});
```
`AssistantPanel.dom.test.tsx` (stub `fetch` for `/api/chat` as an SSE body; check `useChatStream` consumers for the exact SSE framing in `parseSse.test.ts` and build the stream with `data: {json}\n\n` lines):

```tsx
// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { AssistantPanel } from "./AssistantPanel";

const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const done = (status: string) => ({ type: "done", message_id: "m", answer_status: status, model: "mock" });

beforeEach(() => useMode.setState({ mode: "resident" }));

describe("AssistantPanel", () => {
  it("empty state shows the heading, sub line and resident starters", () => {
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    expect(screen.getByRole("heading", { name: "Ask about getting around" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /route|evacuation|recycling/i }).length).toBeGreaterThanOrEqual(3);
  });
  it("management mode swaps heading, starters and placeholder", () => {
    useMode.setState({ mode: "management" });
    stubFetch(() => json([]));
    renderWithClient(<AssistantPanel />);
    expect(screen.getByRole("heading", { name: "Ask about the township" })).toBeVisible();
    expect(screen.getByPlaceholderText("Describe your plan or ask about an area")).toBeVisible();
  });
  it("renders a refusal as a calm 'Can't answer that yet', not an error", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([{ type: "text.delta", delta: "I don't have checked data about that yet." }, done("cannot_answer")])
        : json([]),
    );
    renderWithClient(<AssistantPanel />);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "something odd");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Can't answer that yet")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("a transport failure shows an alert with Try again", async () => {
    stubFetch((url) => (url.includes("/chat") ? new Response("no", { status: 500 }) : json([])));
    renderWithClient(<AssistantPanel />);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
  it("orders the answer: text, uncertainty, disclaimer, ticket line; log is polite", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([
            { type: "text.delta", delta: "Take the east walk." },
            { type: "uncertainty", level: "partial", items: [{ text: "Step count not checked yet" }] },
            { type: "disclaimer", lens: "flood", text: "Indicative scenario, not a forecast.", links: [] },
            { type: "verification.requested", id: "vr-1", target: "x", attribute: "step_count", summary: "s" },
            done("partial"),
          ])
        : json([]),
    );
    renderWithClient(<AssistantPanel />);
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "route");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const card = await screen.findByRole("article");
    const text = card.textContent ?? "";
    expect(text.indexOf("Take the east walk.")).toBeLessThan(text.indexOf("Not verified"));
    expect(text.indexOf("Not verified")).toBeLessThan(text.indexOf("not a forecast"));
    expect(text.indexOf("not a forecast")).toBeLessThan(text.indexOf("A check has been requested"));
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });
});
```
(Adjust the `uncertainty`/`verification.requested` payload fields to the generated types in `packages/api-client`; the assertions on ordering stay.)

- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement.**

`starters.ts`:
```ts
import type { Mode } from "../../app/modeStore";
import type { Profile } from "../scene/sceneStore";

export interface Starter { text: string; profile?: Profile }

export const STARTERS: Record<Mode, Starter[]> = {
  resident: [
    { text: "Stroller route from Car Park B to the playground", profile: "stroller" },
    { text: "Wheelchair route to the lakeside mall", profile: "wheelchair" },
    { text: "Nearest evacuation centre if the water rises 3 m" },
    { text: "Where to drop off recycling" },
  ],
  management: [
    { text: "Which places are cut off at +3 m" },
    { text: "Which areas are isolated at +5 m" },
    { text: "Which routes to the mall are cut off at +3 m" },
    { text: "Tell me about a place" },
  ],
};

export function copyFor(mode: Mode) {
  return mode === "resident"
    ? {
        title: "Ask about getting around",
        sub: "Ask in your own words. Answers only come from checked data and say what isn't verified.",
        placeholder: "Describe where you want to go",
      }
    : {
        title: "Ask about the township",
        sub: "Ask about an area or a scenario. Gaps in the data become tickets for your team.",
        placeholder: "Describe your plan or ask about an area",
      };
}
```
(Apply Step 1's wording changes if any.)

`AnswerCard.tsx`: an `<article>` with the order: refusal chip (`Can't answer that yet`, dashed lilac, only when `isRefusal(m)`), checks list (`<ol aria-label="Checks the assistant ran">`, each `<li>` icon `✓` aria-hidden / spinner + `t.name.replace(/_/g," ")` + sr-only done/running — copy from the existing `AssistantBubble`), thinking line (`Checking the data` + dots) when `!m.done && !m.text && !m.error`, streamed text `<p>` with a blinking cursor `<span aria-hidden>` while `!m.done`, uncertainty (dashed lilac box: `?` icon aria-hidden, **bold** `Not verified · ` + `u.items` texts joined; reuse `UncertaintyBanner` data shape — read `chat/UncertaintyBanner.tsx` and `chat/uncertainty.ts` and call their helper for the sentence), disclaimer (`≈` box with `m.disclaimer.text` and its `links` as `<a target="_blank" rel="noopener noreferrer">`; plus always the literal phrase "not a forecast" is already in `text`), evidence (`<CitationList citations names />` inside a section labelled "Evidence"), ticket line (`A check has been requested from the township team.` / `N checks have been requested…`), error (`role="alert"`, text `m.error`, `<Button variant="outline" onClick={onRetry}>Try again</Button>`). Card colours: `border-edge bg-raised`; refusal `border-lilac border-dashed`; error `border-rose bg-danger-tint`.

`AssistantPanel.tsx`: `<aside aria-label="Assistant" className="flex min-h-0 flex-col border-l border-edge bg-surface">`: header (`<h1>` title, sub `<p>`), `<div role="log" aria-live="polite" aria-label="Conversation" className="flex-1 min-h-0 overflow-y-auto …">` containing empty-state starters (`TRY ASKING` label + four full-width buttons `min-h-[52px]` with `→` aria-hidden) or messages (user bubble: `bg-accent text-on-accent`, sr-only "You: "; assistant: `<AnswerCard/>`), footer: when messages exist a horizontally scrollable chip row of the starters (`disabled={streaming}`), then the form: visually-hidden `<label htmlFor="chat-input">Your question</label>`, `<input id="chat-input" …placeholder={copy.placeholder}>`, `<Button type="submit" disabled={streaming || !text.trim()}>Ask</Button>`. Starter click: `if (s.profile) useScene.getState().setProfile(s.profile); void send(s.text, s.profile);`. Reuse the `pendingAsk` effect and `useChatDraft` draft/streaming mirror **verbatim from the old ChatPanel** (copy that block; it handles "Ask again" and place-card prefill) and keep `scrollIntoView` on messages. Add `id="chat-input"` (PlaceCard "Ask about this place" focuses it).

- [ ] **Step 5: Run tests, typecheck, PASS.**
- [ ] **Step 6: Commit** `feat(web): assistant panel with starters and answer card`.

---

### Task 8: Map stage, settings popover, flood note, route tag

**Files:**
- Create: `apps/web/src/features/map-ui/TravelLabels.ts`, `MapStage.tsx`, `SettingsPopover.tsx`, `FloodNote.tsx`, `RouteTag.tsx`, `SettingsPopover.dom.test.tsx`, `FloodNote.dom.test.tsx`
- Modify: `apps/web/src/features/scene/StatusLegend.tsx` (restyle to tokens; add the "Suggested route" row)

**Interfaces:**
- `levelOptions(scenarios): {id: string | null; label: string}[]` ("Normal" first, then stages by `stage_m`, label `+N m`) exported from `SettingsPopover.tsx`.
- `<MapStage />`: the renderer area only (no view switcher, no profile select, no key note card); chooses view with the existing `selectView`/`availableViews` logic; fills its parent (`h-full`); contains the cards slot via children.
- `<SettingsPopover />`: button (accessible name "Map settings", `aria-expanded`) + dialog.

- [ ] **Step 1: Failing tests.**

`SettingsPopover.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { useTheme } from "../../ui/theme";
import { SettingsPopover } from "./SettingsPopover";

const scenarios = [
  { id: "baseline", label: "Baseline", stage_m: 0, disclaimer: "d", links: [] },
  { id: "stage_p1m", label: "River +1 m", stage_m: 1, disclaimer: "d", links: [] },
  { id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "d", links: [] },
];

beforeEach(() => {
  useScene.getState().reset();
  useMode.setState({ mode: "resident" });
  stubFetch(() => json(scenarios));
});

describe("SettingsPopover", () => {
  it("is closed until opened, and the button has a name and expanded state", async () => {
    renderWithClient(<SettingsPopover />);
    const btn = screen.getByRole("button", { name: "Map settings" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(btn);
    expect(screen.getByRole("dialog", { name: "Map settings" })).toBeVisible();
  });
  it("lists the legend with all six statuses incl. Suggested route", async () => {
    renderWithClient(<SettingsPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    const legend = screen.getByRole("list", { name: "Path status legend" });
    for (const t of ["No known barrier", "Not checked yet", "Not passable", "Likely flooded (indicative)", "Possibly flooded (indicative)", "Suggested route"])
      expect(within(legend).getByText(t)).toBeInTheDocument();
  });
  it("river level picks the scenario; Normal clears it", async () => {
    renderWithClient(<SettingsPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(await screen.findByRole("radio", { name: "+3 m" }));
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
    await userEvent.click(screen.getByRole("radio", { name: "Normal" }));
    expect(useScene.getState().scenarioId).toBeNull();
  });
  it("Travelling as is resident-only and sets the profile", async () => {
    renderWithClient(<SettingsPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "Wheelchair" }));
    expect(useScene.getState().profile).toBe("wheelchair");
  });
  it("management hides Travelling as", async () => {
    useMode.setState({ mode: "management" });
    renderWithClient(<SettingsPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    expect(screen.queryByRole("radiogroup", { name: "Travelling as" })).toBeNull();
  });
  it("Day/Night radiogroup drives the theme", async () => {
    renderWithClient(<SettingsPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "Day" }));
    expect(useTheme.getState().theme).toBe("day");
  });
  it("Escape closes and returns focus to the button", async () => {
    renderWithClient(<SettingsPopover />);
    const btn = screen.getByRole("button", { name: "Map settings" });
    await userEvent.click(btn);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
  });
});
```

`FloodNote.dom.test.tsx`:
```tsx
// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { FloodNote } from "./FloodNote";

beforeEach(() => {
  useScene.getState().reset();
  stubFetch(() => json([{ id: "stage_p3m", label: "River +3 m", stage_m: 3, disclaimer: "Indicative only", links: [] }]));
});

describe("FloodNote", () => {
  it("renders nothing when no flood level is on", () => {
    renderWithClient(<FloodNote />);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("says indicative, not a forecast, links MBSA/JPS/NADMA, never 'safe' or a depth", async () => {
    useScene.getState().setScenario("stage_p3m");
    renderWithClient(<FloodNote />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(/indicative scenario, not a forecast/i);
    for (const n of ["MBSA", "JPS", "NADMA"]) expect(screen.getByRole("link", { name: new RegExp(n) })).toHaveAttribute("href");
    expect(note.textContent).not.toMatch(/\bsafe\b|depth|metres deep/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**

`TravelLabels.ts`: `export const TRAVEL_ORDER: Profile[] = ["default","stroller","wheelchair","older_adult_rest","drive"]; export const TRAVEL_LABELS: Record<Profile,string> = { default: "Walking", stroller: "Stroller", wheelchair: "Wheelchair", older_adult_rest: "Older adult (rest stops)", drive: "Driving" };`

`FloodNote.tsx`: reads `scenarioId`, `useScenarios()`; when `scenarioId` and `scenarioId !== "baseline"` render `<div role="note" className="absolute left-4 bottom-4 …bg-surface border-flood">` with `River {label} · indicative scenario, not a forecast` (label = `+N m` from `stage_m`, else `scenario.label`), and `For official guidance see <a href="https://www.mbsa.gov.my">MBSA</a>, <a href="https://publicinfobanjir.water.gov.my">JPS</a> and <a href="https://www.nadma.gov.my">NADMA</a>.` (`target="_blank" rel="noopener noreferrer"`). Show the scenario's own `disclaimer` below in small text.

`RouteTag.tsx`: when `useScene(s=>s.route)` exists: a pill top-left `Suggested route` + clear `<button aria-label="Clear route from map" onClick={clearRoute}>×</button>`; include the `ROUTE_STYLE` swatch SVG (aria-hidden).

`SettingsPopover.tsx`: state `open`; button `absolute bottom-4 right-4 size-11 rounded-full` with the sliders SVG (aria-hidden), `aria-label="Map settings"`, `aria-expanded={open}`, `aria-controls="map-settings"`. Dialog `role="dialog" aria-label="Map settings" id="map-settings"` containing: `<StatusLegend />`; River level radiogroup (`role="radiogroup" aria-label="River level"`, 3-col grid, each `<button role="radio" aria-checked>` min-h-10, labels from `levelOptions(useScenarios().data ?? [])`; helper text `Indicative scenarios, not forecasts.`); if `mode==="resident"` the Travelling as radiogroup (labels `TRAVEL_LABELS`, `setProfile`); Day/Night radiogroup (`Day`,`Night`) bound to `useTheme`; Map data attribution line is in the footer already. Keyboard: on open, focus the dialog's first radio; `Escape` (document keydown while open) closes and focuses the button; click outside is not required. `levelOptions`:
```ts
export function levelOptions(scenarios: { id: string; label: string; stage_m?: number | null }[]) {
  const stages = scenarios
    .filter((s) => typeof s.stage_m === "number" && s.stage_m > 0)
    .sort((a, b) => (a.stage_m as number) - (b.stage_m as number))
    .map((s) => ({ id: s.id as string | null, label: `+${s.stage_m} m` }));
  return [{ id: null as string | null, label: "Normal" }, ...stages];
}
```
checked = `scenarioId === opt.id`. Pick → `useScene.getState().setScenario(opt.id)`.

`StatusLegend.tsx`: change `bg-white/95` to `bg-surface/95`, text colour `text-fg`, and append a `Suggested route` row using `ROUTE_STYLE` (stroke width 6 with a thin dashed centre line so it differs by pattern). Keep `aria-label="Path status legend"` and the existing order.

`MapStage.tsx`: copy `SceneHost.tsx` and remove: the view-switcher fieldset, the profile `<select>`, the no-keys card, and the outer `space-y-4`; the map container becomes `className="relative h-full min-h-72 overflow-hidden bg-surface"`; remove the legend overlay from here (the legend now lives in the popover); keep `RendererBoundary`, `selectView`/`availableViews`, `ListView` fallback (list view fills with `h-full overflow-auto p-4`), the `Suspense` loading state (`role="status"` text `Loading the township`), and the "gaps" legend branch removed (gaps feature is dropped from the UI: do not render `GapLegendPanel`). When the effective view is `list` because no key/WebGL exists, show above the list a `role="status"` note: `3D map couldn't load. Showing the list view instead. Everything the assistant does still works here.`; for the error-boundary fallback keep the existing alert text. Accept `children` rendered inside the container (the cards, notes, settings).

- [ ] **Step 4: Run tests, typecheck, PASS.**
- [ ] **Step 5: Commit** `feat(web): map stage, settings popover, flood note and route tag`.

---

### Task 9: Place and path cards as map overlays

**Files:**
- Create: `apps/web/src/features/map-ui/PlaceOverlay.tsx`, `PathOverlay.tsx`, `PlaceOverlay.dom.test.tsx`, `PathOverlay.dom.test.tsx`
- Reuse: `toPlaceView`, `SourceBanner`/`ClosureBanner`, `EvidencePhoto`, `floodPathView`, `usePlace`, `placeReach`, `useLayer`/`useScenarios`.

**Interfaces:** `<PlaceOverlay />` (renders when `selectedPlaceId`), `<PathOverlay />` (renders when `selectedFloodEdgeId`); both absolute-positioned `top-4 right-4 w-[330px] max-w-[calc(100%-2rem)]`, `role="dialog"`, labelled, Escape closes, focus moves to heading and returns on close, close button named `Close place details` / `Close path details`.

- [ ] **Step 1: Failing tests.** `PlaceOverlay.dom.test.tsx`: stub `/api/places/<id>` returning `{ok:true,data:{id:"p1",name:"Dewan Komuniti",kind:"evac_centre",source:"osm_candidate",type:"community_hall",claims:{wheelchair:{value:null,status:"unknown"},capacity:{value:300,status:"reported",evidence_type:"team_survey_placeholder"}}}}`; set `useScene.getState().selectPlace("p1")`; assert: heading `Dewan Komuniti`; a `Candidate` text (via `SourceBanner`, label contains "Candidate") and **no** text "Official"; the placeholder fact shows `Demo value · not surveyed` and its chip is not `Verified`; the unknown fact shows `Not checked yet`; a `Close place details` button clears `selectedPlaceId`; Escape closes; there is **no** "Edit" button and no staff-token UI. `PathOverlay.dom.test.tsx`: set `selectFloodEdge("e1")` with layer + scenarios stubs (see `FloodPathPopover.dom.test.tsx` for the stubs to copy); assert heading `Why this path?`, text containing `indicative`, and that no text matches `/\bsafe\b|\d+(\.\d+)?\s?(m|cm) deep|depth/i`; Escape closes.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `PlaceOverlay.tsx`: start from the existing `PlaceCardInner` in `features/places/PlaceCard.tsx` but remove `AttributeEditor`, `AuditHistory`, `loadToken` and the `Edit` button/`saved`/`editing` state; keep fetching, `toPlaceView`, `SourceBanner`, `ClosureBanner`, fact rows (render each row's status with `<StatusChip>`: `placeholder`→ `status="demo"`; else map `r.status` → `verified|reported|unchecked` (`unknown`/`stale`/`contested` → `unchecked`, label from `r.statusLabel` + ` ` + `r.verifiedAt` when verified); for evacuation centres add the `Evacuation centre` row with `<StatusChip status={view.sourceTone === "official" ? "official" : "candidate"}/>` and the note text `Listed as an official relief centre. Opening depends on the authorities.` / `Found in map data. Not confirmed as an official relief centre.`), `EvidencePhoto`, and the `Ask about this place` button (prefills draft `Tell me about {name}` and focuses `#chat-input`). Position classes: `absolute right-4 top-4 z-20 w-[330px] max-w-[calc(100%-2rem)] max-h-[calc(100%-6rem)] overflow-y-auto rounded-2xl border border-edge bg-surface p-4 shadow-xl`.
  - `PathOverlay.tsx`: reuse `FloodPathCard` from `features/flood/FloodPathPopover.tsx` logic (`floodPathView`) in the same overlay position; heading `Why this path?`, rows Scenario / Classification / How it was worked out (method, DEM, margin) / disclaimer, with a `<StatusChip status={likely|possibly}>`. Keep the existing wrapper hook that resolves the edge from the layer (copy from `FloodPathPopover`'s default export).
  - Keep `features/places/{placeModel,SourceBanner}.ts(x)` and `features/flood/floodPath.ts` and their tests. The old `PlaceCard.tsx` and `FloodPathPopover.tsx` are deleted in Task 12.
- [ ] **Step 4: Run tests, typecheck, PASS.**
- [ ] **Step 5: Commit** `feat(web): place and path overlay cards`.

---

### Task 10: Ticket model, list and detail (read side)

**Files:**
- Create: `apps/web/src/features/tickets/ticketModel.ts`, `ticketModel.test.ts`, `useTickets.ts` (extend), `TicketList.tsx`, `TicketDetail.tsx`, `BeforeAfter.tsx`, `TicketList.dom.test.tsx`

**Interfaces:**
- `VR` (from `manageApi`). `toTicket(vr: VR, names: Map<string,string>, now?: Date): Ticket` where
```ts
interface Ticket {
  id: string; fact: string; place: string; reason: string; reasonLabel: string;
  kind: string; asked: number; ago: string; current: string | null; hasCurrent: boolean;
  isOpen: boolean; isRejected: boolean; isChecked: boolean;
  resolution: { outcome: "verify" | "correct" | "reject"; value: string | null; date: string } | null;
}
```
- `groupTickets(ts: Ticket[]): { toCheck: Ticket[]; checked: Ticket[] }` (To check sorted by `asked` desc then newest; Checked newest first).
- `timeAgo(iso: string, now: Date): string` (`just now`, `N min ago`, `N h ago`, `N d ago`).
- `useTickets(): { tickets: Ticket[]; isPending; isError; refetch }` — fetches `status=all` once via `fetchVRs("?status=all")`, query key `["tickets","all"]`, merged with `useQueueNames()`.
- `useOpenTicketCount()` (from Task 5) reads the same query so there is one cache (change it to derive from `["tickets","all"]` filtered `open`).

- [ ] **Step 1: Failing tests** `ticketModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupTickets, timeAgo, toTicket } from "./ticketModel";

const NOW = new Date("2026-10-16T12:00:00Z");
const vr = (o: Record<string, unknown> = {}) => ({
  id: "vr-1", element_id: "seg-1", attribute: "step_count", reason: "no_route_unverified_segment",
  status: "open", demand: 14, question_summary: "Stroller route from Car Park B to Playground",
  created_at: "2026-10-16T10:00:00Z", current_value: null, ...o,
}) as never;

describe("ticketModel", () => {
  it("maps fields to structured ticket text only", () => {
    const t = toTicket(vr(), new Map([["seg-1", "Block C footway"]]), NOW);
    expect(t.fact).toBe("Step count");
    expect(t.place).toBe("Block C footway");
    expect(t.reasonLabel).toBe("No route: unverified segment");
    expect(t.asked).toBe(14);
    expect(t.ago).toBe("2 h ago");
    expect(t.hasCurrent).toBe(false);
    expect(t.isOpen).toBe(true);
  });
  it("falls back to the id when the element has no name", () => {
    expect(toTicket(vr(), new Map(), NOW).place).toBe("seg-1");
  });
  it("sorts To check by times asked, most first", () => {
    const g = groupTickets([toTicket(vr({ id: "a", demand: 2 }), new Map(), NOW), toTicket(vr({ id: "b", demand: 9 }), new Map(), NOW)]);
    expect(g.toCheck.map((t) => t.id)).toEqual(["b", "a"]);
  });
  it("resolved and rejected tickets are Checked; rejected is flagged", () => {
    const r = toTicket(vr({ status: "resolved", resolved_at: "2026-10-16T11:00:00Z", resolution: { action: "correct", value: "0 steps" } }), new Map(), NOW);
    const x = toTicket(vr({ status: "rejected", resolved_at: "2026-10-16T11:00:00Z", resolution: { action: "reject" } }), new Map(), NOW);
    expect(r.isChecked).toBe(true);
    expect(r.resolution?.value).toBe("0 steps");
    expect(x.isRejected).toBe(true);
    expect(groupTickets([r, x]).checked).toHaveLength(2);
  });
  it("never exposes a resident's own words: only the structured question_summary", () => {
    const t = toTicket(vr({ question_summary: null }), new Map(), NOW);
    expect(t.kind).toBe("Resident question");
  });
  it("timeAgo", () => {
    expect(timeAgo("2026-10-16T11:59:40Z", NOW)).toBe("just now");
    expect(timeAgo("2026-10-16T11:30:00Z", NOW)).toBe("30 min ago");
    expect(timeAgo("2026-10-14T12:00:00Z", NOW)).toBe("2 d ago");
  });
});
```
`TicketList.dom.test.tsx`: render `TicketsPage` inside a memory router with `fetch` stub returning 3 VRs (two open with demand 14 and 3, one resolved); assert: group headings `To check` (with count `2`) and `Checked`; open list order most-asked first; each row text contains fact, place, reason, `Asked 14×`, and an ago string; clicking a row marks `aria-pressed="true"` and shows detail heading with the fact; **no** text from a resident's free message (stub `question_summary` is structured).

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `ticketModel.ts`: `toTicket` uses `attributeLabel(vr.attribute)`, `reasonLabel(vr.reason)` (both in moved modules), `names.get(vr.element_id) ?? vr.element_id`, `vr.question_summary ?? "Resident question"`, `hasCurrent = hasCurrentValue(vr.current_value)` (from `resolveForm`), `current = hasCurrent ? currentValueText(vr.current_value) : null`, `isOpen = status==="open"||status==="in_progress"`, `isRejected = status==="rejected"`, `isChecked = status==="resolved"||isRejected`, `resolution` from `vr.resolution` (`action`, `value` → string, `date` = `vr.resolved_at`'s `d Mon yyyy` via `Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"})`).
  - `useTickets.ts`: as in Interfaces.
  - `TicketList.tsx`: `<section aria-label="Ticket list">`; heading `Gaps to close`, sub copy and the PDPA line from the mockup; `<h2>To check <span class="badge">{n}</span></h2>`; buttons `aria-pressed` per ticket, content: fact (bold), ago, place, reason chip, `Asked {n}×` pill; `Nothing left to check.` when none; Checked group rows with `StatusChip` (`verified` with label `Verified {date}`, or `rejected`).
  - `TicketDetail.tsx` (read part only here; the form is Task 11): header (reason uppercase, fact `<h2>`, place), a `<dl>` with `Came from a question like`, `Times asked`, `Recorded value` (`Nothing recorded yet` when none), then slot `{open ? <OutcomeForm/> : <BeforeAfter/>}`; for rejected: `Rejected on {date}. The ticket wasn't valid, so the recorded fact stays as it was.`
  - `BeforeAfter.tsx`: two panels `Before` (dashed lilac, text `{current ? current + " · " : ""}Not checked yet`) and `Now` (accent surface, `Verified on {date}: {value}`), plus a `Photo` from `resolution`/evidence when present, plus the replay button (Task 11).
  - `TicketsPage.tsx`: two-column grid `lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]`; selected id state (default: first open ticket); on narrow screens the detail is shown instead of the list when a ticket is selected with a `Back to list` button.
- [ ] **Step 4: Run tests, typecheck, PASS.**
- [ ] **Step 5: Commit** `feat(web): tickets list and detail from verification requests`.

---

### Task 11: Outcome form, staff access, save and before/after

**Files:**
- Create: `apps/web/src/features/tickets/OutcomeForm.tsx`, `StaffAccess.tsx`, `OutcomeForm.dom.test.tsx`
- Modify: `TicketDetail.tsx`, `BeforeAfter.tsx`

**Interfaces:** `<OutcomeForm ticket onSaved />`; `<StaffAccess token setToken />`. Mapping from the form to the existing API: Confirm → `{action:"verify", note}`; Correct/Record → `{action:"correct", value, note}` (value parsed by `buildResolveBody`/`parseValue` with `specFor(attribute)`); Reject → `{action:"reject", note}`. `note` = optional field text, else `"Checked on site"`. Photo (JPEG/PNG ≤ 5 MB via `validatePhoto`) is uploaded first with `uploadEvidence(file, token)` and its id sent as `evidence_id`; photo is dropped on Reject (existing `photoAfterAction`).

- [ ] **Step 1: Failing tests** `OutcomeForm.dom.test.tsx` (use `renderWithClient`, `stubFetch`; patterns in the moved `ResolveForm.dom.test.tsx` — read it for the fetch-stub shape):
  1. With a recorded value: radiogroup `Outcome` has `Confirm`, `Correct`, `Reject`. With none: `Record what you found` and `Reject` only, **no** `Confirm` (Review Focus 3).
  2. Save is disabled until an outcome is chosen; for Correct also until a value is entered.
  3. Confirm posts `POST /api/verification-requests/vr-1/resolve` with `{action:"verify"}`, header `X-Staff-Token: tok`, then calls `onSaved`.
  4. Correct with value `0 steps` posts `{action:"correct", value:"0 steps"}` (text attr) — and for a number attribute (`step_count`) posts the number.
  5. A photo uploads first (`/api/evidence`), then resolve includes `evidence_id`; Reject drops the photo.
  6. With no token the form shows `Staff access needed` inline and Save is disabled until a token is entered (Review Focus 2); a `401`/`403`/`503` response shows `Staff access needed`, keeps the typed value and outcome, and does not call `onSaved`.
  7. A `409` shows `Someone else already resolved this ticket.` and refetches.
  8. Photo > 5 MB shows the `validatePhoto` message and never uploads.
  9. `sessionStorage` throwing does not crash (`useStaffToken` tolerates it already; assert render succeeds with `vi.spyOn(Storage.prototype,"getItem")` throwing).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the form per the mockup (title `What did you find on site?`; outcome cards `min-h-16` radio buttons with the label + description (`It's right as recorded` / `It's different. Enter the value` or `Enter what is there` / `The ticket isn't valid`); value input labelled `Value found on site` (placeholder = hint from attribute: `e.g. 0 steps · ramp at both ends` for step_count else `e.g. {example}` generic `Enter the value`), optional note input labelled `Note (optional)`, photo `<label>` button `Add photo`/`Change photo` with hidden `<input type="file" accept={PHOTO_ACCEPT}>` (accessible name via the label), preview, and `<Button>Save result</Button>`). `StaffAccess`: collapsible block shown at the top of the detail panel when `!token`: label `Staff access`, password input, helper `Kept for this browser session only.`; wired to `useStaffToken`. On success: `queryClient.invalidateQueries({queryKey:["tickets"]})`, then `onSaved()`. After the refetch the selected ticket flips to Checked and `BeforeAfter` shows. In `BeforeAfter` add the replay button `Ask the question again` (only when the ticket's `kind` maps to a known starter: if `ticket.kind` starts with `Stroller route` → resident starter 1, `Wheelchair route` → starter 2, otherwise hidden) which does `useMode.getState().setMode("resident"); useChatDraft.getState().ask(starter.text, {profile: starter.profile}); navigate("/")` and the caption `The next answer uses the checked fact.`.
- [ ] **Step 4: Run tests, typecheck, PASS.**
- [ ] **Step 5: Commit** `feat(web): ticket outcome form, staff access and before/after`.

---

### Task 12: Main page composition and responsive layout

**Files:**
- Create/replace: `apps/web/src/features/main/MainPage.tsx`, `MainPage.dom.test.tsx`

**Interfaces:** `MainPage` = `<div className="grid h-[calc(100vh-…)]…">` two columns on `lg` (`lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]`), single column below: map section `h-[56vh] min-h-72`, assistant `min-h-[60vh]`. Map section: `aria-label="3D map of City of Elmina"` containing `<MapStage>` with children `<RouteTag/> <FloodNote/> <SettingsPopover/> <PlaceOverlay/> <PathOverlay/>`.

- [ ] **Step 1: Failing test** `MainPage.dom.test.tsx` (list view because test env has no keys/WebGL): renders `MainPage` with `fetch` stub for `/api/site`, `/api/scenarios`, `/api/layers/*` (use the stubs from `features/scene/list/closures.dom.test.tsx` as reference), asserts: region `3D map of City of Elmina` and `complementary` (assistant) both present; the map region contains exactly **one** button initially besides list items (the `Map settings` button), i.e. no visible controls on the map by default (`within(map).queryByRole("radiogroup")` is null, legend hidden until settings opens); the list-view notice `3D map couldn't load` is shown; opening settings reveals the legend; choosing `+3 m` shows the flood note with `not a forecast` (after `/api/scenarios` stub resolves).
- [ ] **Step 2: Run, expect FAIL. Implement. Run, PASS.**
- [ ] **Step 3: Replace the stub `MainPage`.** `useEffect` to set `useScene` view as `SceneHost` did (auto-select once) lives in `MapStage`.
- [ ] **Step 4: Commit** `feat(web): main screen with map and assistant`.

---

### Task 13: Delete the superseded UI

**Files:** delete `apps/web/src/features/manage/` (remaining), `features/demo/`, `features/prototype-redesign/`, `app/ResidentPage.tsx`, `features/scene/SceneHost.tsx`, `features/places/PlaceCard.tsx` (+ `PlaceCard.dom.test.tsx`), `features/flood/{FloodPathPopover.tsx,FloodPathPopover.dom.test.tsx,ScenarioBar.tsx,ScenarioBar.test.tsx,DisclaimerBanner.tsx}`, `features/chat/{ChatPanel.tsx,ChatPanel.dom.test.tsx,suggestions.ts,suggestions.test.ts}`, `features/gaps/` (UI only: keep `gapModel.ts` only if still imported), `features/scene/DeepSpots.tsx(+test)` — each only after confirming it is unreferenced.

- [ ] **Step 1:** For each candidate run `Grep` for its import path; delete only if the only importers are other deleted files. Keep (and `git mv` next to importer per Ruling 3) anything still imported, e.g. `closureModel.ts` (imported by `features/scene/list/ListView.tsx` and `placeModel.ts`) → `git mv features/manage/closureModel.ts features/scene/list/closureModel.ts` and fix imports.
- [ ] **Step 2:** `git rm -r` the deletions; run `pnpm --filter @tl/web typecheck`, fix leftover import errors until clean.
- [ ] **Step 3:** `pnpm --filter @tl/web test` — all remaining tests PASS (deleted tests go with their components; record the count change in the ledger).
- [ ] **Step 4:** `pnpm lint` (biome + ruff); fix with `pnpm exec biome check --write`.
- [ ] **Step 5: Commit** `refactor(web): remove manage page, demo bar, prototype and old resident page`.

---

### Task 14: Honesty and accessibility regression tests

**Files:** Create `apps/web/src/test/honesty.dom.test.tsx`

- [ ] **Step 1: Write tests** rendering `MainPage` (resident and management), a flood level (`+3 m`), an assistant message with the mock's flood payload, a place overlay with placeholder evidence, and `TicketsPage` (both themes: set `useTheme.getState().setTheme("day"|"night")`). For each render assert on `document.body.textContent`: no `/\bsafe\b|selamat|安全/i`; no `/\b\d+(\.\d+)?\s?(m|cm|metres?)\b[^.]{0,20}\b(deep|depth)/i` and no `/depth/i` on a path card; flood content includes `not a forecast`; an element with `team_survey_placeholder` evidence shows `Demo value · not surveyed` and **no** `Verified` chip inside that fact row; a data-gap fact reads `No mapped connection (data gap)` and never `not reachable`; the OSM centre reads `Candidate`. Also: every `button`, `input`, `[role=radio]` and `a` has a non-empty accessible name (`screen.getAllByRole(...)` and check `toHaveAccessibleName()`), and every interactive element in the settings popover has min-height class `min-h-10` or `min-h-11` (class check).
- [ ] **Step 2:** Run, fix any violations in the owning component (never weaken the test). PASS.
- [ ] **Step 3: Commit** `test(web): honesty and accessibility regressions in both themes`.

---

### Task 15: Day/Night on the map renderers

**Files:** Modify `apps/web/src/features/scene/cesium/CesiumScene.tsx`, `apps/web/src/features/scene/mapbox/MapboxLite.tsx`; create `apps/web/src/features/scene/cesium/timeOfDay.ts`, `timeOfDay.test.ts`.

**Interfaces:** `cesiumTimeStyle(t: Theme): { skyColor: string; globeBase: string; tileBrightness: number; fogDensity: number; hue: number }` pure; `mapboxLightPreset(t: Theme): "day" | "night"`.

- [ ] **Step 1: Failing test** `timeOfDay.test.ts`: `cesiumTimeStyle("night").tileBrightness` < `cesiumTimeStyle("day").tileBrightness`; day brightness is `1`; `mapboxLightPreset("night") === "night"`; both pure/total.
- [ ] **Step 2:** Implement `timeOfDay.ts` (night: sky `#1f1838`, brightness `0.45`, fog `0.0004`; day: sky `#9bc4e8`, brightness `1`, fog `0.0001`).
- [ ] **Step 3:** In `CesiumScene.tsx` subscribe to `useTheme((s) => s.theme)` and in an effect apply: `viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(sky)`; `viewer.scene.skyAtmosphere` show/ground colour; `viewer.scene.fog.density`; set `tiles.style`/shader brightness via `tiles.customShader` with a fragment shader `material.diffuse *= u_brightness;` (CustomShader uniform) — use `new Cesium.CustomShader({ uniforms:{ u_brightness:{type:Cesium.UniformType.FLOAT,value:b}}, fragmentShaderText:"void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material){ material.diffuse *= u_brightness; }"})`. Then **always** `viewer.scene.requestRender()` (the viewer uses `requestRenderMode`). Do not touch height sampling of Google tiles (display-only licence).
- [ ] **Step 4:** In `MapboxLite.tsx` on style load and on theme change call `map.setConfigProperty("basemap", "lightPreset", mapboxLightPreset(theme))` (Mapbox Standard config; if the style isn't Standard, guard with try/catch and ignore).
- [ ] **Step 5:** `pnpm --filter @tl/web typecheck && pnpm --filter @tl/web exec vitest run src/features/scene` PASS. Visual check of day/night happens in Task 17 (real 3D, budgeted).
- [ ] **Step 6: Commit** `feat(web): day and night map lighting for Cesium and Mapbox`.

---

### Task 16: Update e2e for the two-screen flow

**Files:** Rewrite `apps/web/e2e/heroes.spec.ts`; delete `apps/web/e2e/demo.spec.ts` (DemoBar is gone) after confirming it only tests the demo bar.

- [ ] **Step 1:** Rewrite `heroes.spec.ts` (mock LLM, tiny fixture, list view, `STAFF_TOKEN=e2e-token`):

```ts
import { expect, type Page, test } from "@playwright/test";

async function ask(page: Page, question: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Your question" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

test("list fallback keeps the product working as text", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/3D map couldn't load/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Map settings" })).toBeVisible();
});

test("access hero shows a route status and honest demo evidence", async ({ page }) => {
  await ask(page, "Can I push a stroller from Car Park B to the playground without stairs?");
  const log = page.getByRole("log");
  await expect(log).toContainText(/Route status: confirmed/);
  await expect(log).toContainText(/Demo value · not surveyed/);
});

test("flood answer carries the disclaimer and never says safe", async ({ page }) => {
  await ask(page, "Priya uses a wheelchair at Lakeside Mall. If the river rises 3 m, where can she go?");
  const log = page.getByRole("log");
  await expect(log.getByText(/not a forecast/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  await expect(log).not.toContainText(/\bsafe\b/i);
});

test("settings popover sets a river level and shows the flood note", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Map settings" }).click();
  await page.getByRole("radio", { name: "+3 m" }).click();
  await expect(page.getByRole("note")).toContainText(/indicative scenario, not a forecast/i);
});

test("day/night toggle switches the app theme", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Switch to (day|night) theme/ }).click();
  const t = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(["day", "night"]).toContain(t);
});

test("management: a gap becomes a ticket, staff resolve it, before/after shows", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Management" }).click();
  await ask(page, "Can I push a stroller from Car Park B to the kiosk without stairs?");
  await page.getByRole("radio", { name: "Management" }).click();
  await expect(page.getByRole("log")).toContainText(/Route status: partly unverified/);
  await page.getByRole("link", { name: /Tickets/ }).click();
  await expect(page.getByRole("heading", { name: "Gaps to close" })).toBeVisible();
  await page.getByRole("button", { pressed: false }).first().click();
  await page.getByLabel("Staff access").fill("e2e-token");
  await page.getByRole("radio", { name: /Record what you found|Correct/ }).click();
  await page.getByLabel("Value found on site").fill("4");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText(/Verified on/)).toBeVisible();
  await expect(page.getByText("Not checked yet").first()).toBeVisible();
});
```
(Adapt the ticket selection and the exact fact names to the tiny fixture: the kiosk route's open VR is `seg-cf` / `incline_pct`; if `Correct` is the default outcome use it. The `ask` helper switches to resident implicitly because the question is mode-independent; keep the Management switch before opening Tickets.)

- [ ] **Step 2:** `pnpm --filter @tl/web e2e` (first time: `pnpm --filter @tl/web exec playwright install chromium`). Fix selectors until PASS; do not weaken assertions about wording.
- [ ] **Step 3: Commit** `test(web): e2e for the two-screen flow`.

---

### Task 17: Quality evaluation

**Files:** Create `docs/superpowers/overnight-log.md` entries (append), `docs/03-product/frontend-quality-report.md`.

- [ ] **Step 1: Automated suite.** Run and record PASS/FAIL (mock-backed where applicable): `pnpm lint`, `uv run pytest -q`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm gen && git diff --exit-code packages/api-client`, `pnpm golden`, `pnpm --filter @tl/web build`, `pnpm --filter @tl/web e2e`.
- [ ] **Step 2: Lighthouse.** Start `townshiplens-dev-mock` (List view, no billable tiles; see `.claude/launch.json`; on Windows start with `LLM_PROVIDER=mock pnpm dev` in the background). Using the Chrome DevTools MCP `lighthouse_audit` (mode navigation, device desktop and mobile) on `/` and `/tickets`, in both themes (set `localStorage.setItem("tl.theme","day")` before load for day). Record accessibility, best-practices and performance scores. Targets: accessibility ≥ 95 on both screens in both themes. Fix any contrast, name or target-size failure at its source, then re-run.
- [ ] **Step 3: Keyboard and responsive.** With the browser tools: Tab through `/` (skip link, mode radios, settings, assistant, starters), Escape closes the popover and cards, the resolve flow is keyboard-only; resize to 390×844, 820×1180, 1440×900 and capture `read_page`/text checks that the assistant is reachable without scrolling past a full-height map and no horizontal scroll exists. No screenshots unless a check fails.
- [ ] **Step 4: Real 3D look (budgeted, ≤ 6 loads).** With real keys in `.env` (never print them) start `pnpm dev` once, load `/` in day and night, and from the Central Park + Lakeside Mall home view check: building proportions and scale, camera tilt and range, route/flood line legibility over the tiles, and that Night is readable. Fix camera/tint parameters in `features/scene/cesium/home.ts`/`timeOfDay.ts` if needed. Log the load count and cost note. If keys are absent, mark `NOT RUN (no keys)` and say so.
- [ ] **Step 5: Independent evaluation.** Spawn the `evaluator` agent with this prompt: "Evaluate the branch `feat/redesign-two-screens` against `docs/superpowers/specs/2026-10-16-frontend-redesign-two-screens-design.md` and `docs/03-product/frontend-redesign-brief.md`. Read-only except for your report. Check every screen state, wording rule and accessibility requirement; browser-test at `http://localhost:5173` using mock mode and the list view only (do not load real 3D). Return a severity-ranked issue list and a 0–100 weighted score." Fix every critical/major finding, re-run affected checks, and record the score.
- [ ] **Step 6:** Write `docs/03-product/frontend-quality-report.md` (scores, check table with PASS/FAIL/BLOCKED/NOT RUN and mock-backed notes, remaining issues). Append a dated entry to `docs/superpowers/overnight-log.md` using real `date` timestamps.
- [ ] **Step 7: Commit** `docs: frontend quality report and overnight log`.

---

### Task 18: Docs, final checklist, and hand-off to Project 2

**Files:** Modify `apps/web/README.md`, `AGENTS.md` (architecture bullets that name `/manage`, the DemoBar or the old resident page), `docs/03-product/mvp-spec.md` (status line), the spec (ruling 1 note); create `docs/superpowers/plans/2026-10-16-frontend-redesign-two-screens.md` ledger pointers.

- [ ] **Step 1:** Update the docs to describe the two screens, the theme layer and Tickets; remove stale `/manage`/DemoBar references (Grep `manage`, `DemoBar`, `ResidentPage` across `*.md`).
- [ ] **Step 2:** In the spec, change "`sceneStore` gains `timeOfDay`" to "the theme store (`ui/theme.ts`) is the single source of day/night; `sceneStore` gains `mapStyle`" (Ruling 1).
- [ ] **Step 3:** Re-run the full checklist from Task 17 Step 1, report each result honestly. Verify on a clean tree: `git status --short`.
- [ ] **Step 4: Commit** `docs: describe the two-screen frontend`.
- [ ] **Step 5: Project 2 hand-off (autonomous).** Per the owner's instruction, do not stop. Start Project 2 (stylised city): invoke `superpowers:brainstorming` in autonomous mode using the recorded decisions (Option B: committed OSM building footprints + our own renderer inside the existing Cesium viewer; low-poly buildings with a day look and a night look with lit windows; trees/roads/props; real Elmina footprints and heights; consumes `useTheme` and `useScene.mapStyle`; cost-aware Overpass use via `data/scripts/overpass.py`; no height/hydrology derived from Google tiles). Write `docs/superpowers/specs/2026-10-16-stylised-city-design.md`, then `superpowers:writing-plans`, then execute it, on a new branch `feat/stylised-city` cut from the tip of `feat/redesign-two-screens`. Do not push either branch.
