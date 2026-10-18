# UI redesign: framed map, rail, assistant card (design)

Date: 18 Oct 2026 · Branch: `feat/ui-redesign` · Status: approved in chat (layout from the Google Stitch mockup, with fixes)

## Intent

The current chrome (lavender/plum glass, Marcellus wordmark, one floating header) reads as a generic
AI template. We want a calm, premium product frame that makes the 3D city the hero and the assistant
feel crafted. The judges should see a product, not a demo.

## Goals

- A framed, map-first layout on wide screens (≥ 1024 px): stone frame, slim left rail, the map as one
  large rounded card, the assistant as its own rounded card on the right.
- A neutral palette (warm stone + ink by Day, charcoal by Night). No purple anywhere in the chrome.
- Sime Darby Property red used only on the small logo mark.
- Chrome status chips use the same colours as the map legend (`scene/styles.ts`), so one status means
  one colour everywhere.
- A less cramped map: one floating pill at the top-left (wordmark, site name on one line, Resident /
  Management switch); nothing else permanently floating at the top.
- A richer assistant: a coverage card on the empty state built from real gap data, a "route brief"
  answer layout with big numbers, a restyled checks timeline, and an evidence split bar.
- Tickets restyled to the same frame and cards.

## Non-goals

- The map itself: renderers (three.js, Cesium, Mapbox, List), map line colours, picking, overlays
  drawn inside the scene and the map settings popover content stay as they are.
- New backend data. The per-segment route strip and the flood ladder chart need data the chat stream
  does not send yet; they are a follow-up.
- The phone layout gets the new colours and fonts, not a new structure (bottom sheet stays).

## Anti-goals (would make this a failure even if it looks good)

- Any invented claim from the mockup: "Verified Civic Data", "LiDAR survey", "Live Hydrology",
  "Live sync", model versions, percentages that do not come from data, heights in metres next to places.
- Brand red read as "danger", or a status told apart by colour alone.
- Breaking honesty wording (`ui/status.ts` labels, "Demo value · not surveyed", "indicative scenario,
  not a forecast").

## Decisions

- **Frame (wide):** `bg` is the frame colour with 12 px padding and 12 px gaps.
  Rail 64 px, map card `flex-1` with 24 px radius, assistant card `panelWidthPx(vw)` wide with
  24 px radius. Hiding the assistant collapses its card and the map card grows.
- **Rail:** logo mark (red shield) at the top; Map (home), Assistant (toggle) and Tickets with open
  count (Management mode only, as today); theme menu at the bottom. Every icon has a visible tooltip
  and an accessible name. No rail item for features that do not exist.
- **Map card top-left pill:** "TownshipLens" + site name on one line, then the Resident / Management
  segmented control. The old full-width header goes away on wide screens; on phones a compact header
  stays.
- **Docked panel, so no camera offset:** the assistant no longer covers the map, so the map's
  "panel reserve" is 0 on wide screens. The two renderer lines that shifted the camera look point left
  of the overlay panel read a new `mapPanelOverlapPx()` helper in `main/viewport.ts`, which returns 0.
  This is the only change in renderer files; map visuals are untouched.
- **Palette:**
  - Day: frame `#EFECE6`, surface `#FFFFFF`, raised `#F7F5F1`, text `#1C1B19`, soft `#6B6760`,
    edge `#E3DFD7`, primary = ink.
  - Night: frame `#0F0F10`, surface `#1A1A1C`, raised `#232326`, text `#F2F0EB`, soft `#9C978F`,
    edge `#2C2C30`, primary = light ink.
  - Brand `#EE3033` (unconfirmed against SDP's guide) on the logo mark only.
  - Status tones come from `scene/styles.ts` hues, tuned per skin for text contrast ≥ 4.5:1.
- **Type:** Geist (UI) and Geist Mono (small data labels), from Google Fonts; tabular numbers for
  figures. Marcellus and Jost are removed. Buttons are sentence case.
- **Assistant empty state:** header, "Try asking" grid, then a coverage card: the existing
  `gapSummaryLine()` text for the current profile plus a bar of checked vs not-yet-checked paths
  from `/layers/gaps`. No percentage that the data does not give.
- **Answer card:** status chip row, big distance/minutes figures (tabular), "Show on map" as the
  primary action, checks as a compact timeline, notes as tinted blocks, and an evidence split bar
  (demo vs other sources) above the existing citation list.

## Left to the builder

Exact spacing, icon choices, motion, tooltip style, and how the tickets two-column layout breaks on
medium widths, within the palette and rules above.

## Follow-up (separate work)

Per-segment route strip (needs segment statuses and lengths on the `route.highlight` intent) and a
flood ladder chart in answers (needs the route evaluated at every river stage).
