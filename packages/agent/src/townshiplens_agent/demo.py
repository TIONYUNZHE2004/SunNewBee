"""DEMO_MODE cache: record a turn once, replay it offline. A miss runs normally."""

import asyncio
import hashlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from functools import lru_cache
from pathlib import Path

from pydantic import TypeAdapter
from townshiplens_spatial.evaluate import effective_claim_status
from townshiplens_spatial.world import World

from .events import ChatEvent, ChatRequest, Done, VerificationRequested
from .redact import redact
from .settings import AgentSettings

log = logging.getLogger(__name__)
_ADAPTER: TypeAdapter = TypeAdapter(ChatEvent)
DELAY_S = 0.02
SUFFIX = "+demo-cache"


@lru_cache(maxsize=1)
def _code_digest() -> str:
    """A recording is valid for the engine, validator and wording that checked it."""
    import townshiplens_spatial

    digest = hashlib.sha256()
    roots = (Path(__file__).parent, Path(townshiplens_spatial.__file__).parent)
    for root in roots:
        for path in sorted([*root.glob("*.py"), *root.glob("prompts/*.md")]):
            digest.update(path.name.encode())
            # LF-normalised: a Windows checkout (core.autocrlf) must hash like CI's Linux one.
            digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()


def expired_claims(world: World, today: date) -> list[str]:
    """Verified claims past their TTL on `today` ("element.attribute"): the only way the calendar
    changes what the engine says, so the only date-dependent part of the fingerprint."""
    return sorted(
        f"{eid}.{attr}"
        for items in (world.edges, world.places)
        for eid, x in items.items()
        for attr, c in x.claims.items()
        if c.status == "verified" and effective_claim_status(c, attr, today) == "stale"
    )


def world_fingerprint(world: World) -> str:
    """Stable across restarts and days; invalidated by claims, data, closures, profiles, rules,
    code, and a verified claim reaching its expiry (not by the date itself, so a recording made
    today still replays tomorrow when no fact has expired in between).

    Only demo mode pays for hashing world facts. Mutation methods increment world.version.
    The code hash prevents an old recording bypassing a repaired validator or route rule.
    """
    today = date.today()
    key = (world.version, today.isoformat(), _code_digest())
    cached = getattr(world, "_demo_fingerprint", None)
    if cached and cached[0] == key:
        return cached[1]
    payload = {
        "code": key[2],
        "expired": expired_claims(world, today),
        "site": world.site.model_dump(mode="json"),
        "edges": {k: v.model_dump(mode="json") for k, v in world.edges.items()},
        "places": {k: v.model_dump(mode="json") for k, v in world.places.items()},
        "flood": world.flood.model_dump(mode="json"),
        "profiles": {k: v.model_dump(mode="json") for k, v in world.profiles.items()},
        "centres": {k: v.model_dump(mode="json") for k, v in world.centres.items()},
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    world._demo_fingerprint = (key, digest)
    return digest


def key(req: ChatRequest) -> str:
    msg = " ".join(req.message.lower().split())
    raw = "\x1f".join([msg, req.profile, req.scenario_id or ""])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _dir(d: Path | None) -> Path:
    return d if d is not None else AgentSettings().demo_dir


def load(
    k: str,
    demo_dir: Path | None = None,
    world: str | None = None,
    fingerprint: str | None = None,
) -> list[ChatEvent] | None:
    path = _dir(demo_dir) / f"{k}.jsonl"
    if not path.exists():
        return None
    try:
        lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
        meta = json.loads(lines[0]).get("meta")
        if not isinstance(meta, dict):
            raise ValueError("missing meta line")
        events = [_ADAPTER.validate_python(json.loads(ln)) for ln in lines[1:]]
        if not events or events[-1].type != "done":
            raise ValueError("cache entry does not end with done")
    except Exception as exc:
        log.warning("ignoring corrupt demo cache %s: %s", path.name, type(exc).__name__)
        return None
    if world is not None and meta.get("world") != world:
        log.warning(
            "demo cache %s was recorded on world %r, current is %r: treating as a miss",
            path.name,
            meta.get("world"),
            world,
        )
        return None
    if fingerprint is not None and meta.get("world_fingerprint") != fingerprint:
        return None  # missing signatures are legacy recordings, not checked current facts
    return events


def save(k: str, events: list[ChatEvent], meta: dict, demo_dir: Path | None = None) -> Path:
    d = _dir(demo_dir)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{k}.jsonl"
    rows = [{"meta": meta}] + [e.model_dump(mode="json") for e in events]
    text = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    path.write_text(text, "utf-8", newline="\n")  # LF on Windows too: byte-stable re-records
    return path


def make_meta(req: ChatRequest, events: list[ChatEvent], world: World | str = "") -> dict:
    done = events[-1]
    return {
        "message": redact(req.message),
        "profile": req.profile,
        "scenario_id": req.scenario_id,
        "world": world.site.id if isinstance(world, World) else world,
        "world_fingerprint": world_fingerprint(world) if isinstance(world, World) else None,
        "model": done.model if isinstance(done, Done) else "unknown",
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


async def replay(events: list[ChatEvent], vrs=None) -> AsyncIterator[ChatEvent]:
    for ev in events:
        if ev.type == "text.delta":
            await asyncio.sleep(DELAY_S)
        if isinstance(ev, VerificationRequested) and vrs is not None:
            # Keep the staff queue consistent: replay files/upvotes the VR like a live turn.
            vr, created = vrs.request(
                ev.element_id, ev.attribute, ev.reason or "unknown", "demo replay"
            )
            ev = ev.model_copy(
                update={"request_id": vr.id, "created": created, "demand": vr.demand}
            )
        if isinstance(ev, Done):
            ev = ev.model_copy(
                update={"message_id": uuid.uuid4().hex[:12], "model": ev.model + SUFFIX}
            )
        yield ev
