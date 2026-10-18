# TownshipLens

A 3D township world model of City of Elmina: residents ask about step-free routes and indicative flood scenarios, and staff verify facts. Everything shown is either backed by a source or labelled as illustrative.

## The 3D city

**Digital twin**:
The 3D city as a whole: real Elmina layout, buildings, roads, water and land cover, dressed with illustrative detail so it reads as a living township.
_Avoid_: Game map, SimCity (as a description of what is true)

**Sourced feature**:
Anything drawn because a named data source says it exists at that place, such as a building footprint, road, water body, land-cover area, landmark or sign.
_Avoid_: Real data, ground truth (when meaning the 3D scene)

**Decorative detail**:
Anything drawn only to make the city look alive or finished, such as facade ornament, moving cars, walking people or birds. It is always labelled illustrative and is never evidence of anything.
_Avoid_: Simulation, live traffic

**Building archetype**:
A model of one real Elmina building type, such as a two-storey terrace or a shophouse row, built from reference photos and reused for every footprint of that type. It shows what kind of building stands there, not an exact replica of each one.
_Avoid_: Template, style, variant

**Landmark**:
A named, real Elmina place modelled individually rather than from a generic building shape. It is a Sourced feature.

**Signage**:
A real business or place name shown on or beside a building. It is a Sourced feature; a sign with no source is not drawn.
_Avoid_: Shop sign (when invented), placeholder sign
