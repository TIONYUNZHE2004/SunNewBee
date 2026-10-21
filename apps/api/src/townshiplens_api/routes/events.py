import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from townshiplens_spatial import events, tools
from townshiplens_spatial.sim import snapshot_world

from .. import state
from ..auth import StaffOnly
from .closures import ClosureOut, _audit_row, _out, _store, _sync

router = APIRouter()


class SimulateEventBody(events.EventSpec):
    profiles: list[str] = Field(
        default_factory=lambda: list(events.DEFAULT_PROFILES), min_length=1, max_length=5
    )


class SimulateClosureBody(events.ClosureScenario):
    profiles: list[str] = Field(
        default_factory=lambda: list(events.DEFAULT_PROFILES), min_length=1, max_length=5
    )
    at: datetime | None = None


class StoredEvent(BaseModel):
    event: events.EventSpec | events.ClosureScenario
    closures: list[ClosureOut]


def _simulate(body: SimulateEventBody | SimulateClosureBody):
    if not tools._WM_SLOTS.acquire(blocking=False):
        raise HTTPException(503, "world-model solver busy; try again shortly")
    try:
        if isinstance(body, SimulateClosureBody):
            spec = events.ClosureScenario.model_validate(
                body.model_dump(exclude={"profiles", "at"})
            )
            at = events.EventSpec._utc(body.at or spec.closures[0].starts_at)
        else:
            spec = events.EventSpec.model_validate(body.model_dump(exclude={"profiles"}))
            at = spec.starts_at
        with state.world_lock:
            world, _ = snapshot_world(state.get_ctx().world, at)
        if isinstance(body, SimulateClosureBody):
            return events.simulate_closure(world, spec, tuple(body.profiles), at)
        return events.simulate_event(world, spec, tuple(body.profiles))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        tools._WM_SLOTS.release()


@router.post("/closures/simulate", response_model=events.ClosureImpact)
def simulate_closure(body: SimulateClosureBody) -> events.ClosureImpact:
    """Public, hypothetical closure impact; no persistent writes or traffic counts."""
    return _simulate(body)


@router.post("/events/simulate", response_model=events.EventImpact | events.ClosureImpact)
def simulate_event(body: SimulateEventBody | SimulateClosureBody):
    """Compatibility alias: accepts both the original event and general closure shapes."""
    return _simulate(body)


@router.post("/events", response_model=StoredEvent, status_code=201, dependencies=[StaffOnly])
def create_event(body: events.EventSpec | events.ClosureScenario) -> StoredEvent:
    """Staff alias for atomic named closures, including each window and the actual reason."""
    with state.world_lock:
        try:
            world = state.get_ctx().world
            if isinstance(body, events.ClosureScenario):
                spec = events.resolve_scenario(world, body)
                reason = spec.reason
                windows = [(w.segment_ids, w.starts_at, w.ends_at) for w in spec.closures]
            else:
                events.validate_event(world, body)
                spec, reason = body, "event"
                windows = [(body.segment_ids, body.starts_at, body.ends_at)]
            rows = _store().create_windows(windows=windows, reason=reason, event_name=spec.name)
            _sync()
            for row in rows:
                _audit_row(row, None, "event:create")
            return StoredEvent(event=spec, closures=[_out(row, True) for row in rows])
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except sqlite3.Error:
            raise HTTPException(503, "closure store unavailable") from None
