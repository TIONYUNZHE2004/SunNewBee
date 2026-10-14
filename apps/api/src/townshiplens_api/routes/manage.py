import contextlib
import sqlite3
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from townshiplens_spatial.models import Claim, VerificationRequest

from .. import state
from ..settings import ApiSettings

router = APIRouter()


class ResolveBody(BaseModel):
    action: Literal["verify", "correct", "reject"]
    value: Any = None
    note: str = ""


@router.get("/verification-requests", response_model=list[VerificationRequest])
def vrs(status: str = "open") -> list[VerificationRequest]:
    return state.get_ctx().vrs.list(status)


@router.post("/verification-requests/{vr_id}/resolve", response_model=VerificationRequest)
def resolve(
    vr_id: str,
    body: ResolveBody,
    x_staff_token: Annotated[str | None, Header()] = None,
) -> VerificationRequest:
    if x_staff_token is None or x_staff_token != ApiSettings().staff_token:
        raise HTTPException(401, "staff token required")
    ctx = state.get_ctx()
    existing = next(
        (
            v
            for st in ("open", "in_progress", "resolved", "rejected")
            for v in ctx.vrs.list(st)
            if v.id == vr_id
        ),
        None,
    )
    if existing is None:
        raise HTTPException(404, f"unknown verification request {vr_id}")
    if existing.status not in ("open", "in_progress"):
        raise HTTPException(409, f"{vr_id} is already {existing.status}")
    if body.action in ("verify", "correct") and body.value is None:
        raise HTTPException(422, "value is required for verify/correct")
    try:
        done = ctx.vrs.resolve(vr_id, body.action, body.value, body.note)
    except KeyError:
        raise HTTPException(404, f"unknown verification request {vr_id}") from None
    except (ValueError, sqlite3.Error) as e:
        raise HTTPException(409, str(e)) from None
    if body.action in ("verify", "correct"):
        with contextlib.suppress(KeyError):  # element gone (e.g. missing_place VR)
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
