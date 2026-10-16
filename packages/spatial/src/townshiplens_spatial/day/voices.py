"""Attach the spotlight residents' voices to a day report (Cycle 11).

A recording (data/sim/<site>/day-<scenario>.json, made by townshiplens_agent.day_voice) holds
the residents' decisions, diary lines and feed posts. The engine always re-runs the day with
those decisions on the *current* world, and a recorded line is kept only when it still fits:
its trip exists with the same outcome, and the line passes `spotlight.check_text` against the
live facts. Anything else falls back to the template voice, so a resolved ticket or a new
closure never leaves a resident describing a day that no longer happened.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from . import spotlight as S
from .summary import SEVERITY


def recording_path(world, scenario_id: str) -> Path | None:
    if world.data_dir is None:
        return None
    base = Path(world.data_dir).resolve()
    return base.parent.parent / "sim" / base.name / f"day-{scenario_id}.json"


def load(world, scenario_id: str) -> dict | None:
    p = recording_path(world, scenario_id)
    if p is None or not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _status_of(f: dict) -> dict[str, str]:
    return {t["id"]: t["status"] for t in f["trips"]}


def template_feed(cast, facts: dict[str, dict]) -> list[dict]:
    """Deterministic posts from residents whose day went wrong, newest last. Likes are the
    number of other spotlight residents with a trip of the same kind that went wrong too (a
    count from the engine, not a guess)."""
    posts = []
    for c in cast:
        f = facts[c.id]
        bad = [
            t for t in f["trips"] if t["status"] in ("late", "cancelled", "turned_back", "stranded")
        ]
        if not bad:
            continue
        t = max(bad, key=lambda x: SEVERITY.get(x["status"], 0))
        text = S.template_post(f, t)
        if not text:
            continue
        same = sum(
            1
            for o in cast
            if o.id != c.id
            and any(x["to"] == t["to"] and x["status"] == t["status"] for x in facts[o.id]["trips"])
        )
        when = t["arrived"] or t["left"] or t["planned"]
        h, m = (int(x) for x in when.split(":"))
        posts.append(
            {
                "author": c.id,
                "name": c.name,
                "role": c.role,
                "t": h * 60 + m,
                "text": text,
                "trip": t["id"],
                "status": t["status"],
                "likes": same,
                "replies": [],
                "voice": "template",
            }
        )
    posts.sort(key=lambda p: (p["t"], p["author"]))
    for i, p in enumerate(posts):
        p["id"] = f"p{i + 1:03d}"
    return posts[:16]


def attach(res, day, cast: list[S.Spotlight], rec: dict | None) -> dict:
    facts = S.facts_for(res, day, cast)
    by_id = {c.id: c for c in cast}
    if rec:
        for c in rec.get("cast", []):
            if c["id"] in by_id and c.get("voice") and not S.BANNED.search(c["voice"]):
                by_id[c["id"]].voice = c["voice"]
    dropped = 0
    people = []
    rec_diaries = (rec or {}).get("diaries", {})
    reasons = (rec or {}).get("decision_reasons", {})
    for c in cast:
        f = facts[c.id]
        status = _status_of(f)
        tmpl = {x["trip"]: x for x in S.template_diary(f)}
        lines = []
        for ln in rec_diaries.get(c.id, []):
            ok = ln.get("trip") in status and not S.check_text(ln.get("text", ""), f)
            if ok and ln.get("voice") == "ai":
                lines.append(ln)
            elif ln.get("trip") in tmpl:
                lines.append({**tmpl[ln["trip"]], "voice": "template"})
                dropped += ln.get("voice") == "ai"
        if not lines:
            lines = [{**x, "voice": "template"} for x in tmpl.values()]
        decisions = [
            {**asdict(p), "reason": reasons.get(p.key, "")}
            for p in day.points
            if p.resident == c.id
        ]
        for d in decisions:
            if d["reason"] and S.check_text(d["reason"], f):
                d["reason"] = ""
        people.append({**asdict(c), "facts": f, "diary": lines, "decisions": decisions})
    feed = []
    notices = S.notices(day.scenario, day.world)  # rebuilt from the scenario, never trusted
    if rec and rec.get("feed"):
        for p in rec["feed"]:
            if p.get("author") == "township":
                continue
            f = facts.get(p.get("author"))
            if f is None or _status_of(f).get(p.get("trip")) != p.get("status"):
                dropped += 1
                continue
            if p.get("voice") == "ai" and S.check_text(p.get("text", ""), f):
                dropped += 1
                continue
            replies = [
                r
                for r in p.get("replies", [])
                if r.get("author") in facts
                and (r.get("trip") is None or r.get("trip") in _status_of(facts[r["author"]]))
                and not S.check_text(r.get("text", ""), facts[r["author"]])
            ]
            feed.append({**p, "replies": replies})
    if not feed:
        feed = template_feed(cast, facts)
    feed = sorted(notices + feed, key=lambda p: (p["t"], p["id"]))
    return {
        "residents": people,
        "feed": feed,
        "voice": {
            "model": (rec or {}).get("model", "template (no AI)"),
            "recorded_at": (rec or {}).get("recorded_at"),
            "dropped_as_stale": dropped,
            "note": "Synthetic residents. Their words may come from an AI model; every time "
            "and number in them is checked against their own simulated day.",
        },
    }
