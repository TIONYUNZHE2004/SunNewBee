"""Elmina Day: a time-stepped rehearsal of synthetic residents' day on the world model (Cycle 10).

Each resident follows their plan (schedule.py). A trip is routed on the *current* state of the
township: the river stage at that minute, imagined changes (twm actions) and staff closures.
When the river changes while someone is on the way, the rest of their path is checked against
the new state. If it still works they carry on; if not they reroute from where they are; if no
way is left they wait there (stranded) until the water drops. Every number in the result is
counted from these trips. Nothing is predicted for real people.

Rules worth stating (and shown in the UI):
- Lenient routing: unchecked paths may be used (as residents do), and each trip reports how many
  unchecked stretches it crossed. Known barriers and likely-flooded paths are never used.
- No route at departure: an essential trip (school, work, clinic) waits up to 90 minutes for a
  way to open, then is cancelled; other trips are cancelled at once. A resident who cannot get
  home waits where they are; still stuck at 23:00 means stranded.
- A delay is measured from the planned time against the same trip on a normal day in the real
  township, so time lost queueing behind an earlier trip counts.
- When the river changes on the way, residents re-plan at the last junction they passed (a
  short pause there, shown as waiting).
- Staff closures in force at noon on the rehearsal day count for the whole day.
"""

from __future__ import annotations

import bisect
import math
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import numpy as np
from scipy.spatial import cKDTree

from .. import twm
from ..world import World
from .population import Population, synthesize
from .router import Graph, Leg, Router
from .schedule import ASSUMPTIONS, Activity, plan_day

PACE = {"default": 75.0, "stroller": 65.0, "wheelchair": 60.0, "older_adult_rest": 50.0}
DRIVE_PACE = 500.0
DAY_START, DAY_END = 5 * 60, 23 * 60
ESSENTIAL = {"school", "work", "clinic"}
MAX_WAIT = 90
LATE_MIN = 10
DRIVE_OVER_M = 1000.0  # residents who drive take the car beyond this straight-line distance
DISCLAIMER = (
    "Rehearsal of synthetic residents on the township model: not a forecast and not real "
    "people. River levels are indicative scenarios; follow official MBSA / JPS / NADMA guidance."
)


@dataclass
class Scenario:
    id: str
    label: str
    summary: str
    day: str = "weekday"
    stages: list[tuple[int, str | None]] = field(default_factory=lambda: [(0, None)])
    actions: list = field(default_factory=list)  # imagined changes (twm actions)
    event: dict | None = None
    rain: list[tuple[int, int]] = field(default_factory=list)
    hero: str = ""  # one line for the panel

    def stage_at(self, t: float) -> str | None:
        cur = None
        for m, sid in self.stages:
            if m <= t:
                cur = sid
        return cur

    def changes(self) -> list[int]:
        out, prev = [], object()
        for m, sid in sorted(self.stages, key=lambda x: x[0]):
            if sid != prev:
                out.append(m)
            prev = sid
        return [m for m in out if m > 0]


@dataclass
class Decision:
    """A moment where a spotlight resident chooses. Options come from the engine and are all
    feasible at that minute; `chosen` is the option taken (the rule default unless decided)."""

    key: str
    resident: str
    kind: str  # no_way_at_departure | caught_on_the_way
    t: float
    purpose: str
    direction: str
    options: list[dict]
    default: str
    chosen: str


@dataclass
class Travel:
    status: str  # arrived | cancelled | stranded | turned_back
    arrive: float | None
    segments: list
    rerouted: bool = False
    waited: float = 0.0
    unknown: int = 0
    length: float = 0.0
    mode: str = ""
    place_id: str | None = None  # changed when the resident chose another place
    ended_at: float | None = None  # when a trip that never arrived ended (gave up, day over)


@dataclass
class Segment:
    t0: float
    t1: float
    nodes: list[int]
    wait: bool = False


@dataclass
class Trip:
    id: str
    resident: str
    purpose: str
    label: str
    place_id: str | None
    mode: str  # walk persona id or "drive"
    direction: str  # out | back
    planned: float
    depart: float
    arrive: float | None
    status: str  # on_time | late | stranded | cancelled | data_gap
    delay_min: float | None
    normal_min: float | None
    rerouted: bool
    waited_min: float
    unknown: int
    length_m: float
    companions: list[str]
    segments: list[Segment]
    stranded_at: list[float] | None = None  # coord where the resident was stuck
    reason: str = ""
    ended_at: float | None = None  # a trip that never arrived: when it ended


