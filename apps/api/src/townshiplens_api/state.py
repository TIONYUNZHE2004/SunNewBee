import logging
import threading
from pathlib import Path

from townshiplens_spatial import tools
from townshiplens_spatial.closure_store import ClosureStore
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

from . import geojson
from .settings import TINY_FIXTURE, ApiSettings

log = logging.getLogger(__name__)
_ctx: tools.Ctx | None = None
_init_lock = threading.Lock()
# Held around world mutations (staff resolve -> refresh_claim).
world_lock = threading.RLock()


def data_dir() -> Path:
    """The world directory get_ctx loads: tl_data_dir if it has site.json, else the tiny fixture."""
    d = ApiSettings().tl_data_dir
    return d if (d / "site.json").exists() else TINY_FIXTURE


def get_ctx() -> tools.Ctx:
    global _ctx
    if _ctx is None:
        with _init_lock:
            if _ctx is None:
                s = ApiSettings()
                data = data_dir()
                if data == TINY_FIXTURE and s.tl_data_dir != TINY_FIXTURE:
                    log.warning("no site.json in %s; using the tiny fixture", s.tl_data_dir)
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
        geojson.clear_cache()
        from .routes import core

        core.clear_buildings_cache()
