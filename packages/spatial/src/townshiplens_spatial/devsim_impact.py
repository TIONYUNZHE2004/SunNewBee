"""Development Simulation impact facts (demo polish spec 2026-10-21 §6.1, AC-C1, C2, C5, C6).

Everything here comes from the routing engine over the mapped walk and road network:

- `hoarding_impact`: every residential building within 500 m of the tower, walking to the same
  four targets (Lakeside Mall, Urban Park, nearest school, nearest clinic) before and after the
  hoarding closes the site's frontage paths, overall and per hoarded side;
- `lorry_route`: the `drive` route from the nearest major road to the site gate, with the
  schools, kindergartens, parks and playgrounds beside it;
- `flood_exposure`: the lowest river-rise scenario at which the entrance's usual walk to the main
  road crosses a `likely_flooded` stretch, and the nearest evacuation candidate;
- `daily_life_matrix`: walk minutes from the tower entrance to the four targets for the default,
  stroller and wheelchair profiles.

They are callable from `build_development_plan`'s inputs (world, site, layout) and cached per world
version and site. The plan wiring (copy, beats, `check_plan`) is a later task (C7).
"""

from __future__ import annotations

import heapq
import itertools
import logging
import math
import time
from collections.abc import Callable, Iterable
from typing import Any

from shapely.geometry import Point, shape
from shapely.ops import nearest_points

from . import devsim, routing, twm
from .devsim_models import (
    DailyLifeMatrix,
    DevelopmentSite,
    DevsimEvacuation,
    FloodExposure,
    HoardingHome,
    HoardingImpact,
    HoardingOption,
    ImpactTarget,
    LorryRoute,
    LorrySensitive,
    MatrixCell,
    MatrixRow,
)
from .flood import centres_reachability
from .world import World

log = logging.getLogger(__name__)

IMPACT_RADIUS_M = 500.0
EXTRA_MIN = 2  # "2 min or more longer"
REACHED = frozenset({"confirmed", "likely_ok", "partly_unverified"})
COMPASS = (
    "north",
    "north-east",
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
)


# ---- cache -------------------------------------------------------------------------------------
_CACHE: dict[tuple, tuple[World, Any]] = {}
_CACHE_MAX = 16


def _cached[T](name: str, world: World, site: DevelopmentSite | None, build: Callable[[], T]) -> T:
    """One result per (world object, world.version, site): the world can change in place (claims,
    closures bump `version`), the site is part of the key as JSON."""
    key = (name, id(world), world.version, site.model_dump_json() if site else None)
    hit = _CACHE.get(key)
    if hit is not None and hit[0] is world:
        return hit[1]
    t0 = time.perf_counter()
    value = build()
    log.info("devsim %s built in %.2f s", name, time.perf_counter() - t0)
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = (world, value)
    return value


def clear_cache() -> None:
    _CACHE.clear()


# ---- one-to-all walks ----------------------------------------------------------------------------
def walk_tree(
    world: World,
    profile_id: str,
    sources: Iterable[str],
    allow_unknown: bool,
    goals: Iterable[str] | None = None,
) -> dict[str, float]:
    """Metres of the cheapest path from any source to every settled node, costed by the routing
    engine's own edge rules (`routing.make_weight`: strict = PASS only, lenient = PASS + UNKNOWN).

    Walking profiles ignore one-way tags, so the edge costs are symmetric and one search from a
    target gives every home's walk to it (the same cost as `plan_route` home -> target; equal-cost
    ties may pick a different path). Stops once every goal is settled."""
    profile = world.profiles[profile_id]
    chosen: dict[tuple[str, str], str] = {}
    weight = routing.make_weight(world, profile, None, allow_unknown, chosen=chosen)
    g = world.graph
    cost: dict[str, float] = {}
    metres: dict[str, float] = {}
    done: dict[str, float] = {}
    tick = itertools.count()
    heap: list[tuple[float, int, str]] = []
    for s in dict.fromkeys(sources):
        if s in g:
            cost[s], metres[s] = 0.0, 0.0
            heapq.heappush(heap, (0.0, next(tick), s))
    left = set(goals) if goals is not None else None
    while heap:
        d, _, v = heapq.heappop(heap)
        if v in done:
            continue
        done[v] = metres[v]
        if left is not None:
            left.discard(v)
            if not left:
                break
        for u, data in g[v].items():
            if u in done:
                continue
            c = weight(v, u, data)
            if c is None:
                continue
            if u not in cost or d + c < cost[u]:
                cost[u] = d + c
                metres[u] = metres[v] + world.edges[chosen[(v, u)]].length_m
                heapq.heappush(heap, (cost[u], next(tick), u))
    return done


