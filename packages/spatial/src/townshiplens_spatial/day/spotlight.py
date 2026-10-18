"""Spotlight residents: the voices of Elmina Day (Cycle 11).

About 40 synthetic residents get a name, a persona and a voice: they choose at decision moments
(among options the engine offers), keep a diary, post to a simulated community feed and can be
interviewed. The *language* may come from an LLM (townshiplens_agent.day_voice); the *facts*
never do. Every diary line, post or answer is checked by `check_text` against that resident's
own trips: any time or number not in their facts, "safe", a water depth, or a forecast is
rejected, and the line falls back to a template written from the facts.

This module is deterministic and needs no LLM (tests, keyless runs, fallbacks).
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass, field

from .population import Population, Resident

N_SPOTLIGHT = 40

# Synthetic names (common Malaysian given names), assigned deterministically. Not real people.
NAMES = {
    "malay_f": [
        "Rohani",
        "Aishah",
        "Siti Nur",
        "Faridah",
        "Zainab",
        "Nurul",
        "Hasnah",
        "Salmah",
        "Aminah",
        "Rosnah",
        "Haslinda",
        "Normah",
    ],
    "malay_m": [
        "Ahmad",
        "Rosli",
        "Hafiz",
        "Zulkifli",
        "Azman",
        "Ismail",
        "Faizal",
        "Kamal",
        "Shahrul",
        "Yusof",
        "Rahim",
        "Hakim",
    ],
    "chinese_f": ["Mei Ling", "Siew Lan", "Pei Shan", "Ai Ling", "Hui Min"],
    "chinese_m": ["Wei Jie", "Kok Leong", "Chee Keong", "Jun Hao", "Boon Kiat"],
    "indian_f": ["Kavitha", "Priya", "Meena", "Lakshmi"],
    "indian_m": ["Rajesh", "Suresh", "Arjun", "Ganesh"],
}
TITLE = {"older_f": "Mak Cik", "older_m": "Pak Cik"}


@dataclass
class Spotlight:
    id: str  # resident id
    name: str
    age: int
    role: str
    persona: str
    group: str
    household: str
    home_coord: list[float]
    voice: str = ""  # one line on how they speak (from the LLM persona step, or a template)
    tags: list[str] = field(default_factory=list)


def _h(s: str) -> int:
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16)


def _role(r: Resident, kids: int, school_kids: int = 0) -> str:
    if r.wheelchair:
        return "wheelchair user"
    if r.toddler:
        return "parent with a toddler in a stroller"
    if r.group == "teen":
        return "secondary school student"
    if r.group == "older":
        return "retiree" + (" who needs to rest often" if r.persona == "older_adult_rest" else "")
    if r.commuter:
        return "commuter" + (" and parent" if kids else "")
    if school_kids:
        return "parent doing the school run"
    if kids:
        return "parent at home with a young child"
    return "resident working from home"


def choose(pop: Population, n: int = N_SPOTLIGHT) -> list[Spotlight]:
    """A deterministic, varied cast: every wheelchair user (up to 3), parents with strollers,
    older residents, school-run parents, commuters, teenagers, households without a car."""
    rs = pop.residents
    from .schedule import PRIMARY_AGE

    kids_of: dict[str, int] = {}
    school_of: dict[str, int] = {}  # children aged 7-12: the ones on a school run (review C21)
    for r in rs:
        if r.group == "child":
            kids_of[r.household] = kids_of.get(r.household, 0) + 1
            if PRIMARY_AGE[0] <= r.age <= PRIMARY_AGE[1]:
                school_of[r.household] = school_of.get(r.household, 0) + 1
    order = sorted(rs, key=lambda r: _h(r.id))
    quotas = [
        (lambda r: r.wheelchair, 3),
        (lambda r: r.toddler, 6),
        (lambda r: r.persona == "older_adult_rest", 5),
        (lambda r: r.group == "older" and r.muslim, 4),
        (lambda r: r.group == "adult" and not r.commuter and school_of.get(r.household), 6),
        (lambda r: r.commuter, 5),
        (lambda r: r.group == "teen", 4),
        (lambda r: not r.car and r.group in ("adult", "older"), 4),
    ]
    picked: list[Resident] = []
    seen_hh: set[str] = set()
    for pred, k in quotas:
        for r in order:
            if len([x for x in picked if pred(x)]) >= k or len(picked) >= n:
                break
            if pred(r) and r.household not in seen_hh and r.group != "child":
                picked.append(r)
                seen_hh.add(r.household)
    for r in order:
        if len(picked) >= n:
            break
        if r.household not in seen_hh and r.group in ("adult", "older", "teen"):
            picked.append(r)
            seen_hh.add(r.household)
    out = []
    used: set[str] = set()
    for r in picked:
        x = _h(r.id + "name")
        sex = r.sex
        pool = "malay" if r.muslim else ("chinese" if x % 5 < 3 else "indian")
        names = NAMES[f"{pool}_{sex}"]
        start = (x // 7) % len(names)
        name = next(
            (
                names[(start + i) % len(names)]
                for i in range(len(names))
                if names[(start + i) % len(names)] not in used
            ),
            f"{names[start]} {chr(65 + len(used) % 26)}.",
        )
        used.add(name)
        if r.group == "older" and pool == "malay":
            name = f"{TITLE['older_' + sex]} {name}"
        out.append(
            Spotlight(
                id=r.id,
                name=name,
                age=r.age,
                role=_role(r, kids_of.get(r.household, 0), school_of.get(r.household, 0)),
                persona=r.persona,
                group=r.group,
                household=r.household,
                home_coord=r.home_coord,
                voice=f"Speaks plainly about their own day as a {_role(r, 0)}.",
            )
        )
    return out


# ---- facts --------------------------------------------------------------------------------
def hhmm(t: float | None) -> str | None:
    if t is None:
        return None
    m = int(round(t))
    return f"{m // 60:02d}:{m % 60:02d}"


def facts(sp: Spotlight, trips: list[dict], decisions: list[dict]) -> dict:
    """What this resident's day was, in plain fields: the only facts their voice may use."""
    return {
        "name": sp.name,
        "age": sp.age,
        "role": sp.role,
        "trips": [
            {
                "id": t["id"],
                "to": "home" if t["direction"] == "back" else t["to"],
                "place": None if t["direction"] == "back" else clean_name(t["place"]),
                "from": (
                    ("work" if t["to"] == "work" else clean_name(t["place"]))
                    if t["direction"] == "back"
                    else None
                ),
                "direction": t["direction"],
                "mode": t["mode"],
                "planned": hhmm(t["planned"]),
                # a trip given up before setting off never "left"
                "left": None if t["status"] in ("cancelled", "data_gap") else hhmm(t["depart"]),
                "arrived": hhmm(t["arrive"]),
                "ended": hhmm(t["ended"]),
                "status": t["status"],
                "late_by_min": int(round(t["delay_min"])) if t["delay_min"] else 0,
                "waited_min": int(round(t["waited_min"])),
                "rerouted": t["rerouted"],
                "children_with_them": t["companions"],
                "unchecked_stretches": t["unchecked_stretches"],
                "what_happened": story(t),
            }
            for t in trips
        ],
        "decisions": [
            {
                "at": hhmm(d["t"]),
                "situation": d["kind"],
                "options": [o["label"] for o in d["options"]],
                "chose": next(
                    (o["label"] for o in d["options"] if o["id"] == d["chosen"]), d["chosen"]
                ),
            }
            for d in decisions
        ],
    }


