import sqlite3
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field
from townshiplens_agent.agent import safe_vr_args
from townshiplens_spatial.attributes import ATTRIBUTE_TYPES, validate_value
from townshiplens_spatial.models import Claim, VerificationRequest

from .. import state
from ..auth import StaffOnly
from ..store import AuditStore, SimStore

router = APIRouter()
_audits: dict[str, AuditStore] = {}


def _audit() -> AuditStore:
    path = state.db_path()
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
        if new.value is not None:
            if attribute in ATTRIBUTE_TYPES:
                err = validate_value(attribute, new.value)
                if err:
                    raise ValueError(err)
            elif old is not None and not _type_ok(new.value, old.value):
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


class VRRow(VerificationRequest):
    """A VR plus the claim's current value, so staff see what Verify would confirm."""

    current_value: Any = None


@router.get("/verification-requests", response_model=list[VRRow])
def vrs(
    status: str = "open",
    reason: str | None = None,
    element_id: str | None = None,
    attribute: str | None = None,
) -> list[VRRow]:
    """status=all returns every status."""
    ctx = state.get_ctx()
    rows = []
    for vr in ctx.vrs.list(status, reason, element_id, attribute):
        target = ctx.world.edges.get(vr.element_id) or ctx.world.places.get(vr.element_id)
        claim = target.claims.get(vr.attribute) if target else None
        rows.append(VRRow(**vr.model_dump(), current_value=claim.value if claim else None))
    return rows


class CreateVRBody(BaseModel):
    target_id: str = Field(max_length=120)
    attribute: str = Field(max_length=60)
    reason: str = Field(default="unknown", max_length=40)


@router.post("/verification-requests", response_model=VerificationRequest, dependencies=[StaffOnly])
def create_vr(body: CreateVRBody) -> VerificationRequest:
    """Staff-filed VR; deduped against the open one (demand + 1). Same PDPA sanitising as chat."""
    ctx = state.get_ctx()
    safe = safe_vr_args(ctx.world, body.model_dump(), source="staff")
    try:
        vr, _ = ctx.vrs.request(
            safe["target_id"], safe["attribute"], safe["reason"], safe["question_summary"]
        )
    except sqlite3.Error:
        raise HTTPException(503, "verification store unavailable") from None
    return vr


class Kpis(BaseModel):
    open_vrs: int
    median_hours_to_resolve: float | None = None
    journeys_confirmed_pct: float | None = None


_sims: dict[str, SimStore] = {}


@router.get("/kpis", response_model=Kpis)
def kpis() -> Kpis:
    ctx = state.get_ctx()
    path = state.db_path()
    try:
        n_open, median = ctx.vrs.kpis()
        if path not in _sims:
            _sims[path] = SimStore(path)
        recent = _sims[path].recent(1)
    except sqlite3.Error:
        raise HTTPException(503, "store unavailable") from None
    pct = None
    if recent:
        counts = recent[0]["counts"]
        total = sum(sum(v.values()) for v in counts.values())
        ok = sum(v.get("success", 0) for v in counts.values())
        pct = round(100 * ok / total, 1) if total else None
    return Kpis(
        open_vrs=n_open,
        median_hours_to_resolve=None if median is None else round(median, 2),
        journeys_confirmed_pct=pct,
    )


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
    # One lock across read, status check, claim commit, audit row and VR update: the loser of
    # two concurrent resolves gets 409 and changes nothing. world_lock is an RLock, so the
    # nested commit_claim is fine.
    with state.world_lock:
        try:
            existing = ctx.vrs.get(vr_id)
        except sqlite3.Error:
            raise HTTPException(503, "verification store unavailable") from None
        if existing is None:
            raise HTTPException(404, f"unknown verification request {vr_id}")
        if existing.status not in ("open", "in_progress"):
            raise HTTPException(409, f"{vr_id} is already {existing.status}")
        verifying = body.action in ("verify", "correct")
        value = body.value
        if verifying and value is None and body.action == "verify":
            # Verify with no value confirms the claim's current value.
            target = ctx.world.edges.get(existing.element_id) or ctx.world.places.get(
                existing.element_id
            )
            current = target.claims.get(existing.attribute) if target else None
            value = current.value if current else None
        if verifying and value is None:
            raise HTTPException(422, "value is required for verify/correct")
        if verifying:
            # Claim + audit first: if the VR resolve below fails, the VR stays open and a retry
            # is idempotent. A missing_place VR has no element, so it has no value to verify
            # (422 above); KeyError below only covers an element removed since the VR was filed.
            try:
                commit_claim(
                    existing.element_id,
                    existing.attribute,
                    Claim(
                        value=value,
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
            return ctx.vrs.resolve(vr_id, body.action, value, body.note)
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