def _pace(world: World, profile_id: str = devsim.PROFILE) -> float:
    return routing._pace_m_per_min(world.profiles[profile_id])


# ---- targets -----------------------------------------------------------------------------------
def _nearest_of(world: World, tree: dict[str, float], types: set[str]) -> str | None:
    best: tuple[float, str] | None = None
    for p in world.places.values():
        if p.type not in types:
            continue
        ds = [tree[n] for n in routing._targets(world, p.id) if n in tree]
        if ds and (best is None or (min(ds), p.id) < best):
            best = (min(ds), p.id)
    return best[1] if best else None


def impact_targets(world: World, site: DevelopmentSite) -> list[ImpactTarget]:
    """Lakeside Mall (arriving at the mall or its Car Park B), Urban Park, and the school and
    clinic nearest the tower entrance on foot (default profile, lenient pass so an unchecked path
    still counts as a way there)."""

    def build() -> list[ImpactTarget]:
        entrance = devsim._node_at(world, site.entrance.path[-1])
        tree = walk_tree(world, devsim.PROFILE, [entrance], True)
        mall = devsim._place_by_name(world, devsim.MALL_NAME)
        # The mall is reached at the mall or at its Car Park B (the detour walk's destination),
        # so Halim's "+N min to the mall" bubble and this summary measure the same walk.
        car_park = devsim._place_by_name(world, devsim.TARGET_NAME)
        out = [
            ImpactTarget(id=mall, name="", kind="mall", arrive_at=[mall, car_park]),
            ImpactTarget(id=devsim._place_by_name(world, devsim.PARK_NAME), name="", kind="park"),
        ]
        for kind in ("school", "clinic"):
            pid = _nearest_of(world, tree, {kind})
            if pid is None:
                raise devsim.DevsimUnavailable(f"no {kind} reachable from the tower")
            out.append(ImpactTarget(id=pid, name="", kind=kind))
        for t in out:
            t.name = world.places[t.id].name
        return out

    return _cached("targets", world, site, build)


# ---- C1: hoarding impact -------------------------------------------------------------------------
def _compass(dx: float, dy: float) -> str:
    return COMPASS[round((math.degrees(math.atan2(dx, dy)) % 360) / 45) % 8]


def hoarding_sides(world: World, site: DevelopmentSite, lay=None) -> dict[str, list[str]]:
    """The frontage paths (`devsim.frontage_edges`) grouped by the side of the site they run
    along: the tower rectangle's side whose outward normal best matches the direction from the
    tower centre to the path's nearest point to the site. Keys are compass names."""
    lay = lay or devsim._layout(world, site)
    ring = list(lay.tower.exterior.coords)[:4]
    cx, cy = lay.centre.x, lay.centre.y
    normals = []
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1], strict=True):
        mx, my = (ax + bx) / 2 - cx, (ay + by) / 2 - cy
        ln = math.hypot(mx, my)
        normals.append((mx / ln, my / ln))
    out: dict[str, list[str]] = {}
    for eid in devsim.frontage_edges(world, site):
        p = nearest_points(lay.fr.line(world.edges[eid].coords), lay.site_area)[0]
        vx, vy = p.x - cx, p.y - cy
        nx_, ny_ = max(normals, key=lambda n: n[0] * vx + n[1] * vy)
        out.setdefault(_compass(nx_, ny_), []).append(eid)
    return {k: sorted(v) for k, v in sorted(out.items())}


def impact_homes(
    world: World, site: DevelopmentSite, lay=None, radius_m: float = IMPACT_RADIUS_M
) -> list[tuple[str, str]]:
    """(building id, snapped walk node) for every residential building within radius_m of the
    tower centre, nearest first (as `devsim.detour_home_node` snaps a home)."""
    lay = lay or devsim._layout(world, site)
    snapper = devsim._Snapper(world, lay.fr)
    return [(hid, snapper(c)[0]) for d, hid, c in devsim._homes_near(world, lay) if d <= radius_m]


def _close(world: World, edge_ids: list[str]) -> World:
    actions = [twm.ClosePath(element_id=e) for e in edge_ids]
    return twm.apply(world, actions, max_actions=max(len(actions), 1)).world


