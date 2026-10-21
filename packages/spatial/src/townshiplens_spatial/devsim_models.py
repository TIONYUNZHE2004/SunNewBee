"""Development Simulation (developer lens) plan models (spec 2026-10-21 §5.1, ADR 0014).

Models only: `devsim.build_development_plan` fills them, `POST /developments/simulate` returns a
`DevelopmentPlan` and the web player animates it. Coordinates are WGS84 [lon, lat]. Every number in
`facts` comes from the routing engine; bubble and end-card text may only quote those numbers.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .models import LonLat

CastHome = Literal["tower", "existing"]
BubbleTone = Literal["pos", "neg"]
EndCardBadge = Literal["ROUTE ENGINE", "SIMULATED"]


class DevsimUnavailable(Exception):
    """The world lacks the parcel, or the facts can't be computed (e.g. the tiny fixture).

    The API maps it to 404 {"detail": "development simulation not available for this world"}.
    """


class DevelopmentBrief(BaseModel):
    """The developer's brief. The fixed demo brief is the Management starter text."""

    text: str | None = None
    storeys: int = 30
    homes: int = 500


class DevelopmentEntrance(BaseModel):
    door: LonLat  # ground-floor door on the podium face
    facing_deg: float  # compass bearing the door faces (0 = north, clockwise)
    path: list[LonLat]  # door -> snapped walk node


class DevelopmentSite(BaseModel):
    parcel_id: str  # OSM id of the lot, e.g. "way/1564861412"
    footprint: list[LonLat]  # tower footprint ring (not closed)
    storeys: int
    homes: int
    entrance: DevelopmentEntrance
    kanopi_clearance_m: float  # distance to the real Kanopi Residences lot; must be >= 200


class DevsimDetour(BaseModel):
    """A resident's walk to the mall before and after the hoarding closes the frontage edge."""

    home_id: str  # building id of the existing home
    edge_id: str  # the hoarded (closed) walk edge
    before_m: int
    after_m: int
    detour_min: int  # rounded; >= 2
    before_path: list[LonLat]
    after_path: list[LonLat]
    # True when the detour moves to the sidewalk across the road (bubble 1's claim).
    detour_side_switch: bool


class DevsimWalk(BaseModel):
    m: int
    min: int
    path: list[LonLat]


class DevsimFacts(BaseModel):
    detour: DevsimDetour | None = None  # None when no >= 2-min detour exists (spec §13)
    park: DevsimWalk  # tower entrance -> Elmina Urban Park
    mall: DevsimWalk  # tower entrance -> Lakeside Mall
    profile: str  # routing profile, "default"
    provenance: str  # "routing engine, default profile"


class SpotlightCast(BaseModel):
    id: str  # "halim", "farid", "meiling", "zainab", "arjun"
    name: str
    role: str
    persona: str
    home: CastHome
    colour: str  # "#rrggbb"


class Bubble(BaseModel):
    n: int  # 1-based, spec §4.3 order
    who: str  # SpotlightCast.id
    t0: float
    t1: float
    tone: BubbleTone
    text: str
    tag: str | None = None  # "ROUTE ENGINE · ..." line under the bubble


class Act(BaseModel):
    name: str  # Brief | Construction | Handover | Daily Life | Summary
    t0: float
    t1: float


class EndCardItem(BaseModel):
    text: str
    badges: list[EndCardBadge]


class EndCard(BaseModel):
    title: str
    subtitle: str
    items: list[EndCardItem]
    legend: str


class DevsimAnchors(BaseModel):
    halim_path: list[LonLat]  # the stretch of the detour Halim walks
    farid: LonLat
    junction: LonLat  # school-run queue
    park: LonLat
    mall: LonLat


class DevsimLabels(BaseModel):
    simulation: str = "Simulation · illustrative"
    decorative: str = "Decorative details are illustrative."
    hypothetical: str = "Hypothetical development · not an SDP project · 30 storeys · ~500 homes"
    end_card_subtitle: str = "Simulated reactions · Hypothetical development · not an SDP project"


class DevelopmentPlan(BaseModel):
    """Everything the Development Simulation player needs (spec §4–§5)."""

    provisional: bool = False  # True only for the prototype-derived web fixture
    world: str  # site id, "elmina"
    site: DevelopmentSite
    facts: DevsimFacts
    cast: list[SpotlightCast]
    households: int  # tower household count
    acts: list[Act]
    bubbles: list[Bubble]
    anchors: DevsimAnchors
    end_card: EndCard
    labels: DevsimLabels
    total_s: float = 66
