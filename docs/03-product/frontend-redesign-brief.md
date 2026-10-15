# TownshipLens: frontend redesign brief

A brief for designing the new TownshipLens frontend. Part 1 explains the project. Part 2 describes the layout and what each screen must contain. Visual style (colours, typography, component styling) is deliberately left open.

---

## Part 1: Project context

### What TownshipLens is

TownshipLens is a 3D map of a real township, **City of Elmina** in Shah Alam, Malaysia, with an AI assistant that answers questions about it. It is a student hackathon entry (Sime Darby Property University Hackathon 2026, "Township of Tomorrow", People track).

Two kinds of people use it:

- **Residents** ask everyday questions about getting around, for example "Can I push a stroller from Car Park B to the playground without stairs?" or "If the river rises 3 m, where is the nearest evacuation centre?"
- **Township management** (staff) ask about the township as a whole, for example "Which places are cut off if the river rises 3 m?", and fix the information gaps the assistant finds.

### The core promise: honest answers

The product's main idea is that **answers come only from checked data, and every gap is shown as a gap.** This shapes the whole interface:

- Every fact has a status: checked (verified), reported, not checked yet, or unknown. The interface must always show which.
- When the assistant can't confirm something, it says so plainly and turns the gap into a **ticket** for the township team.
- Flood scenarios are **indicative, not forecasts**. The interface never says a place is "safe" and never shows a water depth on a path. Any flood view carries a short note pointing to official guidance (MBSA, JPS, NADMA).
- Some current facts are demo values from a planned field survey. They must be labelled as "demo values, not yet surveyed", never as verified.

### What the system can do today

The backend is built and working. The frontend redesign does not change what the system can do, only how it's presented.

| Area | What it does |
|---|---|
| **Access** | Plans walking routes for a chosen way of travelling: walking, stroller, wheelchair, older adult needing rest stops, or driving. Each route is labelled confirmed, partly unverified, blocked, or "no mapped connection (data gap)". |
| **Flood what-if** | Shows indicative river-rise scenarios from +1 m to +5 m: which paths and places would likely or possibly be flooded, which areas get cut off, and which evacuation centres stay reachable. |
| **Waste** | Finds recycling and waste drop-off points. |
| **Assistant** | Answers in plain language, cites its evidence, flags what's unverified, and can move the map itself: fly to a place, highlight a route, switch on a flood level, show a layer. |
| **Tickets** | Gaps found while answering become tickets: "step count unknown on this footway", "this place is missing from the map". Staff check them on site and confirm, correct or reject them, optionally with a photo. The next answer then uses the checked fact. |

### What we're building in this redesign

A **simpler frontend with two screens**:

1. **The main screen:** a 3D map with the assistant beside it, used by both residents and management.
2. **The Tickets screen:** where staff work through the gaps the assistant found.

The goal is that a judge understands the product in about 90 seconds: a resident question with a route on the map, a flood what-if, a management question, and a gap being fixed and the answer changing.

**Out of scope for this redesign:** road and infrastructure planning (a future goal), resident accounts, and real-time flood data.

---

## Part 2: Design context

### Screen 1: Main screen (map + assistant)

**Layout**

- A **two-column layout**: the 3D map takes the larger left part (about two-thirds of the width), and the assistant takes the right part (about one-third).
- A **mode switch** sits above both columns with two options, **Resident** and **Management**. It is a perspective switch, not a login: anyone can switch.
- The **map is clean**. There are no visible controls on it by default. The map follows the conversation: when the assistant answers, it moves the camera, draws the route, or switches on the flood level by itself.
- Map settings are **hidden** behind one small, unobtrusive way to open them. When opened, they offer:
  - the **path status legend** (what each line style means);
  - the **river level**: Normal, +1 m, +2 m, +3 m, +4 m, +5 m;
  - **Travelling as** (resident mode only): Walking, Stroller, Wheelchair, Older adult (rest stops), Driving.
- On narrow screens the columns stack. The assistant must stay easy to reach without scrolling past the whole map.

**The map area must show**

- The township in 3D, with paths, places and, when a flood level is on, the flooded areas.
- Path statuses that are **never shown by colour alone**: each status also needs a pattern or a text label. The statuses are:
  - No known barrier
  - Not checked yet
  - Not passable
  - Likely flooded (indicative)
  - Possibly flooded (indicative)
  - Suggested route
