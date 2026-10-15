import logging
import threading

from townshiplens_spatial import tools
from townshiplens_spatial.closure_store import ClosureStore
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
                world = load_world(data)
                path = s.db_path(world.site.id)
                closures = ClosureStore(path)
                world.set_closures(closures.current())  # active and upcoming; expired are dropped
                _ctx = tools.Ctx(world=world, vrs=VerificationStore(path), closures=closures)
    return _ctx


def db_path() -> str:
    """The one SQLite path for the loaded world (VR, sim and audit stores all use it)."""
    return ApiSettings().db_path(get_ctx().world.site.id)


def reset() -> None:
    global _ctx
    with _init_lock:
        _ctx = None