def _arrivals(t: ImpactTarget) -> list[str]:
    return t.arrive_at or [t.id]


def _trees(world: World, targets: list[ImpactTarget], goals: set[str]):
    """Per arrival place: default strict, default lenient, wheelchair lenient walk trees."""
    out = {}
    for pid in dict.fromkeys(p for t in targets for p in _arrivals(t)):
        src = routing._targets(world, pid)
        out[pid] = (
            walk_tree(world, devsim.PROFILE, src, False, goals),
            walk_tree(world, devsim.PROFILE, src, True, goals),
            walk_tree(world, "wheelchair", src, True, goals),
        )
    return out


def _place_m(trees, pid: str, node: str) -> float | None:
    """plan_route's choice: the strict route when one exists, else the lenient one."""
    strict, lenient, _ = trees[pid]
    return strict[node] if node in strict else lenient.get(node)


def _walk_m(trees, t: ImpactTarget, node: str) -> float | None:
    """The shortest of the plan_route walks to the target's arrival places."""
    ms = [m for pid in _arrivals(t) if (m := _place_m(trees, pid, node)) is not None]
    return min(ms) if ms else None


def _wheelchair_ok(trees, t: ImpactTarget, node: str) -> bool:
    return any(node in trees[pid][2] for pid in _arrivals(t))


def _compare(world, homes, targets, before, after) -> list[HoardingHome]:
    pace = _pace(world)
    rows = []
    for hid, node in homes:
        extra, worst, cut, wcut = 0, None, False, False
        for t in targets:
            b, a = _walk_m(before, t, node), _walk_m(after, t, node)
            if b is not None:
                if a is None:
                    cut = True
                elif (x := devsim._round_min(a / pace - b / pace)) > extra:
                    extra, worst = x, t.id
            if _wheelchair_ok(before, t, node) and not _wheelchair_ok(after, t, node):
                wcut = True
        rows.append(
            HoardingHome(
                home_id=hid, extra_min=extra, extra_target=worst, cut_off=cut, wheelchair_cut=wcut
            )
        )
    return rows


def _stats(rows: list[HoardingHome]) -> tuple[int, int, int]:
    return (
        sum(1 for r in rows if r.extra_min >= EXTRA_MIN or r.cut_off),
        max((r.extra_min for r in rows), default=0),
        sum(1 for r in rows if r.wheelchair_cut),
    )


def impact_core(
    world: World,
    homes: list[tuple[str, str]],
    targets: list[ImpactTarget],
    sides: dict[str, list[str]],
    radius_m: float = IMPACT_RADIUS_M,
) -> HoardingImpact:
    """The hoarding summary for these homes (building id, walk node), targets and hoarding sides
    (side -> walk edges the hoarding closes on that side). World-agnostic, for tests."""
    goals = {n for _, n in homes}
    closed = sorted({e for es in sides.values() for e in es})
    with routing.eval_memo():
        before = _trees(world, targets, goals)
        after_all = _trees(_close(world, closed), targets, goals) if closed else before
        rows = _compare(world, homes, targets, before, after_all)
        options = []
        for side, edge_ids in sides.items():
            if sorted(edge_ids) == closed:
                side_rows = rows
            else:
                side_rows = _compare(
                    world, homes, targets, before, _trees(_close(world, edge_ids), targets, goals)
                )
            n2, mx, wc = _stats(side_rows)
            options.append(
                HoardingOption(
                    side=side,
                    edge_ids=sorted(edge_ids),
                    homes_2min_plus=n2,
                    max_extra_min=mx,
                    wheelchair_links_cut=wc,
                )
            )
    n2, mx, wc = _stats(rows)
    best = min(options, key=lambda o: (o.homes_2min_plus, o.max_extra_min, o.side), default=None)
    return HoardingImpact(
        radius_m=round(radius_m),
        homes_considered=len(homes),
        homes_2min_plus=n2,
        max_extra_min=mx,
        wheelchair_links_cut=wc,
        targets=targets,
        closed_edges=closed,
        options=options,
        best_side=best.side if best else None,
        homes=rows,
    )