class Day:
    def __init__(
        self,
        world: World,
        scenario: Scenario,
        pop: Population | None = None,
        n_residents: int = 5000,
        seed: int = 11,
        spotlight=None,
        decisions: dict[str, str] | None = None,
        on: date | None = None,
    ):
        self.base_world = world
        self.scenario = scenario
        self.world = (
            twm.apply(world, scenario.actions, max_actions=64).world if scenario.actions else world
        )
        self.graph = Graph(world)
        self.pop = pop or synthesize(world, n_residents, seed)
        self.seed = seed
        self.on = on or date.today()
        # Noon in Malaysia (UTC+8) on the rehearsal day: when staff closures are evaluated.
        self.now = datetime(self.on.year, self.on.month, self.on.day, 4, tzinfo=UTC)
        self._fields: OrderedDict = OrderedDict()
        self._routers: dict[tuple, Router] = {}
        self._trees: dict[tuple, tuple[np.ndarray, cKDTree]] = {}
        self.changes = scenario.changes()
        # Spotlight residents choose at decision moments (spotlight.py); everyone else follows
        # the rules. `decisions` maps a decision key to an option id, from an earlier pass.
        self.spotlight: set[str] = set(spotlight or ())
        self.decisions: dict[str, str] = dict(decisions or {})
        self.points: list[Decision] = []
        self._purpose_places: dict[str, list[tuple[str, int]]] | None = None

    # ---- routing helpers -------------------------------------------------------------------
    def router(self, mode: str, stage: str | None, base: bool = False) -> Router:
        key = (mode, stage, base)
        r = self._routers.get(key)
        if r is None:
            w = self.base_world if base else self.world
            r = self._routers[key] = Router(
                w, self.graph, mode, stage, now=self.now, fields=self._fields
            )
        return r

    def _snap(self, mode: str, idx: int) -> int | None:
        """Drivers start and end at the nearest road node (within 400 m). The road network is
        the normal one: a flooded or closed road never moves anyone elsewhere, it just has no
        way through. Walkers are never moved: if their own node is cut off, they are cut off."""
        if mode != "drive":
            return idx
        roads = self.router("drive", None, base=True).usable_nodes
        if roads[idx]:
            return idx
        hit = self._trees.get(("drive",))
        if hit is None:
            ids = np.flatnonzero(roads)
            if not len(ids):
                return None
            pts = self.graph.coords[ids] * np.array([111_320 * 0.9984, 110_540])
            hit = self._trees[("drive",)] = (ids, cKDTree(pts))
        ids, tree = hit
        d, j = tree.query(self.graph.coords[idx] * np.array([111_320 * 0.9984, 110_540]))
        return int(ids[int(j)]) if d < 400 else None

    def _leg(self, mode, stage, base, src: int, targets: tuple[int, ...]) -> Leg | None:
        r = self.router(mode, stage, base)
        s = self._snap(mode, src)
        ts = tuple(t for t in (self._snap(mode, x) for x in targets) if t is not None)
        if s is None or not ts:
            return None
        return r.leg(s, ts)

    def _next_change(self, t: float) -> int | None:
        i = bisect.bisect_right(self.changes, t)
        return self.changes[i] if i < len(self.changes) else None

    # ---- decisions ---------------------------------------------------------------------------
    def _alternative(self, mode, stage, node, purpose, exclude) -> tuple[str, int] | None:
        """The nearest other place for this purpose that can be reached now."""
        if self._purpose_places is None:
            from .schedule import _places_by_purpose

            idx = self.graph.index
            self._purpose_places = {
                k: [(p.id, idx[p.node_id]) for p in v if p.node_id in idx]
                for k, v in _places_by_purpose(self.world, self.now).items()
            }
        cands = [(pid, n) for pid, n in self._purpose_places.get(purpose, []) if pid != exclude]
        best = None
        for pid, n in cands:
            leg = self._leg(mode, stage, False, node, (n,))
            if leg and (best is None or leg.length_m < best[2]):
                best = (pid, n, leg.length_m)
        return (best[0], best[1]) if best else None

    def _decide(self, who, kind, t, purpose, direction, options, default, n) -> str:
        if who not in self.spotlight:
            return default
        key = f"{who}|{purpose}|{direction}|{kind}|{n}"
        chosen = self.decisions.get(key, default)
        if chosen not in {o["id"] for o in options}:
            chosen = default  # a stale or invalid decision never forces an impossible move
        self.points.append(
            Decision(key, who, kind, round(t, 1), purpose, direction, options, default, chosen)
        )
        return chosen

    # ---- one trip ----------------------------------------------------------------------------
    def travel(
        self,
        mode: str,
        src: int,
        targets: tuple[int, ...],
        t0: float,
        essential: bool,
        who: str | None = None,
        purpose: str = "",
        direction: str = "out",
        place_id: str | None = None,
    ) -> Travel:
        """One trip on the township state minute by minute. `essential` trips wait up to 90
        minutes for a way to open; a trip home (direction "back") waits as long as it takes."""
        pace = DRIVE_PACE if mode == "drive" else PACE.get(mode, 75.0)
        t, node = t0, src
        out = Travel("arrived", None, [], mode=mode, place_id=place_id)
        started = False
        must_wait = essential or direction == "back"
        asked: set[str] = set()
        spot = who in self.spotlight
        while True:
            stage = self.scenario.stage_at(t)
            leg = self._leg(mode, stage, False, node, targets)
            if leg is None:
                nxt = self._next_change(t)
                if not started and self._leg(mode, None, True, node, targets) is None:
                    # No mapped way even on a normal day: a data gap, nothing to wait for.
                    out.status, out.ended_at = "cancelled", t
                    return out
                if not started and spot and "no_way_at_departure" not in asked:
                    asked.add("no_way_at_departure")
                    opts = [
                        {"id": "wait", "label": "Wait for a way to open (up to 90 minutes)"},
                        {
                            "id": "cancel",
                            "label": "Stay where I am" if direction == "back" else "Stay home",
                        },
                    ]
                    alt = (
                        self._alternative(mode, stage, node, purpose, place_id)
                        if purpose not in ("work", "") and direction == "out"
                        else None
                    )
                    if alt:
                        p = self.world.places.get(alt[0])
                        opts.append(
                            {
                                "id": "other_place",
                                "place_id": alt[0],
                                "label": f"Go to {p.name if p else 'another place'} instead",
                            }
                        )
                    if mode != "drive" and self._leg("drive", stage, False, node, targets):
                        opts.append(
                            {"id": "lift", "label": "Ask a neighbour with a car for a lift"}
                        )
                    choice = self._decide(
                        who,
                        "no_way_at_departure",
                        t,
                        purpose,
                        direction,
                        opts,
                        "wait" if must_wait else "cancel",
                        0,
                    )
                    if choice == "cancel" and direction == "out":
                        out.status, out.ended_at = "cancelled", t
                        return out
                    if choice == "wait":
                        must_wait = True
                    if choice == "other_place" and alt:
                        targets, out.place_id = (alt[1],), alt[0]
                        continue
                    if choice == "lift":
                        mode = out.mode = "drive"
                        pace = DRIVE_PACE
                        continue
                if not started and not must_wait:
                    out.status, out.ended_at = "cancelled", t
                    return out
                if started and "caught_on_the_way" not in asked:
                    asked.add("caught_on_the_way")
                    # Caught by the water on the way out: turn back home if there is still a way
                    # (the rule for everyone; spotlight residents choose for themselves). On the
                    # way home there is nowhere better to go: wait where you are.
                    back = (
                        self._leg(mode, stage, False, node, (src,))
                        if node != src and direction == "out"
                        else None
                    )
                    opts = [{"id": "wait_here", "label": "Wait here until the water drops"}]
                    if back:
                        opts.append({"id": "turn_back", "label": "Turn back home"})
                    default = "turn_back" if back else "wait_here"
                    choice = default
                    if spot:
                        choice = self._decide(
                            who, "caught_on_the_way", t, purpose, direction, opts, default, 0
                        )
                    if choice == "turn_back" and back:
                        t1 = t + back.length_m / pace
                        out.segments.append(Segment(t, t1, back.nodes))
                        out.length += back.length_m
                        out.unknown += back.unknown
                        out.status, out.arrive = "turned_back", t1
                        return out
                gives_up = not started and direction == "out"
                limit = t0 + MAX_WAIT if gives_up else DAY_END
                if nxt is None or nxt > limit or nxt >= DAY_END:
                    end = min(limit, DAY_END)
                    if end > t:
                        out.segments.append(Segment(t, end, [node], wait=True))
                        out.waited += end - t
                    out.ended_at = end
                    out.status = "cancelled" if gives_up else "stranded"
                    return out
                out.segments.append(Segment(t, nxt, [node], wait=True))
                out.waited += nxt - t
                t = nxt
                continue
            started = True
            cum = [0.0]
            for x in leg.edge_len:
                cum.append(cum[-1] + x)
            times = [t + c / pace for c in cum]
            # Each later change of river level before arrival: is the path ahead still usable
            # in the new state? If so, carry on without stopping; if not, stop at the last
            # junction before that minute and re-plan there.
            cut = None
            c = self._next_change(t)
            while c is not None and c < times[-1]:
                k = max(0, bisect.bisect_right(times, c) - 1)
                ahead = leg.edge_ids[k:]
                if ahead and not self.router(mode, self.scenario.stage_at(c)).passable(ahead):
                    cut = (c, k)
                    break
                c = self._next_change(c)
            if cut is None:
                out.segments.append(Segment(t, times[-1], leg.nodes))
                out.arrive = times[-1]
                out.unknown += leg.unknown
                out.length += leg.length_m
                return out
            c, k = cut
            out.segments.append(Segment(t, times[k], leg.nodes[: k + 1]))
            if c > times[k]:
                out.segments.append(Segment(times[k], float(c), [leg.nodes[k]], wait=True))
            out.length += sum(leg.edge_len[:k])
            out.unknown += sum(leg.edge_unknown[:k])
            node = leg.nodes[k]
            t = float(c)
            out.rerouted = True  # the next loop finds a new way from here, or waits

    # ---- the day ----------------------------------------------------------------------------
    def run(self) -> DayResult:
        acts = plan_day(
            self.world, self.pop, self.scenario.day, self.seed, self.scenario.event, self.now
        )
        res = {r.id: r for r in self.pop.residents}
        idx = self.graph.index
        free_at: dict[str, float] = {}
        at: dict[str, tuple[int, float]] = {}  # resident -> (node, minute) for a chained plan
        stuck: set[str] = set()
        trips: list[Trip] = []
        stays: list[tuple] = []
        n = 0
        for a in sorted(acts, key=lambda a: (a.depart_min, a.resident)):
            r = res[a.resident]
            home = idx.get(r.home_node)
            targets = tuple(idx[x] for x in a.target_nodes if x in idx)
            if home is None or not targets:
                continue
            if r.id in stuck:
                # Still stuck from an earlier trip: this plan cannot happen (and is counted).
                trips.append(self._missed(f"t{n:05d}", r, a))
                n += 1
                continue
            src = home
            depart = max(float(a.depart_min), free_at.get(r.id, 0.0))
            planned = float(a.depart_min)
            if a.chained:
                if r.id not in at:
                    continue  # the plan it was chained to did not reach its place
                src, depart = at.pop(r.id)
                planned = depart  # straight on from the school gate
            if depart >= DAY_END:
                continue
            mode = self._mode(r, a)
            kids_out = a.companions if a.kids_out else []
            out = self._trip(
                f"t{n:05d}", r, a, mode, src, targets, depart, "out", planned, kids_out
            )
            n += 1
            trips.append(out)
            if out.status == "stranded":
                stuck.add(r.id)
                continue
            if out.arrive is None or out.status == "turned_back":
                ended = out.arrive if out.arrive is not None else (out.ended_at or depart)
                free_at[r.id] = ended
                continue
            leave = out.arrive + a.stay_min
            if a.until_min is not None:
                leave = max(leave, float(a.until_min))
            if a.chain_next:
                # no trip home: the next plan (the commute) starts here
                at[r.id] = (out.segments[-1].nodes[-1], out.arrive)
                free_at[r.id] = out.arrive
                continue
            if out.place_id:
                stays.append(
                    (
                        out.place_id,
                        r.id,
                        r.household,
                        out.arrive,
                        leave,
                        1 + len(a.companions),
                        a.purpose,
                    )
                )
            if leave >= DAY_END:
                continue  # comes home after the rehearsal window
            kids_back = a.companions if a.kids_back else []
            back = self._trip(
                f"t{n:05d}",
                r,
                a,
                out.mode,
                out.segments[-1].nodes[-1],
                (home,),
                leave,
                "back",
                leave,
                kids_back,
            )
            n += 1
            trips.append(back)
            if back.status == "stranded":
                stuck.add(r.id)
            free_at[r.id] = back.arrive if back.arrive is not None else DAY_END
        return DayResult(self, trips, stays)

    def _mode(self, r, a: Activity) -> str:
        if a.purpose == "work":
            return "drive"  # commuters drive, or take a ride-hail or a lift (assumption)
        if r.drives and self._straight_m(r, a) > DRIVE_OVER_M:
            return "drive"
        return r.persona

    def _straight_m(self, r, a: Activity) -> float:
        x0, y0 = r.home_coord
        x1, y1 = self.world.node_coords[a.target_nodes[0]]
        return math.hypot((x1 - x0) * 111_320 * 0.9984, (y1 - y0) * 110_540)

    def _missed(self, tid, r, a: Activity) -> Trip:
        return Trip(
            id=tid,
            resident=r.id,
            purpose=a.purpose,
            label=a.label,
            place_id=a.place_id,
            mode=r.persona,
            direction="out",
            planned=float(a.depart_min),
            depart=float(a.depart_min),
            arrive=None,
            status="cancelled",
            delay_min=None,
            normal_min=None,
            rerouted=False,
            waited_min=0.0,
            unknown=0,
            length_m=0.0,
            companions=list(a.companions) if a.kids_out else [],
            segments=[],
            reason="still stuck from an earlier trip",
        )

    def _trip(
        self, tid, r, a: Activity, mode, src, targets, depart, direction, planned, companions
    ) -> Trip:
        essential = a.purpose in ESSENTIAL
        tr = self.travel(
            mode,
            src,
            targets,
            depart,
            essential,
            who=r.id,
            purpose=a.purpose,
            direction=direction,
            place_id=a.place_id,
        )
        mode = tr.mode
        normal = self._leg(mode, None, True, src, targets)
        pace = DRIVE_PACE if mode == "drive" else PACE.get(mode, 75.0)
        normal_min = normal.length_m / pace if normal else None
        status, delay = tr.status, None
        if status == "arrived":
            if normal_min is None:
                status = "data_gap"  # no mapped way on a normal day either: a data gap
            else:
                # From the planned time, against the same trip on a normal day.
                delay = max(0.0, round(tr.arrive - planned - normal_min, 1))
                status = "late" if delay > LATE_MIN else "on_time"
        elif normal is None and status == "cancelled":
            status = "data_gap"
        stranded_at = None
        if status == "stranded" and tr.segments:
            stranded_at = self.graph.coords[tr.segments[-1].nodes[-1]].round(6).tolist()
        return Trip(
            id=tid,
            resident=r.id,
            purpose=a.purpose,
            label=a.label,
            place_id=tr.place_id,
            mode=mode,
            direction=direction,
            planned=planned,
            depart=depart,
            arrive=tr.arrive,
            status=status,
            delay_min=delay,
            normal_min=round(normal_min, 1) if normal_min is not None else None,
            rerouted=tr.rerouted,
            waited_min=round(tr.waited, 1),
            unknown=tr.unknown,
            length_m=round(tr.length, 1),
            companions=list(companions),
            segments=tr.segments,
            stranded_at=stranded_at,
            ended_at=tr.ended_at,
        )


class DayResult:
    def __init__(self, day: Day, trips: list[Trip], stays):
        self.day, self.trips, self.stays = day, trips, stays

    def by_resident(self) -> dict[str, list[Trip]]:
        out: dict[str, list[Trip]] = {}
        for t in self.trips:
            out.setdefault(t.resident, []).append(t)
        return out


__all__ = ["ASSUMPTIONS", "DISCLAIMER", "Day", "DayResult", "Scenario", "Trip"]
