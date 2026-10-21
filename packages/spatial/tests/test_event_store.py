import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from townshiplens_spatial.closure_store import ClosureStore

START = datetime(2030, 10, 27, 23, tzinfo=UTC)


def test_event_course_transaction_rolls_back_every_segment_on_insert_failure(tmp_path):
    store = ClosureStore(str(tmp_path / "events.db"))
    store.db.execute("""CREATE TRIGGER reject_course BEFORE INSERT ON closures
        WHEN NEW.element_id = 'seg-bc' BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        store.create_many(
            element_ids=["seg-ab", "seg-bc"],
            reason="event",
            starts_at=START,
            ends_at=START + timedelta(hours=4),
            note=None,
            event_name="Marathon",
        )
    assert store.list() == []


def test_existing_closure_database_migrates_without_losing_rows(tmp_path):
    path = str(tmp_path / "legacy.db")
    with sqlite3.connect(path) as db:
        db.execute("""CREATE TABLE closures (
            id TEXT PRIMARY KEY, element_id TEXT NOT NULL, reason TEXT NOT NULL,
            starts_at TEXT NOT NULL, ends_at TEXT, note TEXT, created_by TEXT NOT NULL,
            source TEXT NOT NULL, created_at TEXT NOT NULL)""")
        db.execute(
            "INSERT INTO closures VALUES (?,?,?,?,?,?,?,?,?)",
            (
                "cl-0001",
                "seg-ab",
                "works",
                START.isoformat(),
                None,
                "Private note",
                "staff",
                "staff_report",
                START.isoformat(),
            ),
        )
    store = ClosureStore(path)
    assert store.get("cl-0001").note == "Private note"
    assert store.get("cl-0001").event_name is None
    row = store.create(
        element_id="seg-bc",
        reason="event",
        starts_at=START,
        ends_at=START + timedelta(hours=4),
        note=None,
        event_name="Marathon",
    )
    assert row.id == "cl-0002" and row.event_name == "Marathon"
