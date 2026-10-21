"""Forty simulated residents for the Development Simulation (demo polish spec §6.1.6, AC-C7).

- 20 **tower** residents: the tower's synthetic households (`devsim.tower_population`, the same
  population `build_cast` uses), including Mei Ling, Mak Cik Zainab and Arjun.
- 20 **neighbours**: residents of the Elmina Day population (`population.synthesize`, its default
  size and seed) whose home is one of the hoarding summary's homes within 500 m of the tower,
  including Pak Cik Halim (the detour home) and Farid.

Each gets facts from the routing engine (the construction detour from `hoarding_impact`, walk
minutes to the park, mall, clinic and school for their own profile, "?" when partly unverified)
and three lines from the template library (`devsim_lines`), numbers filled only from those facts
and checked by `check_line` (the `spotlight.check_text` rules). Labelled "Simulated reactions".
"""

from __future__ import annotations

import colorsys
import dataclasses
import hashlib
import re
from collections.abc import Callable

from . import devsim
from . import devsim_impact as di
from . import devsim_lines as L
from .day import population
from .day import spotlight as spot
from .day.population import Resident
from .day.schedule import PRIMARY_AGE
from .devsim_models import (
    DevelopmentSite,
    HoardingImpact,
    ImpactTarget,
    ResidentFacts,
    ResidentLines,
    ResidentWalk,
    SimResident,
    SimResidents,
)
from .world import World

N_TOWER = 20
N_NEIGHBOUR = 20
MAX_LINE = 220
TOWER_CAST = ("meiling", "zainab", "arjun")
NEIGHBOUR_CAST = ("halim", "farid")
CAST_GROUP = {
    "halim": "older",
    "farid": "commuter",
    "meiling": "parent",
    "zainab": "older",
    "arjun": "commuter",
}
# How copy names a target: the mall by its arrival label (ruling R18), the clinic by its name.
SHORT = {"park": "Urban Park", "school": "the school"}
WALK_ORDER = ("park", "mall", "clinic", "school")
MAX_PER_BUILDING = 2  # neighbours per home building, the cast included
CAST_GIVEN_NAMES = ("Halim", "Farid", "Mei Ling", "Zainab", "Arjun")  # never reused
DIGITS = re.compile(r"\d+(?:[.,]\d+)?")


class DevsimResidentsError(ValueError):
    """A resident line failed its check: a bug in the templates, never shown."""


