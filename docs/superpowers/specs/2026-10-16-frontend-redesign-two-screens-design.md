# Frontend redesign: two screens (Project 1)

Status: written 2026-10-16 from the brainstorm with the project owner. Autonomous overnight run: the owner asked for Project 1 and then Project 2 (stylised city) to proceed without waiting for review. Rulings are logged in the plan ledger.

Inputs: `docs/03-product/frontend-redesign-brief.md` (what the product must show), the Claude Design handoff `TownshipLens Frontend Redesign-handoff.zip` (`TownshipLens.dc.html`, KAMUI tokens). The handoff is a visual and interaction reference only. Its CSS-faked 3D plane, scripted answers and hardcoded tickets are demo scaffolding and are not built.

## Goal

A simpler frontend with two screens so a judge understands the product in about 90 seconds: a resident question with a route on the map, a flood what-if, a management question, and a gap being fixed so the answer changes. The backend, honesty rules and API do not change.

## Decisions (from the owner)

| Topic | Decision |
|---|---|
| Approach | Rebuild the screens in place, reuse the engine (chat stream, scene store, renderers, API client). |
| Visual style | Adopt the mockup's KAMUI-derived style as the TownshipLens theme (Marcellus + Jost, indigo / dawn-pink / cream / lantern). |
| Old features | `/manage` page, DemoBar, old `ResidentPage` and `prototype-redesign/` are removed from the UI. Backend APIs stay. |
| Staff token | Asked once on the Tickets screen, kept for the browser session only, never in the bundle. |
| Theme | A Day / Night toggle changes the map and the whole app theme. Night is the mockup palette; Day uses cream/peach surfaces with indigo text. |
| City look | The 3D city should look like the stylised low-poly night reference (lit windows, props). That is Project 2; Project 1 only provides the hooks. |
| Quality | Evaluation is a fixed step: Lighthouse, keyboard and screen-reader pass, responsive checks, honesty scans, independent evaluator agent. |

## Scope

In: main screen, Tickets screen, shared UI kit, theme tokens and Day/Night, quality evaluation, deletion of the superseded UI.
Out: road and infrastructure planning, resident accounts, real-time flood data, any API or data change, the stylised city renderer (Project 2).

## Structure

Routes: `/` (main) and `/tickets`. Header: wordmark and township name, Resident/Management switch (main only), Tickets button with open count (Management only), Back to map (tickets), Day/Night toggle.

```
apps/web/src/
  app/            shell, router, providers (replaces Shell/ResidentPage)
  ui/             tokens-aware primitives: Button, StatusChip, Card, ThemeToggle
  features/main/        MainPage layout (map ~2/3, assistant ~1/3, stacks on narrow), mode state
  features/assistant/   AssistantPanel, AnswerCard, StarterQuestions, ChatInput
  features/map-ui/      SettingsPopover (legend, river level, travelling as, day/night), PlaceCard, PathCard, FloodNote, RouteTag
  features/tickets/     TicketList, TicketDetail, OutcomeForm, BeforeAfter, StaffAccess
```

Reused unchanged (restyled only): `useChatStream`, `chatReducer`, `parseSse`, `sceneStore`, Cesium/Mapbox/List renderers, `selectView`, `lib/evidence.ts`, `@tl/api-client`. Their existing tests stay green.

Deleted: `features/manage/*`, `features/demo/*` (DemoBar), `features/prototype-redesign/*`, `app/ResidentPage.tsx`, and old components no longer referenced (confirmed by typecheck and a reference search before deleting). `features/gaps`, `features/places`, `features/flood`, `features/chat` pieces are kept only where the new screens use them; otherwise removed.

## Main screen

- **Mode switch** (radiogroup): Resident / Management. It changes the assistant heading and subtext, starter questions, input placeholder and whether the Tickets button shows. It never changes the map.
- **Map** is clean by default. It follows `scene.intent` events through `sceneStore`. One small settings button opens a popover with: path status legend, river level (Normal, +1 to +5 m, radiogroup), Travelling as (Resident only: Walking, Stroller, Wheelchair, Older adult (rest stops), Driving), Day/Night.
- **Persistent notes:** route tag with a clear button when a route is shown; flood note ("River +N m · indicative scenario, not a forecast", MBSA / JPS / NADMA links) whenever a flood level is on.
- **Place card:** type, name, each fact with a status chip, `Demo value · not surveyed` chip for placeholder evidence, evidence photo, and for evacuation centres `Candidate · from map data` vs `Official relief centre`.
- **Path card:** flood paths open "Why this path?" (scenario, indicative classification, how it was worked out, never a depth); other paths show status and reason.
- **States:** loading ("Loading the township"), 3D failed to List view with a plain notice, route/flood/place focus.
- **Narrow screens:** columns stack; map fixed height, assistant directly below without scrolling past a full-height map.

## Assistant

Answer card order: checks the assistant ran (as they happen), streamed text, uncertainty note ("Not verified · …"), flood disclaimer, evidence list (claim, status chip, demo chip), tickets-created line. Mapped from SSE: `tool.call`/`tool.result`, `text.delta`, `uncertainty`, `disclaimer`, `citation`, `verification.requested`, `error`, `done`.

