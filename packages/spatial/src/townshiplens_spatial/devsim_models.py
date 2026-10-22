"""Development Simulation (developer lens) plan models (spec 2026-10-21 §5.1, ADR 0014).

Models only: `devsim.build_development_plan` fills them, `POST /developments/simulate` returns a
`DevelopmentPlan` and the web player animates it. Coordinates are WGS84 [lon, lat]. Every number in
`facts` comes from the routing engine; bubble and end-card text may only quote those numbers.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .models import LonLat, RouteStatus

CastHome = Literal["tower", "existing", "site"]
BubbleTone = Literal["pos", "neg"]
BriefBadge = Literal["ROUTE", "FLOOD", "ESTIMATE", "CALENDAR"]
TagKind = Literal["detour", "lorry"]
BannerKind = Literal["raya", "monsoon", "handover"]


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
    # The place the walk ends at, and how copy names it ("Lakeside Mall (Car Park B)" when the
    # mall walk arrives at the car park, ruling R18). None for the park walk.
    arrival_id: str | None = None
    label: str | None = None


class DevsimFacts(BaseModel):
    detour: DevsimDetour | None = None  # None when no >= 2-min detour exists (spec §13)
    park: DevsimWalk  # tower entrance -> Elmina Urban Park
    mall: DevsimWalk  # tower entrance -> Lakeside Mall or its Car Park B, the nearer (R18)
    profile: str  # routing profile, "default"
    provenance: str  # "routing engine, default profile"


class SpotlightCast(BaseModel):
    id: str  # "halim", "farid", "worker", "meiling", "zainab", "arjun"
    name: str
    role: str
    persona: str
    home: CastHome
    colour: str  # "#rrggbb"


class Bubble(BaseModel):
    n: int  # 1-based, in time order (demo polish spec §6.3)
    who: str  # SpotlightCast.id
    t0: float
    t1: float
    tone: BubbleTone
    text: str
    tag: str | None = None  # "ROUTE ENGINE · ..." line under the bubble


class Act(BaseModel):
    name: str  # Brief | Construction | Handover | Daily Life
    t0: float
    t1: float


class DevsimAnchors(BaseModel):
    halim_path: list[LonLat]  # the stretch of the detour Halim walks
    farid: LonLat
    worker: LonLat  # the site worker's spot inside the hoarding, beside the tower
    junction: LonLat  # where the entrance path meets the street
    park: LonLat
    mall: LonLat


class DevsimLabels(BaseModel):
    simulation: str = "Simulation · illustrative"
    decorative: str = "Decorative details are illustrative."
    hypothetical: str = "Hypothetical tower · not an SDP project · 30 storeys · ~500 homes"
    simulated: str = "Simulated reactions"


# ---- Demo polish impact outputs (spec 2026-10-21 demo polish §6.1; C7 wires them into the plan) --
TargetKind = Literal["mall", "park", "school", "clinic"]


class ImpactTarget(BaseModel):
    """A daily-life destination: Lakeside Mall, Urban Park, and the school and clinic nearest the
    tower entrance on foot (default profile). Every home uses the same four."""

    id: str  # place id
    name: str
    kind: TargetKind
    # Places that count as arriving (default: just `id`); the mall includes its Car Park B.
    arrive_at: list[str] = []


class HoardingHome(BaseModel):
    """One residential building within the radius, before vs after the hoarding (default walk)."""

    home_id: str  # building id
    extra_min: int  # the largest rounded extra walk over the four targets (>= 0)
    extra_target: str | None = None  # the target id of that walk (None when extra_min is 0)
    # The place that walk arrives at (the mall or its Car Park B, ruling R18), None when extra is 0.
    extra_arrival: str | None = None
    cut_off: bool = False  # a default route that existed before has none after
    wheelchair_cut: bool = False  # a wheelchair route that existed before has none after


class HoardingOption(BaseModel):
    """The impact with only one side of the site hoarded (its frontage walk paths closed)."""

    side: str  # compass side of the site, e.g. "north-east"
    edge_ids: list[str]
    homes_2min_plus: int
    max_extra_min: int
    wheelchair_links_cut: int


class HoardingImpact(BaseModel):
    """Every nearby home's walks to the four targets before and after the hoarding closes the
    frontage paths (routing engine; default profile for minutes, wheelchair for links cut)."""

    radius_m: int
    homes_considered: int  # residential buildings within radius_m of the tower centre
    homes_2min_plus: int  # homes with any target >= 2 min longer (or cut off)
    max_extra_min: int
    # Homes whose wheelchair route to any target was confirmed / likely_ok / partly_unverified
    # before and is blocked / no_data after.
    wheelchair_links_cut: int
    targets: list[ImpactTarget]
    closed_edges: list[str]  # every frontage path the full hoarding closes
    options: list[HoardingOption]  # one per hoarded side
    best_side: str | None  # fewest homes_2min_plus, ties by max_extra_min
    homes: list[HoardingHome]
    profile: str = "default"
    provenance: str = "routing engine, default profile (wheelchair profile for links cut)"


SensitiveType = Literal["school", "kindergarten", "park", "playground"]
SCHOOL_RUN_NOTE = "School run assumed 7–8 am (typical); not from data"


class LorrySensitive(BaseModel):
    """A school, kindergarten, park or playground within 50 m of the lorry route."""

    place_id: str
    name: str
    type: SensitiveType
    distance_m: int  # from the route line to the place (its point, walk node or park outline)
    along_m: int  # how far along the route from the main road it is passed


class LorryRoute(BaseModel):
    """Construction lorries: `drive` route from the nearest major road to the site gate."""

    from_node: str  # the major-road node the lorries leave the main road at
    gate_node: str  # the road node nearest the tower entrance (the site gate)
    path: list[LonLat]
    distance_m: int
    minutes: int  # at the drive profile's 30 km/h
    status: RouteStatus  # a drive route is never "confirmed"
    sensitive: list[LorrySensitive]  # ordered by along_m
    school_run_note: str = SCHOOL_RUN_NOTE  # a labelled assumption, not from data
    profile: str = "drive"
    warnings: list[str] = []


EvacSource = Literal["official_pps", "osm_candidate"]


class DevsimEvacuation(BaseModel):
    """The nearest reachable evacuation centre from the tower entrance (default walk)."""

    centre_id: str
    name: str
    source: EvacSource  # official_pps vs osm_candidate: shown as such, never upgraded
    m: int
    min: int
    status: RouteStatus


class FloodExposure(BaseModel):
    """At handover: the river-rise scenario from which the entrance's usual walk to the main road
    crosses a likely-flooded stretch. Indicative scenario, not a forecast; no depths."""

    road_node: str  # the nearest major-road node the walk goes to
    route_edges: list[str]  # the baseline (no scenario) default-profile walk
    scenarios_checked: list[str]  # the stage_p1m..stage_p5m scenarios the world has, in order
    cut_from_scenario: (
        str | None
    )  # lowest one with a likely_flooded edge on the walk; None = not cut
    cut_edges: list[str]  # the likely_flooded edges in that scenario
    evacuation: DevsimEvacuation | None
    disclaimer: str = "Indicative scenario, not a forecast."
    profile: str = "default"


MatrixValue = int | Literal["?", "gap", "blocked"]


class MatrixCell(BaseModel):
    profile: str  # default | stroller | wheelchair
    status: RouteStatus
    # Minutes, "?" when the route is partly_unverified, "gap" for no_data, "blocked" for blocked.
    value: MatrixValue
    m: int | None = None  # metres, only when value is minutes
    arrival_id: str  # the place the walk ends at (the mall or its Car Park B for the mall row)
    label: str  # how copy names this walk: "Lakeside Mall" / "Lakeside Mall (Car Park B)" / name


class MatrixRow(BaseModel):
    target: ImpactTarget
    cells: list[MatrixCell]  # in DailyLifeMatrix.profiles order


class DailyLifeMatrix(BaseModel):
    """Walks from the tower entrance to the four daily-life targets, per profile."""

    profiles: list[str]
    rows: list[MatrixRow]  # Urban Park, Lakeside Mall, nearest clinic, nearest school


# ---- C4: schedule and cost estimate (devsim_schedule.py) ----------------------------------------
HolidayStatus = Literal["gazetted", "expected"]


class ScheduleHoliday(BaseModel):
    date: str  # ISO date
    name: str
    status: HolidayStatus  # "expected dates" for years whose official list is not yet gazetted
    month_index: int  # months after the start month (0 = the start month)
    working_day: bool  # falls on a site working day (Mon-Sat)


class SchedulePhase(BaseModel):
    name: Literal["foundation", "structure", "fit-out"]
    start: str  # ISO date, inclusive
    end: str  # ISO date, exclusive (the next phase starts here)


class MonsoonBand(BaseModel):
    start_month: str  # "YYYY-MM"
    end_month: str  # "YYYY-MM", inclusive
    start_index: int  # month indices (0 = the start month); the band is clipped to the project
    end_index: int


class RayaSetPiece(BaseModel):
    """The one Hari Raya Aidilfitri site shutdown the playback stages (the first during structure
    work). `days` is the assumed shutdown length in working days, beyond the gazetted holidays."""

    date: str  # Hari Raya Aidilfitri, day 1
    month_index: int
    days: int


class MonsoonMonth(BaseModel):
    month: str  # "YYYY-MM"
    month_index: int
    wet_days: int  # climatology: days with 1.0 mm of rain or more
    days_lost: float  # wet days x the lost fraction, for the structure work in that month


class MonsoonSetPiece(BaseModel):
    """The northeast-monsoon stretch the playback stages (ruling R25): the first band that starts
    after the Hari Raya set piece and before handover, else the band containing Hari Raya.
    `days_lost` per month counts structure work only, so it is 0 in a fit-out month."""

    start_month: str  # "YYYY-MM"
    end_month: str  # "YYYY-MM", inclusive
    months: list[MonsoonMonth]


class Schedule(BaseModel):
    """ESTIMATE: an indicative schedule and cost for the Hypothetical Development, from the
    published benchmarks and labelled assumptions in the sources doc
    (docs/04-architecture/devsim-estimates-sources.md, `devsim_schedule.SOURCES`). Not an SDP
    figure, a quotation or a forecast."""

    storeys: int
    homes: int
    start: str  # ISO date
    handover: str  # ISO date: structure end + fit-out
    months_total: int  # calendar months from the start month to the handover month, inclusive
    months: list[str]  # "YYYY-MM" for each month index
    phases: list[SchedulePhase]
    floors_by_month: list[int]  # floors topped out by the end of each month
    gfa_m2: int  # homes x net area x common factor
    rate_rm_per_m2: int
    cost_total_rm: int
    cost_by_month: list[int]  # cumulative RM by the end of each month (S-curve), ends at the total
    holidays: list[ScheduleHoliday]  # every holiday from the start to the handover
    holiday_days_lost: int  # holidays on structure working days (Mon-Sat), the extended phase
    holidays_lost: list[str]  # their dates
    rain_days_lost: int  # rounded; monsoon wet days x lost fraction over the structure work
    raya_shutdown_days: int  # assumption
    monsoon_bands: list[MonsoonBand]
    raya_set_piece: RayaSetPiece | None
    monsoon_set_piece: MonsoonSetPiece | None
    # Cumulative working days lost (holidays + the Raya shutdown + rain) by the end of each month,
    # 0.1-day precision; the last entry is the unrounded total of the three.
    days_lost_by_month: list[float]
    source_ids: list[str]  # SOURCES rows the estimate used
    label: str = "ESTIMATE"
    source_line: str


# ---- C6: forty simulated residents (devsim_residents.py) ----------------------------------------
ResidentSide = Literal["tower", "neighbour"]
PersonaGroup = Literal["older", "parent", "commuter", "wheelchair", "general"]
WalkValue = int | Literal["?", "gap", "blocked"]


class ResidentWalk(BaseModel):
    kind: TargetKind
    name: str  # the target's place name
    value: WalkValue  # minutes for their profile; "?" partly_unverified, "gap" no_data, "blocked"
    arrival_id: str  # the place the walk ends at (the mall or its Car Park B, ruling R18)
    label: str  # "Lakeside Mall" / "Lakeside Mall (Car Park B)" for the mall, else the name


class ResidentFacts(BaseModel):
    """The only facts a resident's lines may quote (routing engine, their own profile)."""

    profile: str  # wheelchair if a wheelchair user, stroller with a toddler, else default
    home_id: str | None  # the neighbour's building id (None for the tower)
    # Construction detour (neighbours): the largest extra walk over the four targets.
    extra_walk_min: int | None = None
    extra_walk_to: str | None = None  # how the lines name that walk ("Lakeside Mall (Car Park B)")
    extra_walk_arrival: str | None = None  # the place id it arrives at
    walks: list[ResidentWalk]  # park, mall, clinic, school


