# 0002. Use existing 3D data instead of our own capture for the MVP

- Status: accepted
- Date: 2026-10-14
- Deciders: whole team

## Context
The original idea assumed our own photogrammetry or LiDAR capture. That needs permission from the site owner, capture time, processing compute and clean-up. It also risks capturing identifiable people. We have about 4 weeks of build time and no guaranteed site access before the 23 Oct proposal.

## Decision
Build the 3D scene from **existing 3D data** (the exact source is chosen in [3d-data-and-rendering](../../02-research/3d-data-and-rendering.md)). Overlay **our own lightweight geometry** (path segments, entrance markers, amenity pins) from the world model. Accessibility facts come from **field verification and documents**, never from the 3D mesh.

## Options considered
- **Own capture (phone photogrammetry, LiDAR, splats)**: the most "wow" and the most accurate locally, but it needs permission, time and privacy handling.
- **Existing data** (chosen): fast, legal if used within the licence, and it scales to every township on day one.
- **No 3D (2D map only)**: the simplest option, but we lose the recognisability that makes entrances and routes intuitive.

## Consequences
- We must follow the data licence (caching limits, attribution and overlay rules). The licensing risks are tracked in the 3D research doc.
- Visual fidelity at entrance level may be low, so evidence photos carry the "what does it look like" job.
- Pitch framing: "the 3D layer is replaceable. Own capture or SDP BIM can plug in later. The verified world model is the product."
