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
  way to open, then is cancelled; other trips are cancelled at once.
- A delay is measured against the same trip on a normal day in the real township.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

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


class Day:
    def __init__(
        self,
        world: World,
        scenario: Scenario,
        pop: Population | None = None,
        n_residents: int = 5000,
        seed: int = 11,
    ):
        self.base_world = world
        self.scenario = scenario
        self.world = (
            twm.apply(world, scenario.actions, max_actions=64).world if scenario.actions else world
        )
        self.graph = Graph(world)
        self.pop = pop or synthesize(world, n_residents, seed)
        self.seed = seed
        self._routers: dict[tuple, Router] = {}
        self._trees: dict[tuple, tuple[np.ndarray, cKDTree]] = {}
        self.changes = scenario.changes()

    # ---- routing helpers -------------------------------------------------------------------
    def router(self, mode: str, stage: str | None, base: bool = False) -> Router:
        key = (mode, stage, base)
        r = self._routers.get(key)
        if r is None:
            w = self.base_world if base else self.world
            r = self._routers[key] = Router(w, self.graph, mode, stage)
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

    # ---- one trip ----------------------------------------------------------------------------
    def travel(self, mode: str, src: int, targets: tuple[int, ...], t0: float, essential: bool):
        pace = DRIVE_PACE if mode == "drive" else PACE.get(mode, 75.0)
        t, node = t0, src
        segs: list[Segment] = []
        rerouted, waited, unknown, length = False, 0.0, 0, 0.0
        started = False
        while True:
            stage = self.scenario.stage_at(t)
            leg = self._leg(mode, stage, False, node, targets)
            if leg is None:
                nxt = self._next_change(t)
                limit = t0 + MAX_WAIT if not started else DAY_END
                if not started and not essential:
                    return "cancelled", None, segs, rerouted, waited, unknown, length
                if nxt is None or nxt > limit or nxt >= DAY_END:
                    if started:
                        segs.append(Segment(t, DAY_END, [node], wait=True))
                        return (
                            "stranded",
                            None,
                            segs,
                            rerouted,
                            waited + DAY_END - t,
                            unknown,
                            length,
                        )
                    return "cancelled", None, segs, rerouted, waited, unknown, length
                segs.append(Segment(t, nxt, [node], wait=True))
                waited += nxt - t
                t = nxt
                continue
            started = True
            cum = [0.0]
            for x in leg.edge_len:
                cum.append(cum[-1] + x)
            times = [t + c / pace for c in cum]
            nxt = self._next_change(t)
            if nxt is None or times[-1] <= nxt:
                segs.append(Segment(t, times[-1], leg.nodes))
                return (
                    "arrived",
                    times[-1],
                    segs,
                    rerouted,
                    waited,
                    unknown + leg.unknown,
                    length + leg.length_m,
                )
            # The river changes on the way: walk to where they are at that minute, then check
            # the rest of the path against the new state.
            k = max(0, bisect.bisect_right(times, nxt) - 1)
            segs.append(Segment(t, times[k], leg.nodes[: k + 1]))
            length += sum(leg.edge_len[:k])
            unknown += sum(leg.edge_unknown[:k])
            rest = leg.edge_ids[k:]
            node = leg.nodes[k]
            t = float(nxt)
            if rest and not self.router(mode, self.scenario.stage_at(t)).passable(rest):
                rerouted = True  # the next loop finds a new way from here, or waits

    # ---- the day ----------------------------------------------------------------------------
    def run(self) -> DayResult:
        acts = plan_day(self.world, self.pop, self.scenario.day, self.seed, self.scenario.event)
        res = {r.id: r for r in self.pop.residents}
        idx = self.graph.index
        free_at: dict[str, float] = {}
        trips: list[Trip] = []
        stays: list[tuple[str, str, str, float, float, int]] = []
        n = 0
        for a in sorted(acts, key=lambda a: (a.depart_min, a.resident)):
            r = res[a.resident]
            home = idx.get(r.home_node)
            targets = tuple(idx[x] for x in a.target_nodes if x in idx)
            if home is None or not targets:
                continue
            depart = max(float(a.depart_min), free_at.get(r.id, 0.0))
            if depart >= DAY_END:
                continue
            mode = self._mode(r, a)
            out = self._trip(f"t{n:05d}", r, a, mode, home, targets, depart, "out")
            n += 1
            trips.append(out)
            if out.arrive is None:
                free_at[r.id] = DAY_END if out.status == "stranded" else depart + out.waited_min
                continue
            leave = out.arrive + a.stay_min
            if a.place_id:
                stays.append(
                    (a.place_id, r.id, r.household, out.arrive, leave, 1 + len(a.companions))
                )
            if a.purpose == "work":
                leave = max(leave, out.arrive)
            back = self._trip(
                f"t{n:05d}", r, a, mode, out.segments[-1].nodes[-1], (home,), leave, "back"
            )
            n += 1
            trips.append(back)
            free_at[r.id] = back.arrive if back.arrive is not None else DAY_END
        return DayResult(self, trips, stays)

    def _mode(self, r, a: Activity) -> str:
        if r.drives and (a.purpose == "work" or self._straight_m(r, a) > DRIVE_OVER_M):
            return "drive"
        return r.persona

    def _straight_m(self, r, a: Activity) -> float:
        x0, y0 = r.home_coord
        x1, y1 = self.world.node_coords[a.target_nodes[0]]
        return math.hypot((x1 - x0) * 111_320 * 0.9984, (y1 - y0) * 110_540)

    def _trip(self, tid, r, a: Activity, mode, src, targets, depart, direction) -> Trip:
        essential = a.purpose in ESSENTIAL
        status, arrive, segs, rerouted, waited, unknown, length = self.travel(
            mode, src, targets, depart, essential
        )
        normal = self._leg(mode, None, True, src, targets)
        pace = DRIVE_PACE if mode == "drive" else PACE.get(mode, 75.0)
        normal_min = normal.length_m / pace if normal else None
        delay = None
        if status == "arrived":
            if normal_min is None:
                status = "data_gap"  # no mapped way on a normal day either: a data gap
            else:
                delay = max(0.0, round(arrive - depart - normal_min, 1))
                status = "late" if delay > LATE_MIN else "on_time"
        elif normal is None and status == "cancelled":
            status = "data_gap"
        stranded_at = None
        if status == "stranded" and segs:
            stranded_at = self.graph.coords[segs[-1].nodes[-1]].round(6).tolist()
        return Trip(
            id=tid,
            resident=r.id,
            purpose=a.purpose,
            label=a.label,
            place_id=a.place_id,
            mode=mode,
            direction=direction,
            planned=float(a.depart_min),
            depart=depart,
            arrive=arrive,
            status=status,
            delay_min=delay,
            normal_min=round(normal_min, 1) if normal_min is not None else None,
            rerouted=rerouted,
            waited_min=round(waited, 1),
            unknown=unknown,
            length_m=round(length, 1),
            companions=list(a.companions),
            segments=segs,
            stranded_at=stranded_at,
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
