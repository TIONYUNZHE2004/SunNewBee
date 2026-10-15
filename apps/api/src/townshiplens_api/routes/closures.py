import sqlite3
from datetime import UTC, datetime
from typing import Self

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from townshiplens_spatial import tools
from townshiplens_spatial.models import Closure, ClosureReason

from .. import state
from ..auth import StaffOnly
from .manage import _audit

router = APIRouter()


class ClosureOut(BaseModel):
    """A closure as the public sees it: always a staff report, never a verified fact."""

    id: str
    element_id: str
    element_name: str | None = None
    element_kind: str | None = None  # edge | place
    reason: ClosureReason
    starts_at: datetime
    ends_at: datetime | None = None
    note: str | None = None
    label: str  # "Closed: works until 2026-10-20" or "... until further notice"
    source_label: str = tools.CLOSURE_SOURCE_LABEL  # "Reported closure (staff)"
    active: bool


class CreateClosureBody(BaseModel):
    element_id: str = Field(max_length=120)
    reason: ClosureReason
    starts_at: datetime | None = None  # default: now
    ends_at: datetime | None = None  # default: until further notice
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _window(self) -> Self:
        if self.ends_at is not None and self.starts_at is not None:
            a, b = (
                d if d.tzinfo else d.replace(tzinfo=UTC) for d in (self.starts_at, self.ends_at)
            )
            if b <= a:
                raise ValueError("ends_at must be after starts_at")
        return self


def _out(c: Closure) -> ClosureOut:
    return ClosureOut(**tools.closure_row(state.get_ctx().world, c))


def _store():
    store = state.get_ctx().closures
    assert store is not None
    return store


def _sync() -> None:
    """Reload the world's closures from the store (callers hold world_lock); bumps version."""
    state.get_ctx().world.set_closures(_store().current())


def _audit_row(closure: Closure, old: Closure | None, reason: str) -> None:
    _audit().append(
        element_id=closure.element_id,
        attribute="closure",
        old=old.model_dump(mode="json") if old else None,
        new=closure.model_dump(mode="json"),
        reason=reason,
        note=closure.note,
    )


@router.get("/closures", response_model=list[ClosureOut])
def list_closures(active: bool | None = True) -> list[ClosureOut]:
    """Staff-reported closures. active=true (default): in force now; active=false: ended or not
    started yet. Every row is a staff report, labelled as such."""
    try:
        return [_out(c) for c in _store().list(active)]
    except sqlite3.Error:
        raise HTTPException(503, "closure store unavailable") from None


@router.post("/closures", response_model=ClosureOut, status_code=201, dependencies=[StaffOnly])
def create_closure(body: CreateClosureBody) -> ClosureOut:
    ctx = state.get_ctx()
    now = datetime.now(UTC)
    with state.world_lock:
        if body.element_id not in ctx.world.edges and body.element_id not in ctx.world.places:
            raise HTTPException(404, f"unknown element {body.element_id}")
        try:
            c = _store().create(
                element_id=body.element_id,
                reason=body.reason,
                starts_at=body.starts_at or now,
                ends_at=body.ends_at,
                note=(body.note or "").strip() or None,
            )
            _sync()
            _audit_row(c, None, "closure:create")
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        except sqlite3.Error:
            raise HTTPException(503, "closure store unavailable") from None
        return _out(c)


@router.post("/closures/{closure_id}/end", response_model=ClosureOut, dependencies=[StaffOnly])
def end_closure(closure_id: str) -> ClosureOut:
    with state.world_lock:
        try:
            old, new = _store().end(closure_id)
            _sync()
            _audit_row(new, old, "closure:end")
        except KeyError:
            raise HTTPException(404, f"unknown closure {closure_id}") from None
        except ValueError as e:
            raise HTTPException(409, str(e)) from None
        except sqlite3.Error:
            raise HTTPException(503, "closure store unavailable") from None
        return _out(new)
