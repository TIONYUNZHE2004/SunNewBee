# Developer lens prototype (Development Simulation)

> Status: throwaway visual prototype, 21 Oct 2026. Standalone page, not part of `apps/web`.
> Decision record: [ADR 0014](../../../00-overview/decisions/0014-developer-lens-hypothetical-developments-on-real-parcels.md). Terms: [GLOSSARY.md](../../../../GLOSSARY.md) ("Developer lens").

This page shows the target look and flow of the 66 s Development Simulation in the Management tab, before a spec is written. A staff user attaches a brief, and the map plays three Acts:

| Act | Time | What plays |
|---|---|---|
| Brief | 0–4 s | brief attached and sent; the real lot is labelled |
| Construction | 4–32 s | fast-forward with a day/night cycle every 2.8 s (10 cycles, months 1–24). By day: workers, crane and mixer move and floors rise. At night: floodlights on, workers gone, crane still, beacon blinking. The hoarding closes the frontage footpath; Pak Cik Halim takes the detour; Farid complains about noise |
| Handover | 32–44 s | ~1.85 slower cycles, ending at dawn. Hoarding drops, lorries park where the entrance path meets the street, movers queue on the path and go in through the door one by one, windows light up, Halim greets Mei Ling in front of the door |
| Daily Life | 44–63 s | one day, morning to night: residents leave through the door, school-run queue and a complaint that flies to "Resident feedback", the park at midday, the mall at dusk |
| Summary | 63–66 s | "What residents raised" card |

The tower has a ground-floor entrance (glass doors, canopy, a paved path) facing the walk node it snaps to. Street lights, lit windows and site floodlights keep dusk and night readable.

## Run it

```bash
uv run python docs/03-product/prototypes/developer-lens/build_scene.py   # writes scene.js (only after seed changes)
cd docs/03-product/prototypes/developer-lens && python -m http.server 5191 --bind 127.0.0.1
# open http://127.0.0.1:5191/index.html  (hard-reload after rebuilding scene.js)
```

Three.js 0.186.1 loads from jsDelivr, so the page needs network access. Controls: play/pause, restart and the timeline scrubber. Test and recording hook: `window.__devsim.seek(seconds)`, `.play()`, `.pause()`, `.total` (66), `.acts`, `.facts`.

## What is real and what is not

- **Real (OpenStreetMap seed):** the lot (`way/1564861412`, OSM `landuse=construction`), roads, footpaths, neighbouring buildings, the mall and Urban Park.
- **Computed by the routing engine (`build_scene.py`, `default` profile):**
  - the detour when hoarding closes the frontage sidewalk `seg-910300105-0` (`twm.ClosePath`), for the home `w909835115` walking to Lakeside Mall Car Park B: 2,516 m → 2,754 m, about +3 min. The detour uses the sidewalk across both Persiaran Alstonia carriageways (`seg-1343835668-0`), which the old route did not, so Pak Cik Halim says "must walk the other side now" (both routes cross the road somewhere, so "must cross the road" would not be news). The number sits in a ROUTE ENGINE tag under his bubble;
  - the tower to Elmina Urban Park (659 m, about 9 min) and to Lakeside Mall (712 m, about 10 min), from the walk node nearest the lobby (43 m away; the lobby link is not mapped).
- **Hypothetical / simulated:** the tower itself (30 storeys, ~500 homes, placed on the lot's north-east corner, 241 m from the Kanopi lot) and its entrance path (35 m from the door to the snapped walk node; not in the walk network), the construction kit, workers, movers, cars, the crowd, the named residents and every line they say, the clock, the month counter, the day/night cycles, street lights and floodlights, and the occupancy counter.