def _h(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


# ---- facts -------------------------------------------------------------------------------------
def own_profile(r: Resident | None) -> str:
    """wheelchair if a wheelchair user, stroller with a toddler, else default."""
    if r is not None and r.wheelchair:
        return "wheelchair"
    if r is not None and r.toddler:
        return "stroller"
    return "default"


def _walk_value(trees, comps, pid_nodes, node: str, pace: float) -> int | str:
    strict, lenient = trees
    if node in strict:
        return max(1, devsim._round_min(strict[node] / pace))
    if node in lenient:
        return "?"
    if not {comps.get(n) for n in pid_nodes} & {comps.get(node)}:
        return "gap"
    return "blocked"


class _HomeWalks:
    """Walk values from homes to the four targets per profile (one search per target and pass,
    as `devsim_impact.walk_tree`), computed on first use."""

    def __init__(self, world: World, targets: list[ImpactTarget], nodes: set[str]):
        order = {k: i for i, k in enumerate(WALK_ORDER)}
        self.targets = sorted(targets, key=lambda t: order[t.kind])
        self.world, self.nodes = world, nodes
        self.cache: dict[tuple[str, str], tuple[dict, dict]] = {}
        self.comps = devsim.routing._components(world)

    def _trees(self, pid: str, profile: str):
        key = (pid, profile)
        if key not in self.cache:
            src = devsim.routing._targets(self.world, pid)
            self.cache[key] = (
                di.walk_tree(self.world, profile, src, False, self.nodes),
                di.walk_tree(self.world, profile, src, True, self.nodes),
            )
        return self.cache[key]

    def __call__(self, node: str, profile: str) -> list[ResidentWalk]:
        out = []
        for t in self.targets:
            # The arrival with the shorter plan_route walk (strict, else lenient); ruling R18.
            found = []
            for pid in di._arrivals(t):
                strict, lenient = self._trees(pid, profile)
                m = strict.get(node, lenient.get(node))
                if m is not None:
                    found.append((m, pid))
            pid = min(found)[1] if found else t.id
            src = devsim.routing._targets(self.world, pid)
            v = _walk_value(
                self._trees(pid, profile), self.comps, src, node, di._pace(self.world, profile)
            )
            out.append(
                ResidentWalk(
                    kind=t.kind,
                    name=t.name,
                    value=v,
                    arrival_id=pid,
                    label=di.arrival_label(self.world, t, pid),
                )
            )
        return out


def _matrix_walks(world: World, site: DevelopmentSite, profile: str) -> list[ResidentWalk]:
    m = di.daily_life_matrix(world, site)
    i = m.profiles.index(profile)
    by_kind = {r.target.kind: r for r in m.rows}
    return [
        ResidentWalk(
            kind=k,
            name=by_kind[k].target.name,
            value=by_kind[k].cells[i].value,
            arrival_id=by_kind[k].cells[i].arrival_id,
            label=by_kind[k].cells[i].label,
        )
        for k in WALK_ORDER
    ]


def fact_numbers(f: ResidentFacts) -> set[int]:
    nums = {w.value for w in f.walks if isinstance(w.value, int)}
    if f.extra_walk_min is not None:
        nums.add(f.extra_walk_min)
    return nums


def check_line(text: str, f: ResidentFacts) -> list[str]:
    """Reasons a line may not be shown (empty = fine): `spotlight.check_text`'s banned wording
    and number words, the devsim banned words, digits not in this resident's facts, length."""
    errs = []
    if len(text) > MAX_LINE:
        errs.append(f"longer than {MAX_LINE} characters")
    # Place names are data, not numbers or words of theirs (e.g. "Seven Skies Islamic School").
    names = sorted(
        {w.name for w in f.walks} | {w.label for w in f.walks} | {f.extra_walk_to or ""},
        key=len,
        reverse=True,
    )
    for n in names:
        if n:
            text = re.sub(re.escape(n), " ", text, flags=re.IGNORECASE)
    for rx in (spot.BANNED, devsim.BANNED):
        if m := rx.search(text):
            errs.append(f"banned wording {m.group(0)!r}")
    if m := spot.NUMBER_WORDS.search(text):
        errs.append(f"number in words {m.group(0)!r}")
    allowed = fact_numbers(f)
    for m in DIGITS.finditer(text):
        tok = m.group(0)
        if not tok.isdigit() or int(tok) not in allowed:
            errs.append(f"number {tok} is not in this resident's facts")
    return errs


# ---- lines -------------------------------------------------------------------------------------
def _place(w: ResidentWalk) -> str:
    return w.label if w.kind == "mall" else SHORT.get(w.kind, w.name)


def copy_name(kind: str, name: str, label: str) -> str:
    return label if kind == "mall" else SHORT.get(kind, name)


def _lines(rid: str, side: str, group: str, f: ResidentFacts, seed: int, k: int) -> ResidentLines:
    def pick(options: list[str], *salt) -> str:
        return options[_h(seed, rid, k, *salt) % len(options)]

    # Construction
    if side == "neighbour" and (f.extra_walk_min or 0) >= devsim.MIN_DETOUR_MIN:
        opener = pick(L.OPENERS[(side, "construction", "detour")], "c").format(
            extra=f.extra_walk_min, to=_to(f)
        )
    else:
        tone = ("pos", "neg")[_h(seed, rid, "ct") % 2]
        opener = pick(L.OPENERS[(side, "construction", tone)], "c")
    construction = f"{opener} {pick(L.TAILS[(group, 'construction')], 'ct')}"
    # Handover
    tone = ("pos", "neg")[_h(seed, rid, "ht") % 3 == 0]  # mostly pleased
    handover = f"{pick(L.OPENERS[(side, 'handover', tone)], 'h')} "
    handover += pick(L.TAILS[(group, "handover", side)], "ht")
    # Daily life
    topics = L.TOPICS[group]
    kind = topics[_h(seed, rid, "topic") % len(topics)]
    w = next(x for x in f.walks if x.kind == kind)
    if isinstance(w.value, int):
        tone = "pos" if w.value <= L.POS_MAX_MIN else "neg"
        why = pick(L.WHY[(group, tone)], "why")
        daily = pick(L.DAILY[tone], "d").format(place=_place(w), n=w.value, why=why)
    else:
        daily = pick(L.DAILY[w.value], "d").format(place=_place(w), who=L.WHO[f.profile])
    return ResidentLines(
        construction=_cap(construction), handover=_cap(handover), daily_life=_cap(daily)
    )


def _cap(s: str) -> str:
    return s[0].upper() + s[1:]


def _to(f: ResidentFacts) -> str:
    return f.extra_walk_to or di.MALL_LABEL


# ---- selection -------------------------------------------------------------------------------
def _quotas(school: dict[str, int]) -> list[tuple[Callable[[Resident], bool], int]]:
    return [
        (lambda r: r.wheelchair, 2),
        (lambda r: r.toddler, 3),
        (lambda r: r.group == "older", 3),
        (lambda r: r.group == "adult" and not r.commuter and school.get(r.household), 3),
        (lambda r: r.commuter, 3),
        (lambda r: r.group == "teen", 2),
        (lambda r: not r.car and r.group in ("adult", "older"), 1),
    ]


def _select(
    rs: list[Resident],
    n: int,
    school: dict[str, int],
    skip: set[str],
    building: dict[str, str] | None = None,
    cap: int | None = None,
    spread: dict[str, int] | None = None,
    taken: dict[str, int] | None = None,
) -> list[Resident]:
    """A varied, deterministic pick (`spotlight.choose` style): quotas first, one per household
    while that is possible, then anyone left (adults, older residents, teenagers).

    With `building` (resident id -> home building), no building gets more than `cap` residents
    (`taken` counts those already placed, e.g. the cast), and the fill prefers the building with
    the fewest picks so far, then `spread` order (near and far buildings interleaved)."""
    order = [
        r
        for r in sorted(rs, key=lambda r: spot._h(r.id))
        if r.id not in skip and r.group != "child"
    ]
    per: dict[str, int] = dict(taken or {})
    picked: list[Resident] = []
    seen: set[str] = set()

    def ok(r: Resident, unique: bool) -> bool:
        if r in picked or (unique and r.household in seen):
            return False
        return not (building and cap is not None and per.get(building[r.id], 0) >= cap)

    def take(r: Resident) -> None:
        picked.append(r)
        seen.add(r.household)
        if building:
            per[building[r.id]] = per.get(building[r.id], 0) + 1

    for pred, k in _quotas(school):
        for r in order:
            if sum(1 for x in picked if pred(x)) >= k or len(picked) >= n:
                break
            if pred(r) and ok(r, True):
                take(r)
    for unique in (True, False):
        while len(picked) < n:
            cands = [r for r in order if ok(r, unique)]
            if not cands:
                break
            if building:
                b = building
                cands.sort(key=lambda r: (per.get(b[r.id], 0), (spread or {}).get(b[r.id], 0)))
            take(cands[0])
    return picked


def interleave(items: list[str]) -> dict[str, int]:
    """Rank items nearest, farthest, second nearest, second farthest, ... (for spreading)."""
    out, lo, hi = [], 0, len(items) - 1
    while lo <= hi:
        out.append(items[lo])
        if hi != lo:
            out.append(items[hi])
        lo, hi = lo + 1, hi - 1
    return {x: i for i, x in enumerate(out)}


def _group(r: Resident, kids: dict[str, int]) -> str:
    if r.wheelchair:
        return "wheelchair"
    if r.toddler or (r.group == "adult" and kids.get(r.household)):
        return "parent"
    if r.group == "older":
        return "older"
    if r.commuter:
        return "commuter"
    return "general"


def _tags(r: Resident | None, kids: dict[str, int], cast: bool) -> list[str]:
    tags = ["cast"] if cast else []
    if r is None:
        return tags
    for tag, on in (
        ("wheelchair", r.wheelchair),
        ("oku", r.oku),
        ("toddler", r.toddler),
        ("children", bool(kids.get(r.household))),
        ("commuter", r.commuter),
        ("older", r.group == "older"),
        ("teen", r.group == "teen"),
    ):
        if on:
            tags.append(tag)
    return tags


def _name(r: Resident, used: set[str]) -> str:
    """`spotlight.choose`'s naming: a common Malaysian given name, unique in this cast."""
    x = spot._h(r.id + "name")
    pool = "malay" if r.muslim else ("chinese" if x % 5 < 3 else "indian")
    names = spot.NAMES[f"{pool}_{r.sex}"]
    start = (x // 7) % len(names)
    name = next(
        (
            names[(start + i) % len(names)]
            for i in range(len(names))
            if names[(start + i) % len(names)] not in used
        ),
        None,
    )
    if name is None:
        i = 0
        while f"{names[start]} {chr(65 + i % 26)}." in used:
            i += 1
        name = f"{names[start]} {chr(65 + i % 26)}."
    used.add(name)
    if r.group == "older" and pool == "malay":
        name = f"{spot.TITLE['older_' + r.sex]} {name}"
    return name


def _colour(i: int, taken: set[str]) -> str:
    k = i
    while True:
        h = (k * 0.618034) % 1.0
        r, g, b = colorsys.hls_to_rgb(h, 0.55, 0.55)
        c = f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
        k += 1
        if c not in taken:
            taken.add(c)
            return c


def _ring_mean(f: dict) -> tuple[float, float]:
    """A building's home coordinate as the population generator records it."""
    ring = f["geometry"]["coordinates"][0]
    if f["geometry"]["type"] == "MultiPolygon":
        ring = ring[0]
    xs, ys = [c[0] for c in ring], [c[1] for c in ring]
    return (round(sum(xs) / len(xs), 6), round(sum(ys) / len(ys), 6))


DAY_SEED = 11  # population.synthesize's default: the Elmina Day population
MAX_POOL_RUNS = 8


def neighbour_pool(
    world: World, impact: HoardingImpact, need: int = 0, cap: int = MAX_PER_BUILDING
) -> dict[str, list[Resident]]:
    """Synthetic residents by home building, for the impact's homes: the Elmina Day population
    (`population.synthesize(world)`, seed 11) first. When fewer than `need` could be picked with
    at most `cap` per building, further runs of the same generator (seeds 12, 13, ...; ids and
    households prefixed "s<seed>-") add residents until enough buildings are covered."""
    ids = {h.home_id for h in impact.homes}
    by_coord = {
        _ring_mean(f): f["properties"]["id"]
        for f in devsim._features(world, "buildings.geojson")
        if f["properties"].get("id") in ids
    }
    out: dict[str, list[Resident]] = {}
    for run in range(MAX_POOL_RUNS):
        seed = DAY_SEED + run
        for r in population.synthesize(world, seed=seed).residents:
            if (hid := by_coord.get((r.home_coord[0], r.home_coord[1]))) is None:
                continue
            if run:
                r = dataclasses.replace(r, id=f"s{seed}-{r.id}", household=f"s{seed}-{r.household}")
            out.setdefault(hid, []).append(r)
        room = sum(min(cap, sum(1 for r in rs if r.group != "child")) for rs in out.values())
        if room >= need:
            break
    return out


# ---- build ---------------------------------------------------------------------------------------
def build_residents(
    world: World,
    site: DevelopmentSite,
    seed: int = devsim.CAST_SEED,
    lay=None,
    detour_home: str | None = None,
) -> SimResidents:
    """AC-C7: 20 tower and 20 neighbour residents with facts and three checked lines.

    `detour_home` is Halim's home (the plan's `facts.detour.home_id`); without it, the home with
    the longest construction detour is used. Deterministic for a world, site and seed."""

    def build() -> SimResidents:
        layout = lay or devsim._layout(world, site)
        impact = di.hoarding_impact(world, site, layout)
        targets = di.impact_targets(world, site)
        home_node = dict(di.impact_homes(world, site, layout))
        rows = {h.home_id: h for h in impact.homes}
        by_id = {t.id: t for t in targets}

        # Tower: the cast population.
        tpop, tkids, tschool = devsim.tower_population(world, site, seed)
        picks = devsim.cast_residents(tpop.residents, tschool)
        _, cast = devsim.build_cast(world, site, seed)
        cast_by = {c.id: c for c in cast}
        skip = {r.id for r in picks.values() if r is not None}
        tower = _select(tpop.residents, N_TOWER - len(TOWER_CAST), tschool, skip)

        # Neighbours: Elmina Day residents living in the impact's homes.
        # Room for the 18 plus the two cast homes (each may hold one more resident).
        pool = neighbour_pool(world, impact, N_NEIGHBOUR)
        nres = [r for hid in sorted(pool) for r in pool[hid]]
        nkids: dict[str, int] = {}
        nschool: dict[str, int] = {}
        for r in nres:
            if r.group == "child":
                nkids[r.household] = nkids.get(r.household, 0) + 1
                if PRIMARY_AGE[0] <= r.age <= PRIMARY_AGE[1]:
                    nschool[r.household] = nschool.get(r.household, 0) + 1
        home_of = {r.id: hid for hid, rs in pool.items() for r in rs}
        order = [h.home_id for h in impact.homes]  # nearest first
        if detour_home is not None and detour_home not in rows:
            raise ValueError(f"detour home {detour_home} is not a home within 500 m of the tower")
        halim_home = detour_home or max(order, key=lambda h: (rows[h].extra_min, -order.index(h)))
        farid_home = next(h for h in order if h != halim_home)
        cast_homes = {halim_home: 1, farid_home: 1}
        neighbours = _select(
            nres,
            N_NEIGHBOUR - len(NEIGHBOUR_CAST),
            nschool,
            set(),
            building=home_of,
            cap=MAX_PER_BUILDING,
            spread=interleave([h for h in order if h in pool]),
            taken=cast_homes,
        )
        if len(neighbours) < N_NEIGHBOUR - len(NEIGHBOUR_CAST):
            raise devsim.DevsimUnavailable("too few residents live near the site")
        walks = _HomeWalks(
            world,
            targets,
            {home_node[h] for h in (halim_home, farid_home)}
            | {home_node[home_of[r.id]] for r in neighbours},
        )

        def neighbour_facts(hid: str, profile: str) -> ResidentFacts:
            row = rows[hid]
            t = by_id.get(row.extra_target)
            label = di.arrival_label(world, t, row.extra_arrival) if t else None
            return ResidentFacts(
                profile=profile,
                home_id=hid,
                extra_walk_min=row.extra_min,
                extra_walk_to=copy_name(t.kind, t.name, label) if t else None,
                extra_walk_arrival=row.extra_arrival,
                walks=walks(home_node[hid], profile),
            )

        def tower_facts(profile: str) -> ResidentFacts:
            return ResidentFacts(
                profile=profile, home_id=None, walks=_matrix_walks(world, site, profile)
            )

        used = set(CAST_GIVEN_NAMES)
        taken = set(devsim.COLOURS.values())
        people: list[dict] = []
        for cid in TOWER_CAST:
            r = picks[cid]
            people.append(
                dict(id=cid, r=r, side="tower", group=CAST_GROUP[cid], cast=True, kids=tkids)
            )
        for r in tower:
            people.append(
                dict(
                    id=f"t-{r.id}",
                    r=r,
                    side="tower",
                    group=_group(r, tkids),
                    cast=False,
                    kids=tkids,
                    school=tschool,
                )
            )
        for cid, hid in (("halim", halim_home), ("farid", farid_home)):
            people.append(
                dict(
                    id=cid,
                    r=None,
                    side="neighbour",
                    group=CAST_GROUP[cid],
                    cast=True,
                    kids={},
                    home=hid,
                )
            )
        for r in neighbours:
            people.append(
                dict(
                    id=f"n-{r.id}",
                    r=r,
                    side="neighbour",
                    group=_group(r, nkids),
                    cast=False,
                    kids=nkids,
                    school=nschool,
                    home=home_of[r.id],
                )
            )

        out: list[SimResident] = []
        triples: set[tuple[str, str, str]] = set()
        for i, p in enumerate(people):
            r = p["r"]
            profile = own_profile(r)
            f = (
                tower_facts(profile)
                if p["side"] == "tower"
                else neighbour_facts(p["home"], profile)
            )
            for k in range(64):
                lines = _lines(p["id"], p["side"], p["group"], f, seed, k)
                trip = (lines.construction, lines.handover, lines.daily_life)
                if trip not in triples:
                    break
            else:
                raise DevsimResidentsError(f"{p['id']}: no unique set of lines")
            triples.add(trip)
            for phase, text in lines.model_dump().items():
                if errs := check_line(text, f):
                    raise DevsimResidentsError(f"{p['id']} {phase}: {'; '.join(errs)}: {text!r}")
            if p["cast"]:
                c = cast_by[p["id"]]
                name, role, colour = c.name, c.role, c.colour
            else:
                name = _name(r, used)
                role = spot._role(r, p["kids"].get(r.household, 0), p["school"].get(r.household, 0))
                colour = _colour(i, taken)
            out.append(
                SimResident(
                    id=p["id"],
                    name=name,
                    role=role,
                    side=p["side"],
                    group=p["group"],
                    colour=colour,
                    age=r.age if r is not None else None,
                    tags=_tags(r, p["kids"], p["cast"]),
                    facts=f,
                    lines=lines,
                )
            )
        return SimResidents(residents=out, seed=seed)

    return di._cached(f"residents:{seed}:{detour_home}", world, site, build)
