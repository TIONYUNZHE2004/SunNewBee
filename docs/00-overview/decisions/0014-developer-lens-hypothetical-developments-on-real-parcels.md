# 0014. Developer lens: hypothetical developments on real parcels

- Status: accepted
- Date: 2026-10-21
- Deciders: owner, with Claude Code

## Context
We want a second demo aimed at Sime Darby Property's planning and township-management teams: "live it before you build it". A staff user describes a development and the 3D map plays it from construction through handover to everyday life, with residents reacting. SDP publishes no site plans or stage-by-stage construction progress for its Elmina projects. Simulating a real project such as Kanopi Residences would therefore mean inventing its geometry, schedule and residents' reactions, and attaching them to a real product.

## Decision
- **Hypothetical Development on a real parcel.** The simulated project is imagined (a ~30-storey, ~500-home tower) and placed on a real OSM construction lot near Elmina Lakeside Mall (way/1564861412, north-east corner, more than 200 m from the Kanopi lot). It is always labelled "Hypothetical development · not an SDP project".
- **Only routes and distances are facts.** Detour minutes, walking distances and times come from the world model. Construction progress, move-in, the crowd and Spotlight Residents' behaviour are labelled "Simulation · illustrative", never a forecast.
- **Resident reactions are simulated, and labelled so.** Spotlight Residents speak in short hand-written lines. Any number or fact in a line comes from the world model; the opinion around it is ours. The end card is titled "What residents raised" and marked "Simulated reactions".
- **Same chat pipeline, recorded.** The brief goes through `/chat` and plays back from a recorded `DEMO_MODE` turn, as the route demo does. The upload button is front-end only: the file is neither read nor stored. Presenters say so if asked.

## Options considered
- **Simulate a real SDP project (Kanopi, Elmina Ridge 2):** strongest pull for SDP, but there is no public site plan, and invented progress or reactions would misrepresent their product.
- **A wholly fictional place:** no data burden, but it loses "this is your township".

## Consequences
- AGENTS.md's honesty table gains a row: simulated resident reactions are never presented as real residents' views.
- The OSM lot is marked as under construction, so it may be a real SDP phase. The "hypothetical" label must stay visible in every frame where the tower appears.
- Synthetic residents now interact visibly, which ADR 0013 kept the decorative crowd from doing. That is allowed only for Spotlight Residents, inside the Development Simulation.