def story(t: dict) -> str:
    """One plain sentence, written by the engine, of what happened on this trip."""
    how = {"drive": "drive", "lift": "get a lift"}.get(t["mode"], "walk")
    back = t["direction"] == "back"
    where = (
        "home" if back else ("work" if t["to"] == "work" else (clean_name(t["place"]) or t["to"]))
    )
    kids = t["companions"]
    with_kids = "" if not kids else (" with my child" if kids == 1 else f" with my {kids} children")
    plan, left, arr, end = (
        hhmm(t["planned"]),
        hhmm(t["depart"]),
        hhmm(t["arrive"]),
        hhmm(t["ended"]),
    )
    st = t["status"]
    if st == "on_time":
        extra = " The way was cut, so I took another route." if t["rerouted"] else ""
        return f"Set off to {how} to {where}{with_kids} at {left} and got there at {arr}.{extra}"
    if st == "late":
        if t["waited_min"]:
            return (
                f"Set off to {how} to {where}{with_kids} at {left}; the water cut the way, "
                f"I waited {int(round(t['waited_min']))} minutes and got there at {arr}."
            )
        return (
            f"Planned to {how} to {where}{with_kids} at {plan}; got there at {arr}, "
            f"{int(round(t['delay_min'] or 0))} minutes later than planned."
        )
    if st == "cancelled":
        if t["waited_min"]:
            return (
                f"Planned to {how} to {where}{with_kids} at {plan}; there was no way "
                f"through, I waited at home until {end}, then gave up."
            )
        return f"Planned to {how} to {where}{with_kids} at {plan}; no way through, so I stayed."
    if st == "turned_back":
        return (
            f"Set off to {how} to {where}{with_kids} at {left}; the water cut the way, so I "
            f"turned back and was home at {arr}."
        )
    if st == "stranded":
        return (
            f"Set off to {how} to {where}{with_kids} at {left}; the water cut the way and I "
            "was still stuck when the day ended."
        )
    return f"Planned to {how} to {where} at {plan}; the map shows no way there (a data gap)."


