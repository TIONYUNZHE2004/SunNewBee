from townshiplens_api import state
from townshiplens_spatial import tools


def file_kiosk_vr() -> str:
    """File the open VR for seg-cf incline_pct the way the chat does (stroller, park-b to
    kiosk) and return its id. POST /routes no longer files VRs."""
    ctx = state.get_ctx()
    tools.plan_route(ctx, "park-b", "kiosk", "stroller", None, "test")
    vrs = ctx.vrs.list("open")
    assert vrs and vrs[0].element_id == "seg-cf"
    return vrs[0].id
