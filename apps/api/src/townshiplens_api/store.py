import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA = """CREATE TABLE IF NOT EXISTS sim_runs (
  run_id TEXT PRIMARY KEY, created_at TEXT, scenario_id TEXT, report TEXT)"""


class SimStore:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.execute(SCHEMA)
        self._lock = threading.RLock()

    def save(self, report: dict[str, Any]) -> None:
        with self._lock, self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO sim_runs VALUES (?,?,?,?)",
                (
                    report["run_id"],
                    report["created_at"],
                    report.get("scenario_id"),
                    json.dumps(report),
                ),
            )

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            r = self.db.execute("SELECT report FROM sim_runs WHERE run_id=?", (run_id,)).fetchone()
        return json.loads(r[0]) if r else None

    def recent(self, limit: int) -> list[dict[str, Any]]:
        with self._lock:
            rows = self.db.execute(
                "SELECT report FROM sim_runs ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [json.loads(r[0]) for r in rows]
