from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from . import models as _m
from .models import Closure

SCHEMA = """CREATE TABLE IF NOT EXISTS closures (
  id TEXT PRIMARY KEY, element_id TEXT NOT NULL, reason TEXT NOT NULL, starts_at TEXT NOT NULL,
  ends_at TEXT, note TEXT, created_by TEXT NOT NULL, source TEXT NOT NULL,
  created_at TEXT NOT NULL, event_name TEXT)"""


class ClosureStore:
    """Staff-reported closures in the per-world SQLite (same file as VRs, audit and sim runs).
    Rows are never deleted: ending a closure sets its `ends_at`."""

    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.execute(SCHEMA)
        if "event_name" not in {r[1] for r in self.db.execute("PRAGMA table_info(closures)")}:
            self.db.execute("ALTER TABLE closures ADD COLUMN event_name TEXT")
        self.db.commit()
        self._lock = threading.RLock()

    @staticmethod
    def _row(r: sqlite3.Row) -> Closure:
        return Closure.model_validate(dict(r))

    def create(
        self,
        *,
        element_id: str,
        reason: str,
        starts_at: datetime,
        ends_at: datetime | None,
        note: str | None,
        event_name: str | None = None,
    ) -> Closure:
        return self.create_many(
            element_ids=[element_id],
            reason=reason,
            starts_at=starts_at,
            ends_at=ends_at,
            note=note,
            event_name=event_name,
        )[0]

    def create_many(
        self,
        *,
        element_ids: list[str],
        reason: str,
        starts_at: datetime,
        ends_at: datetime | None,
        note: str | None,
        event_name: str | None = None,
    ) -> list[Closure]:
        """Store a whole course atomically; reject an end not after its start.

        A failed insert leaves no partial event.
        """
        if not element_ids:
            raise ValueError("at least one element is required")
        element_id = element_ids[0]
        probe = Closure(id="-", element_id=element_id, reason=reason, starts_at=starts_at)
        end = Closure(
            id="-", element_id=element_id, reason=reason, starts_at=starts_at, ends_at=ends_at
        ).ends_at
        if end is not None and end <= probe.starts_at:
            raise ValueError("ends_at must be after starts_at")
        with self._lock, self.db:
            n = (
                self.db.execute(
                    "SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) FROM closures"
                ).fetchone()[0]
                + 1
            )
            ids = []
            for i, element_id in enumerate(dict.fromkeys(element_ids)):
                cid = f"cl-{n + i:04d}"
                ids.append(cid)
                self.db.execute(
                    "INSERT INTO closures "
                    "(id,element_id,reason,starts_at,ends_at,note,created_by,source,"
                    "created_at,event_name) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        cid,
                        element_id,
                        reason,
                        probe.starts_at.isoformat(),
                        end.isoformat() if end else None,
                        note,
                        "staff",
                        "staff_report",
                        _m.utcnow().isoformat(),
                        event_name,
                    ),
                )
            return [self.get(cid) for cid in ids]

    def get(self, closure_id: str) -> Closure | None:
        with self._lock:
            r = self.db.execute("SELECT * FROM closures WHERE id=?", (closure_id,)).fetchone()
        return self._row(r) if r else None

    def list(self, active: bool | None = None, now: datetime | None = None) -> list[Closure]:
        """active=True: in force now; False: not in force (ended or not started yet); None: all."""
        now = now or _m.utcnow()
        with self._lock:
            rows = self.db.execute("SELECT * FROM closures ORDER BY starts_at, id").fetchall()
        out = [self._row(r) for r in rows]
        if active is None:
            return out
        return [c for c in out if c.is_active(now) == active]

    def current(self, now: datetime | None = None) -> list[Closure]:
        """Closures that are active or still to start (not expired): what the world loads."""
        now = now or _m.utcnow()
        return [c for c in self.list() if c.ends_at is None or now < c.ends_at]

    def end(self, closure_id: str, now: datetime | None = None) -> tuple[Closure, Closure]:
        """End a closure now (or cancel one that has not started). Returns (old, new). KeyError
        for an unknown id; ValueError when it has already ended."""
        now = now or _m.utcnow()
        with self._lock, self.db:
            old = self.get(closure_id)
            if old is None:
                raise KeyError(closure_id)
            if old.ends_at is not None and old.ends_at <= max(now, old.starts_at):
                raise ValueError(f"{closure_id} has already ended")
            # A closure that has not started is cancelled by collapsing its window to nothing.
            end = max(now, old.starts_at)
            self.db.execute(
                "UPDATE closures SET ends_at=? WHERE id=?", (end.isoformat(), closure_id)
            )
        new = self.get(closure_id)
        assert new is not None
        return old, new
