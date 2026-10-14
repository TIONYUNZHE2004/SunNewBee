# Glossary

Shared vocabulary for TownshipLens. **Use these words consistently** in code, docs and the pitch. If a word is misused in a PR or slide, link here. Add a term when the team starts using a new word.

## Product terms

| Term | Meaning in TownshipLens | Not to be confused with |
|---|---|---|
| **TownshipLens** | The product: a resident-facing assistant plus the staff tools behind it. | |
| **Site** | The one area the MVP covers: a single community facility and the public space around it. See [site-selection](../02-research/site-selection.md). | "Township" (the whole SDP development) |
| **Township** | A whole SDP development (e.g. City of Elmina). TownshipLens scales *township by township*. | |
| **Facility** | A place people go to: a community hall, park, mall, sports centre, surau, etc. | |
| **Place** | Any named thing a resident can ask about: a facility, a toilet, a bench, a shelter, a car park, a drop-off point. A **node** in the world model. | |
| **Entrance** | A specific way into a facility. It has its own attributes (step-free?, door width, automatic door?, opening hours). Residents usually ask about *entrances*, not buildings. | "Place". A building has several entrances. |
| **Path segment** (edge) | One walkable stretch between two nodes. It carries attributes such as steps, slope, width, surface, shelter and lighting. | "Route" |
| **Route** | An ordered list of path segments from A to B that the routing engine computes for a **profile**. | |
| **Profile** | A set of mobility constraints and preferences, e.g. `stroller`, `wheelchair`, `older_adult_rest`, `default`. It decides which segments are allowed and how each is weighted. | "Persona" |
| **Persona / resident agent** | A *test* actor that combines a profile with a task ("get from car park B to the hall's main entrance at 7pm"). Used to find gaps. **Never presented as a real resident.** | Real user research participants |
| **Journey** | One run of a persona's task through the world model. Its outcome is `success`, `success_with_unknowns`, `blocked` or `no_data`. | |

## Data and trust terms

| Term | Meaning |
|---|---|
| **World model** | Our **structured, verified representation** of the site: a graph of places, entrances and path segments, plus attributes, provenance and closures. It is **not** a generative AI "world model" like Genie or Marble, and we say so explicitly in the pitch. |
| **Spatial graph** | The node/edge part of the world model, loaded into the routing engine (NetworkX). |
| **Attribute** | One fact about a node or edge, e.g. `has_steps=false` or `width_cm=120`. Each attribute has its own provenance. |
| **Tri-state value** | Accessibility attributes are `yes`, `no` or `unknown`, never a silent default. `unknown` is a first-class answer. |
| **Provenance** | Where a fact came from (`source_type`: site_visit, photo, SDP_document, OSM, staff_report, resident_report), who recorded it, and when. |
| **Verified** | A fact confirmed by an authorised person on a given date, with evidence attached. |
| **Verification date / freshness** | When a fact was last verified. Old facts get flagged (e.g. older than 90 days for things that change, such as closures). |
| **Evidence** | A photo, document or note that supports a fact. Answers cite evidence IDs. |
| **Closure** | A time-bounded state that overrides normal attributes (walkway closed for works, hall closed for an event). |
| **Knowledge gap** | A question or journey the world model can't answer confidently because a fact is missing, unverified, stale or conflicting. |
| **Verification request (VR)** | A ticket created automatically when a knowledge gap is hit. Staff resolve it by verifying, correcting or rejecting the fact. **This loop is our main differentiator.** |
| **Staff console** | The ops-facing dashboard for VRs, edits, recurring questions and gap heat-maps. |

## AI terms

| Term | Meaning |
|---|---|
| **Grounded answer** | An answer whose every factual claim comes from a tool result and cites it. |
| **Tool / function calling** | The LLM chooses from a fixed set of approved functions (e.g. `plan_route`) instead of answering from memory. |
| **Unsupported claim** | Any factual statement in an answer that no tool result backs up. This is our #1 eval metric to drive to zero. |
| **Abstain** | The assistant explicitly says it doesn't know, explains why, and (where relevant) files a VR. |
| **Map action** | A structured instruction the assistant sends to the frontend alongside its text, e.g. `highlight_route`, `focus_place`, `show_evidence`. |
| **Golden set** | Our fixed list of test questions with expected tool calls and answers, used for evals. |
| **MCP** | Model Context Protocol, an open standard for exposing tools to LLM clients. See [stack-decision](../04-architecture/stack-decision.md). |

## 3D and geo terms

| Term | Meaning |
|---|---|
| **3D Tiles** | An OGC standard for streaming large 3D datasets. Google's Photorealistic 3D Tiles use it. |
| **Photogrammetry** | Building 3D models from many overlapping photos. |
| **Gaussian splatting (3DGS)** | A 2023+ technique that represents a scene as millions of small 3D Gaussians. It looks photoreal and renders fast. |
| **WGS84** | Standard lat/lon coordinates (GPS). Our graph stores nodes in WGS84. |
| **ENU** | A local East-North-Up metric frame centred on the site. Used to place graph nodes in a 3D scene. |
| **ECEF** | Earth-Centred Earth-Fixed coordinates, used by 3D Tiles and Cesium. |
| **GeoJSON** | A JSON format for geographic features. It's our interchange format between backend and frontend. |
| **OSM** | OpenStreetMap, a free, editable world map. A source of footpaths and buildings. |
| **OpenSidewalks** | An open schema for pedestrian paths with accessibility attributes. Our schema aligns with it. |

## Hackathon terms

| Term | Meaning |
|---|---|
| **SDP** | Sime Darby Property Berhad, the organiser and target customer. |
| **People / Planet** | The two challenge tracks. We are in **People**. |
| **Mechanism / Enabler** | The two required parts of the pitch: *how it works and why it creates value* / *how technology makes it work at scale*. |
| **OKU** | *Orang Kurang Upaya*, Malaysia's official term for persons with disabilities. |
| **JMB / MC** | Joint Management Body / Management Corporation, the strata bodies that run shared facilities. |
