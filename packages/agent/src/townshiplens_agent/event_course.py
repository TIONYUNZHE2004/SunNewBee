"""Event closures (T-025): staff name a course by its roads ("close Persiaran Garcinia for the
marathon, 7-11 am"); the engine wants segment ids and a time window. Both are resolved here,
deterministically, so the model never invents segment ids or dates."""

import re
from datetime import date, datetime

from townshiplens_spatial import place_search
from townshiplens_spatial.events import MAX_SEGMENTS
from townshiplens_spatial.models import site_tz

_TIME = re.compile(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", re.IGNORECASE)


class CourseError(ValueError):
    """A course or window the engine cannot run: the message is for the model to relay."""


_BETWEEN = re.compile(r"^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$", re.IGNORECASE)


def _road(by_name: dict[str, list[str]], road: str) -> str:
    """The one mapped road name `road` means: exact first, else one clear loose match."""
    key = place_search.normalise(road)
    names = [n for n in by_name if place_search.normalise(n) == key]
    if not names:
        names = [
            n
            for n in by_name
            if place_search.match(road, [n]) in (place_search.WORDS, place_search.TYPO)
        ]
    if not names:
        raise CourseError(f"No mapped road is called {road!r}. Ask for the road's name.")
    if len(names) > 1:
        shown = " or ".join(sorted(names)[:3])
        raise CourseError(f"Which road do you mean: {shown}? Ask the user; do not guess.")
    return names[0]


def _nodes(world, ids: list[str]) -> set[str]:
    return {n for i in ids for n in (world.edges[i].from_node, world.edges[i].to_node)}


def cross_streets(world, by_name: dict[str, list[str]], road: str) -> list[str]:
    """Other named roads that meet `road` at a mapped junction, most connected first."""
    on = _nodes(world, by_name[road])
    hits = {n: len(_nodes(world, ids) & on) for n, ids in by_name.items() if n != road}
    return sorted((n for n, k in hits.items() if k), key=lambda n: (-hits[n], n))


def _stretch(world, by_name, road: str, a: str, b: str) -> list[str]:
    """The segments of `road` on its mapped path from where it meets `a` to where it meets `b`
    (breadth-first along the road's own segments)."""
    seg = by_name[road]
    start = _nodes(world, seg) & _nodes(world, by_name[a])
    goal = _nodes(world, seg) & _nodes(world, by_name[b])
    if not start or not goal:
        missing = a if not start else b
        raise CourseError(f"{road} does not meet {missing} on the map. Ask for another section.")
    links: dict[str, list[tuple[str, str]]] = {}
    for i in seg:
        e = world.edges[i]
        links.setdefault(e.from_node, []).append((e.to_node, i))
        links.setdefault(e.to_node, []).append((e.from_node, i))
    came: dict[str, tuple[str, str] | None] = {n: None for n in start}
    queue = list(start)
    while queue:
        node = queue.pop(0)
        if node in goal:
            path = []
            while came[node] is not None:
                node, edge = came[node]
                path.append(edge)
            return path[::-1]
        for nxt, edge in links.get(node, []):
            if nxt not in came:
                came[nxt] = (node, edge)
                queue.append(nxt)
    raise CourseError(f"No mapped stretch of {road} runs from {a} to {b}. Ask for another section.")


def _longest_section(world, by_name, road: str, cross: list[str]) -> tuple[str, str] | None:
    """The pair of cross streets bounding the longest mapped stretch of `road` that one event
    can close (a suggestion that resolves, never a guess)."""
    best: tuple[int, str, str] | None = None
    for i, a in enumerate(cross):
        for b in cross[i + 1 :]:
            try:
                n = len(_stretch(world, by_name, road, a, b))
            except CourseError:
                continue
            if 0 < n <= MAX_SEGMENTS and (best is None or n > best[0]):
                best = (n, a, b)
    return best[1:] if best else None


def course_segments(
    world, road_names: list[str] | None, segment_ids: list[str] | None
) -> list[str]:
    """Segment ids of the named roads (exact name first, else one clear loose match), or of one
    stretch ("Persiaran Elmina between Jalan A and Jalan B"), plus any given ids. Raises
    CourseError for an unknown, ambiguous or too long course; a road too long for one event
    lists the roads that cross it, so staff can name a section."""
    out = [s for s in segment_ids or [] if s in world.edges]
    if unknown := [s for s in segment_ids or [] if s not in world.edges]:
        raise CourseError(f"Unknown segment ids: {', '.join(unknown[:5])}. Do not invent ids.")
    by_name: dict[str, list[str]] = {}
    for e in world.edges.values():
        if e.name:
            by_name.setdefault(e.name, []).append(e.id)
    whole: list[str] = []
    for road in road_names or []:
        if m := _BETWEEN.match(road.strip()):
            name, a, b = (_road(by_name, x) for x in m.groups())
            out += _stretch(world, by_name, name, a, b)
        else:
            whole.append(name := _road(by_name, road))
            out += by_name[name]
    out = list(dict.fromkeys(out))
    if not out:
        raise CourseError("Name the roads of the course (or pick them on the map).")
    if len(out) > MAX_SEGMENTS:
        hint = ""
        for name in whole:
            cross = cross_streets(world, by_name, name)[:6]
            if best := _longest_section(world, by_name, name, cross):
                hint += (
                    f" {name} meets {', '.join(cross)}: ask for a section, e.g. "
                    f"'{name} between {best[0]} and {best[1]}'."
                )
        raise CourseError(
            f"That course has {len(out)} mapped segments; one event can close at most "
            f"{MAX_SEGMENTS}.{hint or ' Ask for a shorter section, or pick the course on the map.'}"
        )
    return out


def _clock(value: str, meridiem: str | None) -> tuple[int, int]:
    m = _TIME.match(value.strip())
    if not m:
        raise CourseError(f"Give times as HH:MM, not {value!r}.")
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    half = (m.group(3) or meridiem or "").lower()
    if half == "pm" and hour < 12:
        hour += 12
    if half == "am" and hour == 12:
        hour = 0
    if not (0 <= hour < 24 and 0 <= minute < 60):
        raise CourseError(f"{value!r} is not a time of day.")
    return hour, minute


def event_window(start: str, end: str, day: str | None, tz: str | None) -> tuple[str, str]:
    """ISO start and end in the site's time zone. `day` is YYYY-MM-DD (default: today there);
    "7" / "07:00" / "7am" times; a bare start borrows the end's am/pm ("7-11 am")."""
    zone = site_tz(tz)
    try:
        on = date.fromisoformat(day) if day else datetime.now(zone).date()
    except ValueError as exc:
        raise CourseError(f"Give the day as YYYY-MM-DD, not {day!r}.") from exc
    end_half = (_TIME.match(end.strip()) or [None] * 4)[3]
    sh, sm = _clock(start, end_half)
    eh, em = _clock(end, None)
    starts = datetime(on.year, on.month, on.day, sh, sm, tzinfo=zone)
    ends = datetime(on.year, on.month, on.day, eh, em, tzinfo=zone)
    if ends <= starts:
        raise CourseError("The event must end after it starts.")
    return starts.isoformat(), ends.isoformat()
