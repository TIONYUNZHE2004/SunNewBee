# Accessibility / routing / agent-simulation sources (machine-readable)

Verified 2026-10-14 by fetching the page unless marked (unverified). Priority: 1 = clone/read now, 2 = useful, 3 = optional.

## Repos
- https://github.com/OpenSidewalks/OpenSidewalks-Schema | Schema v0.3 (2026-01-27), JSON Schema + PostgreSQL; base for our graph schema | 1 | small
- https://github.com/ProjectSidewalk/SidewalkWebpage | Crowdsourced sidewalk audit + AI validation; validation workflow reference | 3 | large (Scala/Play)
- https://github.com/AccessMap | AccessMap org: accessmap, sidewalkify, crossify (29 repos) | 3 | mixed
- https://github.com/nbolten/unweaver | Config-based routing engine with per-user profiles and dynamic edge costs; design reference (~9 stars; AccessMap link unverified) | 2 | small (114 commits)
- https://github.com/gis-ops/routingpy | Unified Python client for Valhalla/GraphHopper/ORS/OSRM/OTP; Apache-2.0 | 3 | small (351 stars)
- https://github.com/GraphHopper/graphhopper | Custom-model routing, foot/hike; Apache-2.0; township-scale option | 3 | large (6.7k stars)
- https://github.com/valhalla/valhalla | Pedestrian costing (wheelchair/blind types, step_penalty, use_lit); township-scale option (not fetched; unverified) | 3 | large
- https://github.com/opentripplanner/OpenTripPlanner | wheelchairAccessibility maxSlope/unknownCost precedent for unknown handling (not fetched; docs verified) | 3 | large
- https://github.com/networkx/networkx | Graph library for MVP router (Dijkstra/A*, callable weights) (not fetched; unverified) | 1 | large lib
- https://github.com/pgRouting/pgrouting | SQL routing over PostGIS; scale-up path (not fetched; unverified) | 3 | medium
- https://github.com/microsoft/soundscape | Open-sourced 3D-audio nav for blind users; inspiration for non-visual modes | 3 | medium
- https://github.com/joonspk-research/generative_agents | Generative Agents reference code (not fetched; unverified) | 3 | medium
- https://github.com/HypothesisWorks/hypothesis | Property-based testing lib for the checker/test-generator harness (not fetched; unverified) | 2 | large lib

## Papers
- Towards Global-Scale Crowd+AI Techniques to Map and Assess Sidewalks for People with Disabilities | 2022 | arXiv 2206.13677 | Project Sidewalk scale and crowd+AI validation | 1
- Generative Agents: Interactive Simulacra of Human Behavior | 2023 | arXiv 2304.03442 | Foundational LLM agent architecture | 2
- LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals (1,000 people) | 2024 (rev. 2026) | arXiv 2411.10109 | Fidelity needs real interview data; 83-86% vs 74% demographics-only | 1
- UXAgent: A System for Simulating Usability Testing of Web Design with LLM Agents | 2025 | arXiv 2504.09407 | Simulated usability pre-tests; framing as study debugging | 2
- AXNav: Replaying Accessibility Tests from Natural Language | 2023 | arXiv 2310.02424 | NL accessibility test cases executed by agent | 2
- GATSim: Urban Mobility Simulation with Generative Agents | 2025 | arXiv 2506.23306 | LLM agents for urban mobility | 3
- Large Language Model Powered Intelligent Urban Agents: Concepts, Capabilities, and Applications | 2025 | arXiv 2507.00914 | Survey of urban LLM agents (abstract via search; unverified) | 3
- When Plausible Is Not Realistic: Evaluating Human Mobility in LLM-Based Urban Simulation | 2026 | arXiv 2606.13835 | Plausible != realistic critique (title via search; not fetched; unverified) | 2
- Agentic Property-Based Testing: Finding Bugs Across the Python Ecosystem | 2025 | arXiv 2510.09907 | LLM proposes properties, harness verifies; 56% valid reports | 1
- Shiny Stories, Hidden Struggles: Investigating the Representation of Disability Through the Lens of LLMs | 2026 | arXiv 2605.20191 | LLMs idealise disability; critique of disability personas | 1
- Understanding Down Syndrome Stereotypes in LLM-Based Personas | 2025 | arXiv 2512.02275 | Stereotype risk in disability personas | 2
- Mining Impersonification Bias in LLMs via Survey Filling | 2025 | https://www.mdpi.com/2078-2489/16/11/931 (open access) | Persona homogenisation and attribute-triggered stereotypes | 2
- Behavioural thermal regulation explains pedestrian path choices in hot urban environments | 2022 | https://pure.uva.nl/ws/files/68289680/s41598_022_06383_5.pdf | Shade discount 0.86 for tropical-city routing cost | 1
- Active route choice to minimize pedestrian thermal discomfort in a high-density subtropical city | n/d (via search) | https://research.polyu.edu.hk/en/publications/active-route-choice-to-minimize-pedestrian-thermal-discomfort-in-/ | Shade-only routing unreliable | 3
- Bench spacing / rest-point review (Sustainability 17(8251)) | 2025 | https://www.mdpi.com/2071-1050/17/18/8251 | 50-150 m rest-interval framework for limited mobility | 1