class ResidentLines(BaseModel):
    construction: str
    handover: str
    daily_life: str


class SimResident(BaseModel):
    id: str  # cast id ("halim") or "t-<resident>" / "n-<resident>"
    name: str
    role: str
    side: ResidentSide
    group: PersonaGroup
    colour: str  # "#rrggbb"
    age: int | None = None
    tags: list[str] = []  # e.g. "wheelchair", "toddler", "children", "commuter", "cast"
    facts: ResidentFacts
    lines: ResidentLines


class SimResidents(BaseModel):
    residents: list[SimResident]  # 20 tower, then 20 neighbours
    seed: int
    label: str = "Simulated reactions"
    note: str = "Lines are written for the simulation; every number comes from the world model."


# ---- C7: the 45 s plan (demo polish spec §6.1-§6.3) ---------------------------------------------
EstimateKind = Literal["gazetted", "benchmark", "climatology", "assumption"]


class EstimateSource(BaseModel):
    """A row of docs/04-architecture/devsim-estimates-sources.md (`devsim_schedule.SOURCES`)."""

    id: str
    value: float
    unit: str
    kind: EstimateKind
    label: str


class TimedTag(BaseModel):
    """A map tag shown for a window: the detour (hoarding impact) and the lorry route (R16)."""

    kind: TagKind
    t0: float
    t1: float
    title: str  # "Detour" | "Lorry route"
    text: str
    at: LonLat


