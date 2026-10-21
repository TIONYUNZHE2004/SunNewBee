import sqlite3

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


class StoredEvent(BaseModel):
    event: events.EventSpec
    closures: list[ClosureOut]


@router.post("/events/simulate", response_model=events.EventImpact)
def simulate_event(body: SimulateEventBody) -> events.EventImpact:
    spec = events.EventSpec.model_validate(body.model_dump(exclude={"profiles"}))
    if not tools._WM_SLOTS.acquire(blocking=False):
        raise HTTPException(503, "world-model solver busy; try again shortly")
    try:
        with state.world_lock:
            world, _ = snapshot_world(state.get_ctx().world, spec.starts_at)
        return events.simulate_event(world, spec, tuple(body.profiles))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        tools._WM_SLOTS.release()


@router.post("/events", response_model=StoredEvent, status_code=201, dependencies=[StaffOnly])
def create_event(body: events.EventSpec) -> StoredEvent:
    with state.world_lock:
        try:
            events.validate_event(state.get_ctx().world, body)
            rows = _store().create_many(
                element_ids=body.segment_ids,
                reason="event",
                starts_at=body.starts_at,
                ends_at=body.ends_at,
                note=None,
                event_name=body.name,
            )
            _sync()
            for row in rows:
                _audit_row(row, None, "event:create")
            return StoredEvent(event=body, closures=[_out(row, True) for row in rows])
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except sqlite3.Error:
            raise HTTPException(503, "closure store unavailable") from None