def hoarding_impact(world: World, site: DevelopmentSite, lay=None) -> HoardingImpact:
    """AC-C1: every residential building within 500 m of the tower, before vs after the hoarding.

    Raises DevsimUnavailable when the world lacks the parcel or a target."""

    def build() -> HoardingImpact:
        layout = lay or devsim._layout(world, site)
        return impact_core(
            world,
            impact_homes(world, site, layout),
            impact_targets(world, site),
            hoarding_sides(world, site, layout),
        )

    return _cached("hoarding_impact", world, site, build)


# ---- C2: lorry route ---------------------------------------------------------------------------
LORRY_PROFILE = "drive"
SENSITIVE_TYPES = ("school", "kindergarten", "park", "playground")
SENSITIVE_M = 50.0
GATE_PLACE = "devsim-gate"
ROAD_PLACE = "devsim-main-road"
MAX_ROAD_TRIES = 8


def _major_road_nodes(world: World, lay) -> list[str]:
    """Nodes on `major_road` edges, nearest the tower centre first (ties by id)."""
    nodes = {
        n for e in world.edges.values() if e.type == "major_road" for n in (e.from_node, e.to_node)
    }
    return sorted(nodes, key=lambda n: (lay.centre.distance(_xy(world, lay, n)), n))


def _xy(world: World, lay, node: str):
    return Point(lay.fr.xy(world.node_coords[node]))


def _outlines(world: World) -> dict[str, Any]:
    """OSM outlines of park places (base/parks.geojson, by OSM way id)."""
    out = {}
    for f in devsim._features(world, "parks.geojson"):
        osm = f["properties"].get("id", "")
        out[f"osm-{osm.replace('/', '-')}"] = shape(f["geometry"])
    return out


def _sensitive(world: World, lay, line) -> list[LorrySensitive]:
    outlines = _outlines(world)
    rows = []
    for p in world.places.values():
        if p.type not in SENSITIVE_TYPES:
            continue
        geoms = [Point(lay.fr.xy(p.coord))]
        if p.node_id and p.node_id in world.node_coords:
            geoms.append(_xy(world, lay, p.node_id))
        if (o := outlines.get(p.id)) is not None:
            geoms.append(lay.fr.geom(o))
        d, g = min(((line.distance(g), i) for i, g in enumerate(geoms)), key=lambda t: t)
        if d > SENSITIVE_M:
            continue
        on_line = nearest_points(line, geoms[g])[0]
        rows.append(
            LorrySensitive(
                place_id=p.id,
                name=p.name,
                type=p.type,
                distance_m=round(d),
                along_m=round(line.project(on_line)),
            )
        )
    return sorted(rows, key=lambda r: (r.along_m, r.distance_m, r.place_id))


def lorry_route(world: World, site: DevelopmentSite, lay=None) -> LorryRoute:
    """AC-C2: the `drive` route from the nearest major-road node to the site gate, and the schools,
    kindergartens, parks and playgrounds within 50 m of it.

    The gate is the road node nearest the tower entrance's walk node (drive routing snaps a place
    to the nearest road node within 150 m). When the nearest major-road node has no mapped road
    connection to the gate, the next nearest is tried. Raises DevsimUnavailable when none does."""

    def build() -> LorryRoute:
        layout = lay or devsim._layout(world, site)
        entrance = devsim._node_at(world, site.entrance.path[-1])
        gate = devsim._temp_place(GATE_PLACE, "Site gate", world, entrance)
        for node in _major_road_nodes(world, layout)[:MAX_ROAD_TRIES]:
            road = devsim._temp_place(ROAD_PLACE, "Main road", world, node)
            w = devsim._with_places(world, [gate, road])
            res = routing.plan_route(w, ROAD_PLACE, GATE_PLACE, LORRY_PROFILE)
            if not res.routes:
                continue
            r = res.routes[0]
            path = devsim._route_path(r)
            line = layout.fr.line(path)
            pace = _pace(world, LORRY_PROFILE)
            return LorryRoute(
                from_node=node,
                gate_node=r.target_node,
                path=path,
                distance_m=round(r.distance_m),
                minutes=max(1, devsim._round_min(r.distance_m / pace)),
                status=r.status,
                sensitive=_sensitive(world, layout, line),
                warnings=res.warnings,
            )
        raise devsim.DevsimUnavailable("no mapped road from a major road to the site gate")

    return _cached("lorry_route", world, site, build)


# ---- C5: flood exposure and daily-life matrix ----------------------------------------------------
FLOOD_STAGES = ("stage_p1m", "stage_p2m", "stage_p3m", "stage_p4m", "stage_p5m")
MATRIX_PROFILES = ("default", "stroller", "wheelchair")
MATRIX_ORDER = ("park", "mall", "clinic", "school")


