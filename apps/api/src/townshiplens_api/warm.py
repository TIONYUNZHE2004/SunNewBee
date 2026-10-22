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

from townshiplens_spatial import events, tools
from townshiplens_spatial.sim import snapshot_world

from . import state

log = logging.getLogger(__name__)

DAY_ORDER = ("storm", "weekday", "event", "friday")


def _day(ctx, sid: str):
    """A day rehearsal, or None (skipped) when this world has no such scenario."""
    if not any(s["id"] == sid for s in tools.day_scenarios(ctx)):
        return None
    return tools.day_rehearsal(ctx, sid)


def _hero_compare(ctx):
    if not any(s["id"] == "storm" for s in tools.day_scenarios(ctx)):
        return None
    ch = tools.day_changes(ctx, "storm")
    if not ch.ok or not ch.data["candidates"]:
        return ch if not ch.ok else None
    return tools.day_compare(ctx, "storm", [ch.data["candidates"][0]["action"]])


# (name, call) with the endpoints' default arguments: GET /river-rollout (no query),
# GET /what-if/suggestions (Lab default persona), GET /verify-next (board defaults).
def _storm_change(ctx, n: int):
    if not any(s["id"] == "storm" for s in tools.day_scenarios(ctx)):
        return None
    return tools.day_test_change(ctx, "storm", n)


def _closures(ctx):
    if not tools._WM_SLOTS.acquire(blocking=False):
        raise RuntimeError("world-model solver busy")
    try:
        with state.world_lock:
            world, _ = snapshot_world(ctx.world)
        events.warm_baselines(world)
    finally:
        tools._WM_SLOTS.release()


JOBS = (
    ("closure_baselines", _closures),
    ("river_rollout", lambda ctx: tools.rising_river_rollout(ctx, profiles=None, n=30)),
    ("what_if_suggestions", lambda ctx: tools.suggest_interventions(ctx, profile="wheelchair")),
    ("verify_next", lambda ctx: tools.plan_verifications(ctx, "wheelchair", "evacuation", 15)),
    # Elmina Day: the four built-in rehearsals (about 5 s each on the seed).
    *((f"day_{sid}", lambda ctx, sid=sid: _day(ctx, sid)) for sid in DAY_ORDER),
    # the planner's hero: the storm's top suggested change, compared (Cycle 13)
    ("day_storm_compare", lambda ctx: _hero_compare(ctx)),
    # the assistant's "test option 2/3" on the storm (about 10 s each cold, review C17)
    *((f"day_storm_change_{n}", lambda ctx, n=n: _storm_change(ctx, n)) for n in (1, 2, 3)),
)
POLL_S = 10.0
IDLE_WAIT_S = 120.0  # how long a job waits for the solver to be idle before running anyway

_lock = threading.Lock()
_status: dict = {"state": "off", "version": None, "done": [], "seconds": {}}
_stop = threading.Event()
_thread: threading.Thread | None = None


def status() -> dict:
    with _lock:
        return {**_status, "done": list(_status["done"]), "seconds": dict(_status["seconds"])}


def _signal(ctx) -> tuple:
    """What the caches are keyed by: the world version and the open tickets (the survey plan
    links them, so filing a ticket changes its key without bumping the version)."""
    keys = {
        (vr.element_id, vr.attribute)
        for status in ("open", "in_progress")
        for vr in ctx.vrs.list(status=status)
    }
    # Expiring checks and clock-driven staff closures also invalidate baselines.
    from datetime import UTC, datetime

    with state.world_lock:
        _, closure_hash = snapshot_world(ctx.world)
    return ctx.world.version, datetime.now(UTC).date(), closure_hash, tuple(sorted(keys))


def _wait_idle(stop: threading.Event | None) -> None:
    """Warm-up yields to residents and staff: a job starts only when no request holds a solver
    slot (or after IDLE_WAIT_S), so it never takes the second slot from a waiting request."""
    deadline = time.monotonic() + IDLE_WAIT_S
    while not tools.wm_idle() and time.monotonic() < deadline:
        if stop is not None and stop.wait(0.2):
            return
        if stop is None:
            time.sleep(0.2)


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
        _wait_idle(stop)
        t0 = time.perf_counter()
        try:
            res = job(ctx)
            ok = res is None or bool(getattr(res, "ok", True))
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
            sig = _signal(ctx)
            if sig != last:
                last = sig
                s = warm_once(ctx, _stop)
                log.info("world model warm (version %s): %s", last[0], s["seconds"])
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
    """Ask the thread to stop. It is a daemon and a job cannot be interrupted, so shutdown
    waits at most 2 s instead of the rest of a 15 s solve."""
    _stop.set()
    if _thread:
        _thread.join(timeout=2)


def public_status() -> dict:
    """What /healthz shows: whether the screens are warm, nothing about activity."""
    st = status()
    return {"state": st["state"], "done": st["done"]}


def reset() -> None:
    with _lock:
        _status.update(state="off", version=None, done=[], seconds={})
