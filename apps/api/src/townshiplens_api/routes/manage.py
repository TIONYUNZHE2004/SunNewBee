import sqlite3
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel
from townshiplens_spatial.models import Claim, VerificationRequest

from .. import state
from ..auth import StaffOnly
from ..settings import ApiSettings
from ..store import AuditStore

router = APIRouter()
_audits: dict[str, AuditStore] = {}


def _audit() -> AuditStore:
    path = ApiSettings().database_url.removeprefix("sqlite:///")
    if path not in _audits:
        _audits[path] = AuditStore(path)
    return _audits[path]


def commit_claim(
    element_id: str, attribute: str, new: Claim, reason: str, note: str | None
) -> None:
    """Audit row first, then copy-on-write claim refresh, atomically under world_lock.
    Re-validates the type against the current claim inside the lock. Raises KeyError for an
    unknown element, ValueError on type mismatch, sqlite3.Error if the audit write fails."""
    ctx = state.get_ctx()
    with state.world_lock:
        target = ctx.world.edges.get(element_id) or ctx.world.places.get(element_id)
        if target is None:
            raise KeyError(element_id)
        old = target.claims.get(attribute)
        if new.value is not None and old is not None and not _type_ok(new.value, old.value):
            raise ValueError(f"value type does not match existing {attribute}")
        _audit().append(
            element_id=element_id,
            attribute=attribute,
            old=old.model_dump() if old else None,
            new=new.model_dump(),
            reason=reason,
            note=note,
        )
        ctx.world.refresh_claim(element_id, attribute, new)


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
        # Claim + audit first: if the VR resolve below fails, the VR stays open and a retry
        # is idempotent. A missing_place VR has no element, so no claim change and no audit row.
        try:
            commit_claim(
                existing.element_id,
                existing.attribute,
                Claim(
                    value=body.value,
                    status="verified",
                    verified_at=date.today().isoformat(),
                    evidence_type="staff_resolution",
                    verified_by="staff",
                    notes=body.note or None,
                ),
                f"resolve:{vr_id}",
                body.note or None,
            )
        except KeyError:
            pass
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        except sqlite3.Error:
            raise HTTPException(503, "audit store unavailable") from None
    try:
        return ctx.vrs.resolve(vr_id, body.action, body.value, body.note)
    except KeyError:
        raise HTTPException(404, f"unknown verification request {vr_id}") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    except sqlite3.Error:
        raise HTTPException(503, "verification store unavailable") from None


class AttributeBody(BaseModel):
    value: Any = None
    status: Literal["verified", "unknown", "reported"]
    source_type: str
    note: str | None = None


@router.patch("/elements/{element_id}/attributes/{key}", dependencies=[StaffOnly])
def edit_attribute(
    element_id: str,
    key: Annotated[str, Path(pattern=r"^[a-z_]{1,40}$")],
    body: AttributeBody,
) -> Claim:
    ctx = state.get_ctx()
    target = ctx.world.edges.get(element_id) or ctx.world.places.get(element_id)
    if target is None:
        raise HTTPException(404, f"unknown element {element_id}")
    if body.status != "unknown" and body.value is None:
        raise HTTPException(422, "value is required unless status is unknown")
    value = None if body.status == "unknown" else body.value
    new = Claim(
        value=value,
        status=body.status,
        verified_at=date.today().isoformat() if body.status == "verified" else None,
        evidence_type=body.source_type,
        verified_by="staff",
        notes=body.note,
    )
    try:
        commit_claim(element_id, key, new, "edit", body.note)
    except KeyError:
        raise HTTPException(404, f"unknown element {element_id}") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except sqlite3.Error:
        raise HTTPException(503, "audit store unavailable") from None
    return new


@router.get("/audit", dependencies=[StaffOnly])
def audit(element_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    try:
        return _audit().list(element_id, max(1, min(limit, 1000)))
    except sqlite3.Error:
        raise HTTPException(503, "audit store unavailable") from None