class Banner(BaseModel):
    """The set-piece banners: Hari Raya hold, monsoon stretch, handover."""

    kind: BannerKind
    t0: float
    t1: float
    title: str
    text: str
    badges: list[BriefBadge] = []


class BriefRow(BaseModel):
    key: str  # stable id, e.g. "homes_2min_plus"
    label: str
    value: str
    badges: list[BriefBadge]


class BriefSection(BaseModel):
    key: Literal["construction", "handover", "daily_life"]
    title: str  # During construction | At handover | Daily life (walk minutes)
    rows: list[BriefRow]  # daily_life has none: the web draws `access_matrix` as the table
    notes: list[str] = []


class ImpactBrief(BaseModel):
    """The Impact Brief panel (from 33 s). Replaces the 66 s end card: every value is a computed
    fact (ROUTE, FLOOD) or a labelled ESTIMATE / CALENDAR figure; check_plan reads every digit."""

    title: str
    subtitle: str
    sections: list[BriefSection]


MonthKey = tuple[float, float]


class DevsimPlayground(BaseModel):
    """The playground nearest the tower entrance on foot (routing engine, default profile): where
    the move-in children play (spec §6.2, AC-W5). Decorative figures stand there; no copy quotes
    it today."""

    id: str  # place id
    name: str
    lon: float
    lat: float
    node_id: str  # its walk node
    m: int  # default-profile walk from the tower entrance
    walk_min: int


class DevelopmentPlan(BaseModel):
    """Everything the Development Simulation player needs (spec 2026-10-21 §6)."""

    provisional: bool = False  # True only for the prototype-derived web fixture
    world: str  # site id, "elmina"
    site: DevelopmentSite
    facts: DevsimFacts
    cast: list[SpotlightCast]
    households: int  # tower household count
    acts: list[Act]
    bubbles: list[Bubble]
    tags: list[TimedTag]
    banners: list[Banner]
    anchors: DevsimAnchors
    impact: HoardingImpact
    lorry_route: LorryRoute
    schedule: Schedule
    estimate_sources: list[EstimateSource]  # the SOURCES rows in schedule.source_ids, in order
    # Playback second -> fractional project month (month m = m months after the start of the start
    # month), piecewise linear; ruling R25 windows (Raya hold 11-13 s, monsoon 18.5-23 s,
    # handover month at 27 s).
    month_keys: list[MonthKey]
    month_keys_mode: Literal["baseline", "data-order"]
    flood: FloodExposure
    access_matrix: DailyLifeMatrix
    residents: SimResidents
    brief: ImpactBrief
    playground: DevsimPlayground | None = None  # None when the world has no reachable playground
    labels: DevsimLabels
    total_s: float = 45