def facts_for(res, day, cast: list[Spotlight]) -> dict[str, dict]:
    """Facts for every spotlight resident from a finished day (trips and their decisions)."""
    from dataclasses import asdict

    from .summary import trip_json

    by_res = res.by_resident()
    pts: dict[str, list[dict]] = {}
    for p in day.points:
        pts.setdefault(p.resident, []).append(asdict(p))
    return {
        c.id: facts(c, [trip_json(t, day.world) for t in by_res.get(c.id, [])], pts.get(c.id, []))
        for c in cast
    }


# ---- checking any text a voice writes -------------------------------------------------------
TIME = re.compile(r"\b(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?(?![\w])", re.IGNORECASE)
NUM = re.compile(r"(?<![\d:.])\d+(?![\d:.]\d)")
NUMBER_WORDS = re.compile(
    r"\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|"
    r"fifty|sixty|hundred|dozen|half an hour|dua|tiga|empat|lima)\b",
    re.IGNORECASE,
)
BANNED = re.compile(
    r"(?<![\w-])(?:un)?safe(?:ly|ty)?(?![\w-])|\bselamat\b|\baman\b|安全|\bdeep\b|\bdepth\b"
    r"|knee|waist|ankle|\b\d+(?:\.\d+)?\s?(?:m|cm|metres?|meters?|feet|ft|inch(?:es)?)\b"
    r"|\b(?:metres?|meters?|centimet(?:re|er)s?|feet|inches) of water\b"
    r"|\b(?:will|'ll|going to|gonna) (?:flood|be flooded|rain|get worse|happen again)\b"
    r"|\bforecast\b(?<!not a forecast)|\btomorrow\b|\bnext (?:week|time|year)\b"
    r"|\bbanjir akan\b|\bverified\b|\bguarantee",
    re.IGNORECASE,
)


def allowed_numbers(f: dict, trip: str | None = None) -> tuple[set[str], set[int]]:
    """Times and numbers a line may use: those of one trip (when the line is about a trip),
    else the whole day's. The resident's age is never a licence for another number."""
    times: set[str] = set()
    nums: set[int] = set()
    for t in f["trips"]:
        if trip is not None and t["id"] != trip:
            continue
        for k in ("planned", "left", "arrived", "ended"):
            if t.get(k):
                times.add(t[k])
        nums |= {t["late_by_min"], t["waited_min"], t["children_with_them"]}
    if trip is None:
        for d in f["decisions"]:
            if d["at"]:
                times.add(d["at"])
    return times, nums


def _hhmm_token(m: re.Match) -> str:
    h, mm, ap = int(m.group(1)), m.group(2), (m.group(3) or "").lower()
    if ap.startswith("p") and h < 12:
        h += 12
    if ap.startswith("a") and h == 12:
        h = 0
    return f"{h:02d}:{mm}"


