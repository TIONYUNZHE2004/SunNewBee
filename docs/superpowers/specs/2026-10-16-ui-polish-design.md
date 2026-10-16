# UI polish: Kamui daylight, floating glass layout, clearer answers (Project 4)

Status: design approved section by section with the owner on 2026-10-16 ("follow your taste"). Runs in the same round as Project 3 (`docs/superpowers/specs/2026-10-16-stylised-city-enhancement-design.md`) and starts after its Phase 1, because it uses the three-mood theme, `skinFor` and the camera-control cluster from there. Builds on Project 1 (`docs/superpowers/specs/2026-10-16-frontend-redesign-two-screens-design.md`) and the handoff brief in `TownshipLens Frontend Redesign-handoff.zip` (`project/uploads/frontend-redesign-brief.md`), whose content, wording and accessibility rules all still apply.

Owner's intent: the current Day skin is the night palette inverted and feels like dusk, not daylight. Day and Dusk share one Light chrome (they differ only in the 3D map); Night keeps the Kamui night chrome. Beyond colour, improve the other UI components so the product feels more polished and easier to use.

## Goal

A judge sees a polished, immersive screen where the map dominates and the assistant floats over it; an answer reads at a glance (text, then a summary, then details on demand) without losing any honesty note; the Tickets demo moment (before / after) lands clearly; and the phone layout keeps the assistant reachable.

## Constraints (unchanged, restated)

- All wording rules from the brief and AGENTS.md: never "safe" / "selamat" / "安全", no water depth on a path, flood content says "indicative" and "not a forecast", "Not checked yet", "No known barrier", "Verified" only for staff-checked facts, "No mapped connection (data gap)", "Demo value · not surveyed", "Candidate" vs "Official".
- **Honesty notes are never collapsed or hidden**: the not-verified note, the flood disclaimer with official links, and demo-value labels stay visible whenever their answer is visible. Only the evidence card list and the checks list may collapse, and their collapsed summary must state the demo-value count.
- Status is never colour alone (border pattern plus text label). Every control has an accessible name; touch targets ≥ 44 px; full keyboard use; streaming answers announced politely.
- Tickets show only structured fields (PDPA).
- Attribution stays visible at all times (licence).
- Dependencies: no icon pack (Lucide is ISC, not on the MIT / Apache-2.0 / BSD allow-list); icons are a small in-repo inline SVG set.

## 1. Visual system

Two chrome skins, chosen by `skinFor(theme)` from Project 3 (Day and Dusk: Light; Night: Dark). Tokens live in `apps/web/src/index.css`, keyed off `:root[data-skin]`; the existing semantic variable names (`--c-bg`, `--c-surface`, `--c-fg`, …) and the Tailwind `@theme inline` mapping are kept, so components change little.

| Token | Light (Day + Dusk) | Dark (Night) |
|---|---|---|
| Page background | `#f5f2fa` | `#1f1838` |
| Glass panel | `rgba(255,255,255,0.80)`, `backdrop-filter: blur(16px)`, 1 px white top highlight | `rgba(36,28,66,0.82)`, blur 16 px |
| Text | `#241c42` | `#ffffff` |
| Soft text | `#5a5078` | `rgba(255,255,255,0.82)` |
| Accent (primary buttons, selected mode) | `#5b45a0`, text white | `#fdf0ea`, text `#3d2f6b` |
| Highlight (focus ring, active tool) | `#b4610a` | `#f6a94a` |
| Edge | `rgba(36,28,66,0.12)` | `rgba(255,255,255,0.14)` |
| Panel shadow | `0 8px 32px rgba(91,69,160,0.18)` | `0 8px 32px rgba(0,0,0,0.35)` |

- Type unchanged: Marcellus (display, wordmark), Jost (UI). Radii: buttons 8 px, cards 16 px, pills full.
- Status tones keep their current hues, re-tuned where needed so each passes WCAG AA on its skin's glass (tested). Border patterns (solid / dashed / dotted) unchanged.
- Glass fallback: when `backdrop-filter` is unsupported, panels use the opaque surface colour.
- Icons: inline SVG components in `apps/web/src/ui/icons/` (walk, stroller, wheelchair, older adult, car, flood, recycle, pin, route, check, ticket, compass, chevron, send), `aria-hidden` with text labels beside them.
- Motion: 200 ms, `cubic-bezier(.2,.7,.2,1)`; hover lifts 1 px, press settles, panels slide in; chrome crossfades 300 ms on a skin change. All collapse under `prefers-reduced-motion`.

## 2. Layout (main screen)

- The map is **full-bleed** under the header. The assistant is a **floating glass panel** on the right, inset 16 px, width `clamp(360px, 30vw, 440px)`, full height below the header. This keeps the brief's map-left / assistant-right split while making the map immersive.
- The camera framing (Home, Whole township, `camera.fly_to`, `place.focus`, `route.highlight`) is offset so its subject is centred in the visible map area (map width minus panel). Implemented as a pure `visibleViewport()` used by the framing helpers; tested.
- A handle collapses the panel to a slim tab (full-map view); state remembered in localStorage. Collapsing never hides an in-progress answer's notes: reopening shows them.
- Header: slim glass bar over the map: wordmark and site name, mode switch with a sliding pill indicator, Tickets button with open count (Management), theme menu (Auto · Day · Dusk · Night, from Project 3).
- Attribution: a small glass strip at the bottom-left of the map, same text, always visible.
- The camera cluster and Map settings button (Project 3) sit at the bottom-right of the visible map area, left of the panel.

