# 0006. MVP site: Elmina Urban Park + Elmina Lakeside Mall frontage

- Status: **proposed** (confirm at the kick-off sync, and with SDP mentors for permission)
- Date: 2026-10-14
- Deciders: whole team

## Context
The MVP covers one facility and its surroundings ([mvp-spec](../../03-product/mvp-spec.md)). We need somewhere public, accessibility-relevant, data-feasible and visible to SDP. Full analysis: [site-selection](../../02-research/site-selection.md).

## Decision
**Elmina Urban Park (Central Park "Urban" precinct), City of Elmina, Shah Alam**, with the **SDP-owned Elmina Lakeside Mall frontage** (outdoor entrances, car parks, drop-off) as the arrival side.
- Bbox (S, W, N, E): **3.1775, 101.5055, 3.1835, 101.5135**. Centre about 3.1805 N, 101.5095 E.
- In scope: 3–4 car-park/drop-off nodes, mall outdoor frontage and entrances, park footways, playground, bridge/lookout, seating, shelters, public toilets, Sales Gallery as a landmark.
- Out of scope: mall interior, residential streets, Central Park forest/sports precincts.

## Options considered
| Option | Score | Why not first |
|---|---|---|
| **Elmina Urban Park + Lakeside Mall frontage** | 4.4 | (chosen) Flagship township; SDP-owned mall; daily footfall; real mix of entrances, level changes and paths |
| Elmina Rainforest Knowledge Centre + forest precinct | 3.6 | Strong biodiversity story, but less daily use; trails are harder to verify |
| Bandar Bukit Raja Wetland Townpark + Dewan MBDK | 3.2 | Council-run hall; lower SDP flagship visibility; farther for most students |

## Consequences
- The hero journey becomes **"stroller from the Lakeside Mall car park to the Urban Park playground without stairs"**.
- OSM check (14 Oct): 54 footways and 58 buildings, 28 footways tagged `wheelchair=yes` with **no** width, incline or source; 0 entrances, 0 kerbs, 0 toilets, 1 bench. The import lands as `reported`; verification is our job, and it makes a great story.
- Needs: mall management consent for photographing the frontage, and confirmation of who operates the park (SDP vs MBSA). Ask mentors before 23 Oct.
- If Google 3D Tiles quality over Elmina is poor, use fallback A ([3d-pipeline § 4](../../04-architecture/3d-pipeline.md)).