def check_text(text: str, f: dict, trip: str | None = None) -> list[str]:
    """Reasons this text may not be shown as this resident's words (empty list = fine)."""
    errs = []
    if m := BANNED.search(text):
        errs.append(f"banned wording: {m.group(0)!r}")
    if m := NUMBER_WORDS.search(text):
        errs.append(f"numbers in words: {m.group(0)!r}")
    times, nums = allowed_numbers(f, trip)
    # The resident's own place names may hold digits ("Dewan Serbaguna U16/1"): not numbers.
    names = sorted(
        {n for t in f["trips"] for n in (t.get("place"), t.get("from")) if n},
        key=len,
        reverse=True,
    )
    for n in names:
        text = re.sub(re.escape(n), " ", text, flags=re.IGNORECASE)
    for m in TIME.finditer(text):
        tok = _hhmm_token(m)
        if tok not in times:
            errs.append(f"time {tok} is not in this day")
    stripped = TIME.sub(" ", text)
    if m := re.search(r"\b\d+\.\d\b", stripped):
        errs.append(f"number {m.group(0)} is not in this day")
    for m in NUM.finditer(stripped):
        if int(m.group(0)) not in nums and int(m.group(0)) != 1:
            errs.append(f"number {m.group(0)} is not in this day")
    if len(text) > 400:
        errs.append("too long")
    return errs


SAFE_NAME = re.compile(r"[^\w\s()'.,&/-]", re.UNICODE)


def clean_name(name: str | None) -> str | None:
    """A place name as it may reach a prompt: letters, digits and simple punctuation only, at
    most 60 characters (an OSM name is data, never an instruction)."""
    if not name:
        return name
    return SAFE_NAME.sub("", name)[:60].strip()


# ---- template voice (no LLM) -----------------------------------------------------------------
def template_diary(f: dict) -> list[dict]:
    """The engine's own sentence for each trip out (the voice when there is no AI)."""
    return [
        {"trip": t["id"], "status": t["status"], "text": f"{t['planned']}: {t['what_happened']}"}
        for t in f["trips"]
        if t["direction"] == "out"
    ][:5]


def template_post(f: dict, trip: dict) -> str | None:
    where = "work" if trip["to"] == "work" else (trip["place"] or trip["to"])
    if trip["status"] == "late":
        stuck = " Anyone else stuck?" if trip["waited_min"] else ""
        return f"Got to {where} {trip['late_by_min']} minutes later than planned today.{stuck}"
    if trip["status"] in ("cancelled", "turned_back"):
        return f"Couldn't get to {where} today, no way through from our side."
    if trip["status"] == "stranded":
        return f"Stuck on the way to {where}. Is anyone near?"
    if trip["to"] == "the event" and trip["status"] == "on_time":
        return f"Lovely evening at {where}, so many neighbours there."
    return None


def notices(scenario, world) -> list[dict]:
    """Township notices for the feed, written by the engine from the scenario (river changes,
    the event): what residents react to. Labelled as notices, never as a resident."""
    out = []
    labels = {s.id: s.stage_m for s in world.flood.scenarios}
    for m, sid in scenario.stages:
        if m <= 0:
            continue
        text = (
            f"River at +{labels.get(sid, 0):g} m in this rehearsal (indicative scenario, not a "
            "forecast). Follow official MBSA / JPS / NADMA guidance."
            if sid
            else "River back to its normal level in this rehearsal."
        )
        out.append({"t": m, "text": text})
    ev = scenario.event
    if ev and ev.get("place_id") in world.places:
        out.append(
            {
                "t": ev["start"],
                "text": f"{ev.get('label', 'Event').capitalize()} starts "
                f"at {world.places[ev['place_id']].name}.",
            }
        )
    out.sort(key=lambda x: x["t"])
    return [
        {
            "id": f"n{i + 1:02d}",
            "author": "township",
            "name": "Township model",
            "role": "notice",
            "t": x["t"],
            "text": x["text"],
            "trip": None,
            "status": None,
            "likes": 0,
            "replies": [],
            "voice": "engine",
        }
        for i, x in enumerate(out)
    ]


# ---- feed (OASIS-style) ----------------------------------------------------------------------
def hot(likes: int, created_min: float) -> float:
    """OASIS's Reddit hot score with simulated minutes: popular and recent posts rank first."""
    return math.log10(max(likes, 1)) + created_min / 750.0


def rank(posts: list[dict], viewer: str, k: int = 5) -> list[dict]:
    return sorted(
        (p for p in posts if p["author"] != viewer),
        key=lambda p: (-hot(p["likes"], p["t"]), p["id"]),
    )[:k]
