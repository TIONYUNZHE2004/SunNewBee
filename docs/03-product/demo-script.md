# Demo Script

> The demo is the most persuasive 3 minutes we have. It is built from journeys J1, J3 and J5 ([personas-and-journeys](personas-and-journeys.md)). Rehearse it until it's boring. **Always have the recorded backup video ready** and run with `DEMO_MODE=1` (cached LLM responses) if the venue Wi-Fi is weak.

## Setup checklist (T–30 min)

- [ ] Laptop + phone charged; phone mirrored or the laptop in a mobile viewport
- [ ] Deployed URL warm (hit `/healthz`; Cloud Run `min-instances=1` set the day before)
- [ ] Seed data reset to the **"before"** state: `POST /admin/demo/reset` (ramp R2 slope = unknown, VR-17 open with demand 4)
- [ ] Staff console logged in, in a second tab
- [ ] Backup video open in a third tab
- [ ] Browser zoom 125%, notifications off, dark mode off

## Script (3:00)

| Time | On screen | Say (presenter) |
|---|---|---|
| 0:00 | Title slide → app opening on the 3D site | "Meet Aisyah. After shopping at Elmina Lakeside Mall she wants to take her kids to the Urban Park playground. She has a stroller, and she's never walked this way." |
| 0:15 | Types: *"Can I push a stroller from Car Park B to the playground without stairs?"* | "She asks the way she'd ask a person." |
| 0:20 | "Finding places… Checking step-free routes…" chips | "TownshipLens doesn't guess. It looks up the real places and runs a route check for a stroller over our verified map of the site." |
| 0:30 | Route highlighted: green, with one amber dashed segment; answer appears | "It found a route, and it's honest about it. Most of it is staff-verified, but the slope of the ramp down to the waterside path has never been checked. It tells her that first, and offers the fully verified route via the main mall frontage, 120 metres longer." |
| 0:50 | Tap the evidence card → photo + "verified 18 Oct, site visit" | "Every fact has a source and a date. No 'accessible' badge without proof." |
| 1:00 | Switch to the staff console tab: VR queue, VR-17 at the top with demand 4 | "Behind the scenes, that unknown became a task for the township team. Four residents hit the same gap this week, so it's top of the list." |
| 1:15 | Staff resolves: upload photo, slope 1:14, `verified` | "Encik Rahman checks the ramp on his round, takes a photo, and records it. Two minutes." |
| 1:30 | Back to the resident tab, ask again → route is now all green, shorter, "Confirmed" | "Aisyah's next question gets a confirmed route. The township just got a little easier to use, and it stays that way." |
| 1:45 | Simulation report: before/after matrix, top gaps | "We don't wait for residents to hit gaps. Test personas for strollers, wheelchairs and older residents walk every journey overnight. Before one verification round, <X>% of journeys were confirmed. After it, <Y>%." *(only real numbers from [evaluation-plan § 5](evaluation-plan.md))* |
| 2:10 | Uncle Lim example in 中文 or BM: rest points along the route | "Same system, any language, any need. Here an older resident asks in Mandarin where he can sit along the way." |
| 2:30 | Architecture one-liner slide | "Under the hood: a verified spatial model is the source of truth. Routing is done by a deterministic engine, not by the AI. The AI only translates questions in and answers out, and cites everything." |
| 2:45 | Close | "TownshipLens: find the right entrance, with evidence instead of guesswork, and a township that learns what it doesn't know." |

## What can go wrong → recovery

| Failure | Recovery line + action |
|---|---|
| LLM slow or down | "Let me show you the recorded run" → switch to the video at the same timestamp |
| 3D tiles don't load | Click "2D map". *"Works on any phone. 3D is a layer, not a dependency."* |
| Wrong answer live | Don't argue with it. *"This is exactly why every answer shows its evidence. Let's look at what it used."* Then the video |
| Staff login expired | Pre-recorded GIF of the resolve step |

## Variants
- **60-second version** (proposal video): 0:00–0:50 + 1:30–1:45 + close.
- **5-minute version** (final): add J4 (closure) and J3 ("How do you know?" from Priya).
