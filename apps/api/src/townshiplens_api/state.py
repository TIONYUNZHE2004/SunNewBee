from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from .settings import TINY_FIXTURE, ApiSettings

_ctx: tools.Ctx | None = None


def get_ctx() -> tools.Ctx:
    global _ctx
    if _ctx is None:
        s = ApiSettings()
        data = s.tl_data_dir if (s.tl_data_dir / "site.json").exists() else TINY_FIXTURE
        _ctx = tools.Ctx(
            world=load_world(data),
            vrs=VerificationStore(s.database_url.removeprefix("sqlite:///")),
        )
    return _ctx


def reset() -> None:
    global _ctx
    _ctx = None
