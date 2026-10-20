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


def course_segments(
    world, road_names: list[str] | None, segment_ids: list[str] | None
) -> list[str]:
    """Segment ids of the named roads (exact name first, else one clear loose match) plus any
    given ids. Raises CourseError for an unknown, ambiguous or too long course."""
    out = [s for s in segment_ids or [] if s in world.edges]
    if unknown := [s for s in segment_ids or [] if s not in world.edges]:
        raise CourseError(f"Unknown segment ids: {', '.join(unknown[:5])}. Do not invent ids.")
    by_name: dict[str, list[str]] = {}
    for e in world.edges.values():
        if e.name:
            by_name.setdefault(e.name, []).append(e.id)
    for road in road_names or []:
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
        out += by_name[names[0]]
    out = list(dict.fromkeys(out))
    if not out:
        raise CourseError("Name the roads of the course (or pick them on the map).")
    if len(out) > MAX_SEGMENTS:
        raise CourseError(
            f"That course has {len(out)} mapped segments; one event can close at most "
            f"{MAX_SEGMENTS}. Ask for a shorter section, or pick the course on the map."
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