States: empty (starters), thinking, streaming (with live region `aria-live="polite"`), done, refusal ("Can't answer that yet", styled as a normal outcome, not an error), error with "Try again". After the first message, starters collapse to a chip row above the input.

Starters: Resident (stroller route to the playground, wheelchair route to the lakeside mall, nearest evacuation centre if the water rises 3 m, where to drop off recycling). Management (which places are cut off at +3 m, which areas are isolated at +5 m, which routes to the mall are cut off at +3 m, tell me about a place).

## Tickets screen

- **List (left):** To check (with count) and Checked, sorted by `demand` descending. Each row: attribute (the missing fact), place or path name, reason, "Asked N×", time ago. Data from `GET /verification-requests`.
- **Detail (right):** fact and place, reason, kind of question (`question_summary`, structured only), times asked, recorded value, then "What did you find on site?" with Confirm (only if a value is recorded), Correct (or "Record what you found" when nothing is recorded), Reject, optional photo, Save. Resolve goes to `POST /verification-requests/{id}/resolve` with photo via the existing evidence upload.
- **After save:** Before/After panel: "Not checked yet" vs "Verified on <date>: <value>", plus the photo and, where relevant, "Ask the question again" which returns to the main screen and sends the originating starter.
- **Staff access:** first save prompts for the token in a small field. Stored in `sessionStorage`, sent as the staff header, never in the bundle. A 401/503 shows "Staff access needed" and keeps the typed values.
- **Privacy:** tickets show structured fields only, never residents' words (PDPA). Rejected tickets show "Rejected on <date>".
- **Narrow screens:** detail opens over the list; back returns to the list.

## Theme and Day/Night

KAMUI tokens become Tailwind 4 `@theme` variables in `index.css` (colours, spacing, radii, fonts). Components use semantic tokens (surface, text, border, accent) so Day/Night is a single `data-theme` attribute on the root. Default follows `prefers-color-scheme`; the choice is stored in `localStorage` (wrapped in try/catch, per-viewer convenience only).

- Panels, assistant, Tickets: Night = mockup palette; Day = cream/peach surfaces, indigo text. Contrast checked in both.
- Map: the theme store (`ui/theme.ts`) is the single source of day/night (Ruling 1 of the plan), and `sceneStore` gains `mapStyle` (not `timeOfDay`). Cesium Night = dark sky and dimmed tiles (Google tiles cannot be relit); Mapbox uses its day/night light presets; List follows the page theme. Project 2 consumes the same theme (`useTheme`) for the stylised city.
- Status is never colour only: every chip and map line has an icon, border/pattern and label in both themes.

## Honesty and wording (enforced, with tests)

Never "safe"/"selamat"/"安全", never a water depth on a path; flood content always "indicative" and "not a forecast" with official links; "Not checked yet" vs "No known barrier" vs "Verified" (staff-checked only); a data gap reads "No mapped connection (data gap)"; demo evidence shows "Demo value · not surveyed"; OSM evacuation centres are "Candidate". A single status map in `ui/` owns these strings.

## Accessibility

Every control has an accessible name; touch targets at least 44 px; fully keyboard operable (radiogroups, popover focus trap and Escape, skip link); streaming text in a polite live region; visible focus ring (lantern colour) in both themes.

## Error handling

Chat failure: error card with "Try again". Tickets load failure: plain message with retry. Missing/invalid staff token: "Staff access needed". No 3D key or WebGL: Mapbox, then the List view, as today.

## Testing and quality evaluation

- Keep existing unit tests for reused logic. Add tests: StatusChip wording and non-colour cues, AnswerCard states and ordering, SettingsPopover, OutcomeForm, StaffAccess, theme toggle, honesty scans (banned words and depths across rendered screens).
- Update Playwright e2e (mock LLM, tiny fixture, ports 5273/8100, `STAFF_TOKEN=e2e-token`, list view) for the two-screen flow including resolve-and-before/after.
- Quality evaluation, run at the end: Lighthouse (accessibility and performance) on both screens in both themes; keyboard and screen-reader pass; phone/tablet/desktop checks; independent evaluator agent scoring against this spec; a small number of real 3D tile loads for the map look in day and night (cost noted in the log).
- CI-equivalent checklist from AGENTS.md before claiming done, each reported PASS / FAIL / BLOCKED / NOT RUN, and marked mock-backed where applicable.

## Hook for Project 2

Exact names: `useTheme` (from `ui/theme.ts`; `theme: "day" | "night"`, the single source of day/night) and `useScene().mapStyle` (`"realistic" | "stylised"`, from `sceneStore`). Both exist in Project 1; `stylised` is unimplemented and falls back to realistic. Project 2 adds the building data pipeline and the stylised renderer behind that setting.

## Risks

- Google tiles cannot be relit, so Night on them is a tint; acknowledged, and Project 2 is the real answer.
- Deleting `/manage` removes staff features the brief omits (KPIs, closures, audit). Backend stays, so they can return later.
- Mockup copy and statuses were checked against the wording rules; where they disagree, the brief wins.
