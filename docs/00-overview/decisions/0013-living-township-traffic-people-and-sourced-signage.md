# 0013. A living township: traffic, people and sourced signage

- Status: accepted
- Date: 2026-10-17
- Deciders: owner, with Claude Code
- Supersedes in part: [0011](0011-time-of-day-theme-and-decorative-motion.md) (its "no moving traffic" and "no invented landmarks or signage" rules)

## Context
The owner wants a viewer to see Elmina's daily life at a glance, the way SimCity shows a working city. ADR 0011 banned moving traffic in case it read as live traffic data, and banned landmarks and signage so that nothing would be invented. Today the only motion is birds about 0.9 m across, seen from a 1,200 m home view, so the city looks still.

## Decision
- **Moving cars and walking people are allowed as Decorative details.**
  - Vehicles drive along mapped roads and people walk along footways and park paths.
  - Densities follow the time of day: busy in the day, a commuter rush at dusk, and fewer at night but never empty.
  - They cluster near schools, the mall and parks.
  - They are never pickable, never described by the assistant, and covered by the "illustrative" label.
- **Variety at true scale.**
  - Each kind (people, vehicles, trees) has several variants plus colour and size jitter, so no two neighbours look the same.
  - People span ages, builds and local dress.
  - Vehicles are unbranded local types, including motorcycles, buses and lorries.
  - Trees are local species.
- **Landmarks are allowed** when they are real, named Elmina places. They are modelled individually and count as Sourced features.
- **Signage is allowed only when sourced.**
  - A sign shows a real business or place name from a source (an OSM name/brand tag, cross-checked where possible). It is attached to the nearest building and its source can be opened.
  - Signs carry text only, never brand logos.
  - A shopfront with no source gets a blank sign.
- **The rest of ADR 0011 stays:**
  - motion is gated by visibility and reduced motion;
  - base water never touches flood layers;
  - nothing decorative changes a fact.
- **Time of day:** auto mode keeps following the Elmina clock (0011). The user can pin Day, Dusk or Night. An accelerated cycle may be added later.

## Options considered
- **Keep the 0011 ban:** honest, but it fails the owner's main goal of a living township.
- **Traffic driven by real data:** not available, and it would turn decoration into a claim that would have to be checked.
- **Invented shop signs for atmosphere:** rejected. A made-up name on a real building reads as a fact.

## Consequences
- The honesty line moves from "nothing moves like data" to "nothing decorative is pickable, cited or described".
- Signs need a data step that resolves POI names to buildings and records the source of each, which goes stale as businesses change.
- Tests must assert that decorative layers are not pickable and that no sign renders without a source.
