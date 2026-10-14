import contextlib
import sqlite3
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from townshiplens_spatial.models import Claim, VerificationRequest

from .. import state
from ..auth import StaffOnly

router = APIRouter()


class ResolveBody(BaseModel):
    action: Literal["verify", "correct", "reject"]
    value: Any = None
    note: str = ""


@router.get("/verification-requests", response_model=list[VerificationRequest])
def vrs(status: str = "open") -> list[VerificationRequest]:
    return state.get_ctx().vrs.list(status)


def _type_ok(new: Any, old: Any) -> bool:
    if old is None:
        return True
    num = (int, float)
    if isinstance(old, bool) or isinstance(new, bool):
        return isinstance(old, bool) and isinstance(new, bool)
    if isinstance(old, num):
        return isinstance(new, num)
    return isinstance(new, type(old))


@router.post(
    "/verification-requests/{vr_id}/resolve",
    response_model=VerificationRequest,
    dependencies=[StaffOnly],
)
def resolve(vr_id: str, body: ResolveBody) -> VerificationRequest:
    ctx = state.get_ctx()
    try:
        existing = ctx.vrs.get(vr_id)
    except sqlite3.Error:
        raise HTTPException(503, "verification store unavailable") from None
    if existing is None:
        raise HTTPException(404, f"unknown verification request {vr_id}")
    if existing.status not in ("open", "in_progress"):
        raise HTTPException(409, f"{vr_id} is already {existing.status}")
    verifying = body.action in ("verify", "correct")
    if verifying and body.value is None:
        raise HTTPException(422, "value is required for verify/correct")
    if verifying:
        target = ctx.world.edges.get(existing.element_id) or ctx.world.places.get(
            existing.element_id
        )
        old = target.claims.get(existing.attribute) if target else None
        if old is not None and not _type_ok(body.value, old.value):
            raise HTTPException(422, f"value type does not match existing {existing.attribute}")
    try:
        done = ctx.vrs.resolve(vr_id, body.action, body.value, body.note)
    except KeyError:
        raise HTTPException(404, f"unknown verification request {vr_id}") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    except sqlite3.Error:
        raise HTTPException(503, "verification store unavailable") from None
    if verifying:
        with state.world_lock, contextlib.suppress(KeyError):  # element gone (missing_place VR)
            ctx.world.refresh_claim(
                done.element_id,
                done.attribute,
                Claim(
                    value=body.value,
                    status="verified",
                    verified_at=date.today().isoformat(),
                    evidence_type="staff_resolution",
                    verified_by="staff",
                    notes=body.note or None,
                ),
            )
    return done