- When a flood level is on, a short **indicative-scenario note**: "indicative scenario, not a forecast", with links to official guidance.
- Clicking a **place** opens its details: what it is, each fact with its status, any evidence photo, and for evacuation centres whether it's an official relief centre or only a candidate from map data.
- Clicking a **flood-coloured path** opens "Why this path?": the scenario, the classification (always indicative), and how it was worked out.
- A loading state, and a plain **list fallback** when 3D can't load (no key, no WebGL, or an error). The product must still work as text.

**The assistant column must show**

- A heading and a short line explaining what the assistant does in the current mode.
  - Resident: ask in your own words; answers only come from checked data and say what isn't verified.
  - Management: ask about an area or a scenario; gaps become tickets for your team.
- **Starter questions** that change with the mode. One tap sends the question. Resident examples:
  - Stroller route from Car Park B to the playground
  - Wheelchair route to the lakeside mall
  - Nearest evacuation centre if the water rises 3 m
  - Where to drop off recycling

  Management examples:
  - Which places are cut off at +3 m
  - Which areas are isolated at +5 m
  - Which routes to the mall are cut off at +3 m
  - Tell me about a place
- A **free-text box** with a placeholder that fits the mode. Resident: "Describe where you want to go". Management: "Describe your plan or ask about an area".
- **Answers**, which can include, in this order of importance:
  - the answer text, which streams in word by word;
  - the **checks the assistant ran** while thinking (e.g. "find place", "plan route"), shown as they happen;
  - an **uncertainty note** when part of the answer isn't verified;
  - a **disclaimer** for flood answers;
  - **citations**: the evidence each claim is based on, with its status and whether it's a demo value;
  - a line when **tickets were created** ("A check has been requested from the township team").
- States to design: empty (no messages yet), sending or thinking, an answer streaming in, a finished answer, "I can't answer that yet" (an honest refusal, a normal outcome and not an error), and a real error with a "Try again" action.

**Management mode adds**

- A visible **entry point to Tickets**, showing how many tickets are open.
- Nothing else changes in the layout. Management uses the same map and assistant, with different starter questions and wording.

### Screen 2: Tickets

**Purpose:** staff see the facts the assistant couldn't confirm, check them on site, and record the result. This screen shows judges that the product closes its own gaps.

**Layout**

- A **list on the left** and the **selected ticket's detail on the right**. On narrow screens, the detail opens over the list or below it.
- A way back to the main screen.
- The list has two groups: **To check** and **Checked**.

**Each ticket in the list shows**

- what is missing (the fact, e.g. "Step count", "Incline", "Wheelchair access");
- where it is (the place or path name);
- why it's a ticket. Reasons:
  - unknown
  - out of date
  - contradicted
  - a route blocked by an unchecked segment
  - a place missing from the map
  - a resident report
- **how many times residents have asked** about it (the list is sorted by this, most asked first);
- how long ago it came in.

**The ticket detail shows**

- The fact and the place, the reason, which kind of question it came from (structured, e.g. "stroller route from X to Y"), how often it was asked, and the current recorded value, if any.
- **One action, "What did you find on site?"**, with these outcomes:
  - **Confirm**: it's right as recorded.
  - **Correct**: it's different, enter the value. When nothing is recorded yet, this becomes "Record what you found".
  - **Reject**: the ticket isn't valid.
  - An optional **photo** as evidence.
- After saving, a **before and after**: what residents saw before ("Not checked yet") and what they see now ("Verified on <date>: <value>"). This is the key demo moment.

**Privacy rule for this screen:** tickets never show residents' own words, only structured fields (fact, place, reason, kind of question). This is a privacy requirement (Malaysia's PDPA).

### Wording rules (apply everywhere)

- Never "safe" (nor its Malay or Chinese equivalents, "selamat" and "安全"). Never a water depth on a path.
- Flood content always says "indicative" and "not a forecast".
- Use "Not checked yet" for unverified paths, and "No known barrier" for map-derived paths. "Verified" is only for facts staff have checked.
- A data gap is "No mapped connection (data gap)", never "not reachable".
- Demo values are labelled "Demo value · not surveyed".
- Evacuation centres from map data are "Candidate", never "Official", unless confirmed.

### Accessibility requirements

- Status is never shown by colour alone.
- Every control has a readable name for screen readers.
- Touch targets are comfortable on a phone.
- All features are usable by keyboard.
- Streaming answers are announced politely to screen readers.
