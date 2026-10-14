import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .models import VerificationRequest

SCHEMA = """CREATE TABLE IF NOT EXISTS vr (
  id TEXT PRIMARY KEY, element_id TEXT, attribute TEXT, reason TEXT, status TEXT,
  demand INTEGER, question_summary TEXT, created_at TEXT, resolved_at TEXT, resolution TEXT)"""


class VerificationStore:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute(SCHEMA)

    def _row(self, r: sqlite3.Row) -> VerificationRequest:
        d = dict(r)
        d["resolution"] = json.loads(d["resolution"]) if d["resolution"] else None
        return VerificationRequest.model_validate(d)

    def request(
        self, element_id: str, attribute: str, reason: str, question_summary: str | None = None
    ) -> tuple[VerificationRequest, bool]:
        with self.db:
            r = self.db.execute(
                "SELECT * FROM vr WHERE element_id=? AND attribute=? AND reason=? "
                "AND status='open'",
                (element_id, attribute, reason),
            ).fetchone()
            if r:
                self.db.execute("UPDATE vr SET demand = demand + 1 WHERE id=?", (r["id"],))
                row = self.db.execute("SELECT * FROM vr WHERE id=?", (r["id"],)).fetchone()
                return self._row(row), False
            n = self.db.execute("SELECT COUNT(*) FROM vr").fetchone()[0] + 1
            vr_id = f"vr-{n:04d}"
            self.db.execute(
                "INSERT INTO vr VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    vr_id,
                    element_id,
                    attribute,
                    reason,
                    "open",
                    1,
                    question_summary,
                    datetime.now(UTC).isoformat(),
                    None,
                    None,
                ),
            )
            return self._row(
                self.db.execute("SELECT * FROM vr WHERE id=?", (vr_id,)).fetchone()
            ), True

    def list(self, status: str = "open") -> list[VerificationRequest]:
        rows = self.db.execute(
            "SELECT * FROM vr WHERE status=? ORDER BY demand DESC, created_at ASC", (status,)
        )
        return [self._row(r) for r in rows]

    def resolve(self, vr_id: str, action: str, value=None, note: str = "") -> VerificationRequest:
        status = "rejected" if action == "reject" else "resolved"
        with self.db:
            cur = self.db.execute("SELECT status FROM vr WHERE id=?", (vr_id,)).fetchone()
            if cur is None:
                raise KeyError(vr_id)
            if cur["status"] not in ("open", "in_progress"):
                raise ValueError(f"{vr_id} is already {cur['status']}")
            self.db.execute(
                "UPDATE vr SET status=?, resolved_at=?, resolution=? WHERE id=?",
                (
                    status,
                    datetime.now(UTC).isoformat(),
                    json.dumps({"action": action, "value": value, "note": note}),
                    vr_id,
                ),
            )
        return self._row(self.db.execute("SELECT * FROM vr WHERE id=?", (vr_id,)).fetchone())