def cell_value(status: str, metres: float | None, pace: float) -> int | str:
    """A walk as the matrix shows it: minutes, "?" (partly_unverified), "gap" (no_data) or
    "blocked". An unchecked walk is never shown as blocked, nor a data gap as blocked."""
    if status == "blocked":
        return "blocked"
    if status == "no_data" or metres is None:
        return "gap"
    if status == "partly_unverified":
        return "?"
    return max(1, devsim._round_min(metres / pace))


def _road_walk(tw: World, lay):
    """The default walk from the tower entrance to the nearest major-road node (nearest first,
    straight line; the next one is tried when a node has no walk)."""
    for node in _major_road_nodes(tw, lay)[:MAX_ROAD_TRIES]:
        w = devsim._with_places(tw, [devsim._temp_place(ROAD_PLACE, "Main road", tw, node)])
        res = routing.plan_route(w, devsim.TOWER_PLACE, ROAD_PLACE, devsim.PROFILE)
        if res.routes:
            return node, res.routes[0]
    raise devsim.DevsimUnavailable("no walk from the tower to a major road")


def _evacuation(tw: World) -> DevsimEvacuation | None:
    rows = centres_reachability(tw, None, devsim.PROFILE, devsim.TOWER_PLACE)
    r = next((r for r in rows if r.reachable and r.distance_m is not None), None)
    if r is None:
        return None
    return DevsimEvacuation(
        centre_id=r.centre.id,
        name=r.centre.name,
        source=r.centre.source,
        m=round(r.distance_m),
        min=max(1, devsim._round_min(r.distance_m / _pace(tw))),
        status=r.route_status,
    )


def flood_exposure(world: World, site: DevelopmentSite, lay=None) -> FloodExposure:
    """AC-C5: the lowest of stage_p1m..stage_p5m at which the entrance's baseline walk to the
    nearest major road crosses a `likely_flooded` edge (None: not cut in any scenario the world
    has), and the nearest evacuation centre with its official_pps / osm_candidate label."""

    def build() -> FloodExposure:
        layout = lay or devsim._layout(world, site)
        tw = devsim.tower_world(world, site)
        node, route = _road_walk(tw, layout)
        edges = [s.edge_id for s in route.segments]
        have = {s.id for s in world.flood.scenarios}
        checked = [s for s in FLOOD_STAGES if s in have]
        cut, cut_edges = None, []
        for s in checked:
            classes = world.flood.edge_classes.get(s, {})
            hit = sorted({e for e in edges if classes.get(e) == "likely_flooded"})
            if hit:
                cut, cut_edges = s, hit
                break
        return FloodExposure(
            road_node=node,
            route_edges=edges,
            scenarios_checked=checked,
            cut_from_scenario=cut,
            cut_edges=cut_edges,
            evacuation=_evacuation(tw),
        )

    return _cached("flood_exposure", world, site, build)


def daily_life_matrix(world: World, site: DevelopmentSite) -> DailyLifeMatrix:
    """AC-C6: walk minutes from the tower entrance (plan_route) to Urban Park, Lakeside Mall, the
    nearest clinic and the nearest school, for the default, stroller and wheelchair profiles.

    The mall row routes to the mall itself (as the existing mall bubble does), not its car park."""

    def build() -> DailyLifeMatrix:
        tw = devsim.tower_world(world, site)
        by_kind = {t.kind: t for t in impact_targets(world, site)}
        rows = []
        with routing.eval_memo():
            for kind in MATRIX_ORDER:
                t = by_kind[kind]
                cells = []
                for prof in MATRIX_PROFILES:
                    res = routing.plan_route(tw, devsim.TOWER_PLACE, t.id, prof)
                    r = res.routes[0] if res.routes else None
                    status = r.status if r else res.status
                    value = cell_value(status, r.distance_m if r else None, _pace(tw, prof))
                    cells.append(
                        MatrixCell(
                            profile=prof,
                            status=status,
                            value=value,
                            m=round(r.distance_m) if r and isinstance(value, int) else None,
                        )
                    )
                rows.append(MatrixRow(target=t, cells=cells))
        return DailyLifeMatrix(profiles=list(MATRIX_PROFILES), rows=rows)

    return _cached("daily_life_matrix", world, site, build)
