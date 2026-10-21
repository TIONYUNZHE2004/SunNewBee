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

## Developer lens

**Hypothetical Development**:
An imagined project placed on a real Elmina parcel to show how it could be built and lived in. It is not a Sime Darby Property project and is always labelled hypothetical.
_Avoid_: SDP project, launch, Phase (SDP's word for a real release such as Elmina Ridge 2 Ph1)

**Development Brief**:
The short description of a Hypothetical Development that a staff user types or uploads, such as building type, height, number of homes and parcel.
_Avoid_: Proposal, plan (when meaning a real SDP plan)

**Development Simulation**:
The illustrative playback of one Hypothetical Development from building work to everyday life, told in three Acts. Only routes and detour times come from the world model; everything else is labelled "Simulation · illustrative", never a forecast.
_Avoid_: Forecast, prediction, digital twin (for the simulated parts)

**Act**:
One of the three stages of a Development Simulation: Construction, Handover and Daily Life.
_Avoid_: Phase, stage

## Residents

**Synthetic resident**:
An invented person in the simulated population of Elmina, built from public population statistics. Synthetic residents stand in for real people in aggregate; none of them is a real resident.
_Avoid_: Resident (unqualified, when meaning a simulated one), user, persona

**Spotlight Resident**:
A Synthetic resident with a name, a role and a voice whose day is followed and shown up close. Every time and number in what they say is checked against their own simulated day.
_Avoid_: Character, NPC, hero

**Crowd**:
The anonymous people walking around the city for atmosphere. They are a Decorative detail: they mean nothing and are never counted.
_Avoid_: Residents, population
