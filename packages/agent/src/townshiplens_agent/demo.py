"""DEMO_MODE cache: record a turn once, replay it offline. A miss runs normally."""

import asyncio
import hashlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from pydantic import TypeAdapter

from .events import ChatEvent, ChatRequest, Done
from .settings import AgentSettings

log = logging.getLogger(__name__)
_ADAPTER: TypeAdapter = TypeAdapter(ChatEvent)
DELAY_S = 0.02
SUFFIX = "+demo-cache"


def key(req: ChatRequest) -> str:
    msg = " ".join(req.message.lower().split())
    raw = "\x1f".join([msg, req.profile, req.scenario_id or ""])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _dir(d: Path | None) -> Path:
    return d if d is not None else AgentSettings().demo_dir


def load(k: str, demo_dir: Path | None = None) -> list[ChatEvent] | None:
    path = _dir(demo_dir) / f"{k}.jsonl"
    if not path.exists():
        return None
    try:
        lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
        if not isinstance(json.loads(lines[0]).get("meta"), dict):
            raise ValueError("missing meta line")
        events = [_ADAPTER.validate_python(json.loads(ln)) for ln in lines[1:]]
        if not events or events[-1].type != "done":
            raise ValueError("cache entry does not end with done")
        return events
    except Exception as exc:
        log.warning("ignoring corrupt demo cache %s: %s", path.name, type(exc).__name__)
        return None


def save(k: str, events: list[ChatEvent], meta: dict, demo_dir: Path | None = None) -> Path:
    d = _dir(demo_dir)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{k}.jsonl"
    rows = [{"meta": meta}] + [e.model_dump(mode="json") for e in events]
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), "utf-8")
    return path


def make_meta(req: ChatRequest, events: list[ChatEvent]) -> dict:
    done = events[-1]
    return {
        "message": req.message,
        "profile": req.profile,
        "scenario_id": req.scenario_id,
        "model": done.model if isinstance(done, Done) else "unknown",
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }


async def replay(events: list[ChatEvent]) -> AsyncIterator[ChatEvent]:
    for ev in events:
        if ev.type == "text.delta":
            await asyncio.sleep(DELAY_S)
        if isinstance(ev, Done):
            ev = ev.model_copy(
                update={"message_id": uuid.uuid4().hex[:12], "model": ev.model + SUFFIX}
            )
        yield ev
