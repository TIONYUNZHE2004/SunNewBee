import logging
import threading

from townshiplens_spatial import tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from .settings import TINY_FIXTURE, ApiSettings

log = logging.getLogger(__name__)
_ctx: tools.Ctx | None = None
_init_lock = threading.Lock()
# Held around world mutations (staff resolve -> refresh_claim).
world_lock = threading.RLock()


def get_ctx() -> tools.Ctx:
    global _ctx
    if _ctx is None:
        with _init_lock:
            if _ctx is None:
                s = ApiSettings()
                if (s.tl_data_dir / "site.json").exists():
                    data = s.tl_data_dir
                else:
                    log.warning("no site.json in %s; using the tiny fixture", s.tl_data_dir)
                    data = TINY_FIXTURE
                _ctx = tools.Ctx(
                    world=load_world(data),
                    vrs=VerificationStore(s.database_url.removeprefix("sqlite:///")),
                )
    return _ctx


def reset() -> None:
    global _ctx
    with _init_lock:
        _ctx = None