## 3. Assistant panel

- **Empty state**: heading and mode line (brief wording), then starter questions as icon cards in a 2×2 grid; one tap sends.
- **User message**: right-aligned accent bubble.
- **Answer card**, in the brief's order of importance:
  1. Answer text, streaming, with a soft caret.
  2. **Summary strip**: route answers show the status chip (pattern + label), distance, walking time and a **Show on map** button that re-applies the route's scene intent; flood answers show the scenario chip ("+3 m · indicative"). Only fields present in the turn's tool results are shown; nothing is computed in the UI. To make that possible the server attaches `route_status`, `distance_m` and `est_minutes` to `route.highlight` scene intents from the route `plan_route` returned this turn (the same way it already attaches `geojson`); the model cannot set them. Older demo recordings without these fields simply show no strip.
  3. **Checks**: live checklist while running; once done, collapses to "✓ N checks", expandable.
  4. Not-verified note and flood disclaimer (with official links): restyled, **never collapsible**.
  5. **Evidence**: collapsed by default to "Evidence · N sources · M demo values"; expands to the existing evidence cards (which keep "Demo value · not surveyed").
  6. Ticket line with a ticket icon: "A check has been requested from the township team".
- Refusal ("Can't answer that yet") stays a calm dashed card, not an error; a real error shows "Try again".
- **Composer**: pill input, round send button (accessible name "Ask"), mode-specific placeholder. In Resident mode a **"Travelling as: <profile> ▾"** chip above the input opens the same profile choice as Map settings (one shared store value; tested in sync).
- Streaming text remains in a polite live region.

## 4. Map overlays

- Shared glass card style for the place card, "Why this path?" card and route tag.
- Place card: title, kind icon, facts as rows with status chips, evidence photo, Candidate / Official badge for evacuation centres; slides in at the bottom-left of the visible map area.
- Flood note: glass banner at the top of the map: "Indicative scenario, not a forecast · Official guidance: MBSA · JPS · NADMA" (links as today).
- Map settings popover: grouped sections with icons: Theme, Map style, Motion, Quality, Camera controls, Travelling as (Resident), River level, Legend (real line samples showing the solid / dashed / dotted pattern next to each label), and "Decorative details are illustrative."
- Loading state: wordmark with a thin animated line tracing a street grid, plus "Loading the township" for screen readers (`role="status"`); static under reduced motion. List fallback messages unchanged in wording.

## 5. Tickets screen

- List: To check / Checked as tabs with counts; each card shows the fact, place, reason chip, age and a "times asked" bar (sorted most asked first, as today).
- Detail: one glass card with the same content as today. Outcomes become large choice cards with icons: Confirm, Correct (or "Record what you found" when nothing is recorded), Reject. Photo picker shows a thumbnail preview; the existing metadata stripping is unchanged.
- **Before / after**: after saving, the two states sit side by side and the "Verified on <date>: <value>" side gets a short highlight animation (static under reduced motion).
- Staff access field and its session-only storage unchanged.

## 6. Mobile (narrow screens, below the `lg` breakpoint)

- The assistant becomes a **bottom sheet** over the full-bleed map with three snap heights: peek (composer visible), half, full. Drag handle plus keyboard-operable buttons (accessible names "Expand assistant" / "Collapse assistant"). The composer is always reachable without scrolling past the map.
- Header controls collapse into a compact row; the theme menu and Tickets button stay reachable.
- Tickets: the detail opens over the list with a Back button.

## 7. Testing and delivery

- Update existing jsdom / SSR tests for the new structure (they query by role and label, so most carry over).
- New tests: skin tokens per `data-skin` and AA contrast of text and status tones on each glass; evidence collapse / expand with the demo-value count in the summary; honesty notes present and not inside any collapsible; checks collapse after completion; Show on map re-applies the route intent; panel collapse remembered; `visibleViewport()` offsets; bottom-sheet snap heights by button and keyboard; Travelling-as chip and settings stay in sync; icons are `aria-hidden` with visible labels.
- Playwright e2e (tiny fixture, List view): update selectors; assert the starter cards send, evidence expands, the honesty notes stay visible, and Tickets before / after still appears.
- Manual screenshots in Light and Dark at 1440×900 and 390×844, shared with the owner.
- Delivery (after Project 3 Phase 1), each phase passing the full CI checklist:
  - **UI-1**: visual system, layout, header, assistant panel, composer.
  - **UI-2**: answer card, map overlays, Tickets, mobile bottom sheet, loading state.
- Docs: update `apps/web/README.md` (skins, layout, icons) and the handoff-derived notes in Project 1's spec where they now differ (floating panel, collapsible evidence).
