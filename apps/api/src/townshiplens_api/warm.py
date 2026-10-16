"""Warm the world model's caches in the background (Cycle 9: demo hardening).

On the Elmina seed the first rising-river rollout takes about 13 s, the What-if suggestions
about 8 s and the survey plan about 5 s. A presenter used to open each screen once before going
on stage. Now the API computes the screens' *default* requests in one background thread after
startup, through the same cached tool functions and with the same arguments as the endpoints,
so the cache keys match. It warms again whenever the world changes (a ticket resolved, a
closure filed), because every cache is keyed by the world version.

Nothing here changes an answer: it only fills caches the endpoints would fill on first use, and
it takes the same solver slots, so it never runs more world-model work at once than requests may.
"""

from __future__ import annotations

import logging
import threading
import time

from townshiplens_spatial import tools

from . import state

log = logging.getLogger(__name__)

# (name, call) with the endpoints' default arguments: GET /river-rollout (no query),
# GET /what-if/suggestions (Lab default persona), GET /verify-next (board defaults).
JOBS = (
    ("river_rollout", lambda ctx: tools.rising_river_rollout(ctx, profiles=None, n=30)),
    ("what_if_suggestions", lambda ctx: tools.suggest_interventions(ctx, profile="wheelchair")),
    ("verify_next", lambda ctx: tools.plan_verifications(ctx, "wheelchair", "evacuation", 15)),
)
POLL_S = 10.0

_lock = threading.Lock()
_status: dict = {"state": "off", "version": None, "done": [], "seconds": {}}
_stop = threading.Event()
_thread: threading.Thread | None = None


def status() -> dict:
    with _lock:
        return {**_status, "done": list(_status["done"]), "seconds": dict(_status["seconds"])}


def warm_once(ctx=None, stop: threading.Event | None = None) -> dict:
    """Run every job once for the current world version; returns the status. `stop` (the
    background loop's flag) ends the run early at shutdown."""
    ctx = ctx or state.get_ctx()
    version = ctx.world.version
    with _lock:
        _status.update(state="warming", version=version, done=[], seconds={})
    for name, job in JOBS:
        if stop is not None and stop.is_set():
            break
        t0 = time.perf_counter()
        try:
            res = job(ctx)
            ok = bool(getattr(res, "ok", True))
        except Exception:  # noqa: BLE001 - a warm-up failure must never take the API down
            log.exception("warm-up job %s failed", name)
            ok = False
        with _lock:
            _status["seconds"][name] = round(time.perf_counter() - t0, 2)
            if ok:
                _status["done"].append(name)
    with _lock:
        _status["state"] = "warm"
    return status()


def _loop() -> None:
    last = None
    while not _stop.is_set():
        try:
            ctx = state.get_ctx()
            if ctx.world.version != last:
                last = ctx.world.version
                s = warm_once(ctx, _stop)
                log.info("world model warm (version %s): %s", last, s["seconds"])
        except Exception:  # noqa: BLE001
            log.exception("warm-up loop failed")
        _stop.wait(POLL_S)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="wm-warm", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout=30)
