import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

KEEP_RUNS = 20
SCHEMA = """CREATE TABLE IF NOT EXISTS sim_runs (
  run_id TEXT PRIMARY KEY, created_at TEXT, scenario_id TEXT, counts TEXT,
  n_tasks INTEGER, n_gaps INTEGER, n_violations INTEGER, world_version INTEGER, report TEXT)"""


class SimStore:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(sim_runs)")}
        if cols and "counts" not in cols:  # pre-summary-column dev table; runs are disposable
            self.db.execute("DROP TABLE sim_runs")
        self.db.execute(SCHEMA)
        self._lock = threading.RLock()

    def save(self, report: dict[str, Any]) -> None:
        with self._lock, self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO sim_runs VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    report["run_id"],
                    report["created_at"],
                    report.get("scenario_id"),
                    json.dumps(report["counts"]),
                    len(report["results"]),
                    len(report["gaps"]),
                    len(report["invariant_violations"]),
                    report.get("world_version", 0),
                    json.dumps(report),
                ),
            )
            self.db.execute(
                "DELETE FROM sim_runs WHERE run_id NOT IN "
                "(SELECT run_id FROM sim_runs ORDER BY created_at DESC, rowid DESC LIMIT ?)",
                (KEEP_RUNS,),
            )

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            r = self.db.execute("SELECT report FROM sim_runs WHERE run_id=?", (run_id,)).fetchone()
        return json.loads(r["report"]) if r else None

    def recent(self, limit: int) -> list[dict[str, Any]]:
        """Summary columns only; the report blob is never read."""
        with self._lock:
            rows = self.db.execute(
                "SELECT run_id, created_at, scenario_id, counts, n_tasks, n_gaps, n_violations, "
                "world_version FROM sim_runs ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "run_id": r["run_id"],
                "created_at": r["created_at"],
                "scenario_id": r["scenario_id"],
                "counts": json.loads(r["counts"]),
                "task_count": r["n_tasks"],
                "gap_count": r["n_gaps"],
                "violation_count": r["n_violations"],
                "world_version": r["world_version"],
            }
            for r in rows
        ]


AUDIT_SCHEMA = """CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  element_id TEXT NOT NULL, attribute TEXT NOT NULL, old TEXT, new TEXT NOT NULL,
  reason TEXT NOT NULL, note TEXT)"""


class AuditStore:
    """Append-only: no update or delete is exposed."""

    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute(AUDIT_SCHEMA)
        self._lock = threading.RLock()

    def append(
        self,
        *,
        element_id: str,
        attribute: str,
        old: dict[str, Any] | None,
        new: dict[str, Any],
        reason: str,
        note: str | None,
        actor: str = "staff",
    ) -> None:
        with self._lock, self.db:
            self.db.execute(
                "INSERT INTO audit_log (at, actor, element_id, attribute, old, new, reason, note) "
                "VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?,?,?,?,?)",
                (
                    actor,
                    element_id,
                    attribute,
                    json.dumps(old) if old is not None else None,
                    json.dumps(new),
                    reason,
                    note,
                ),
            )

    def list(self, element_id: str | None, limit: int = 200) -> list[dict[str, Any]]:
        sql = "SELECT * FROM audit_log"
        args: list[Any] = []
        if element_id:
            sql += " WHERE element_id=?"
            args.append(element_id)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self.db.execute(sql, args).fetchall()
        return [
            {
                "id": r["id"],
                "at": r["at"],
                "actor": r["actor"],
                "element_id": r["element_id"],
                "attribute": r["attribute"],
                "old": json.loads(r["old"]) if r["old"] else None,
                "new": json.loads(r["new"]),
                "reason": r["reason"],
                "note": r["note"],
            }
            for r in rows
        ]
