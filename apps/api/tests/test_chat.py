import json

from fastapi.testclient import TestClient
from townshiplens_api.main import app

KIOSK = "Can I push a stroller from Car Park B to the kiosk without stairs?"


def _stream(client, msg, profile="stroller"):
    events, data = [], []
    with client.stream("POST", "/chat", json={"message": msg, "profile": profile}) as r:
        assert r.status_code == 200
        for line in r.iter_lines():
            if line.startswith("event: "):
                events.append(line[7:])
            elif line.startswith("data: "):
                data.append(json.loads(line[6:]))
    return events, data


def _events(client, msg):
    return _stream(client, msg)[0]


def test_chat_sse_sequence():
    names = _events(TestClient(app), KIOSK)
    assert names[-1] == "done" and "verification.requested" in names
    assert "tool.call" in names and "error" not in names


def test_chat_twice_increments_demand():
    c = TestClient(app)
    _events(c, KIOSK)
    _events(c, KIOSK)
    assert c.get("/verification-requests").json()[0]["demand"] >= 2


def test_chat_data_matches_event_names():
    names, data = _stream(TestClient(app), KIOSK)
    assert [d["type"] for d in data] == names
    assert data[-1]["answer_status"] == "partial" and data[-1]["model"] == "mock-scripted"


def test_chat_flood_scenario_has_disclaimer_and_flooded_caveat():
    names, data = _stream(
        TestClient(app), "Is the playground safe during a flood of +3 m?", profile="default"
    )
    assert "disclaimer" in names and names[-1] == "done"
    text = "".join(d["delta"] for d in data if d["type"] == "text.delta").lower()
    assert "likely flooded" in text and " is safe" not in text
