"""Offline full-validator probes after AI c8f276d; no model or network calls.

Directions are correct only when street, action and distance belong to ONE maneuver.
These crafted cases are validator reproductions, not claims about a real seed route.
"""

import copy
import json
from pathlib import Path

from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial.models import Evidence


def probe():
    route = {
        "id": "rt-1",
        "status": "likely_ok",
        "distance_m": 172.2,
        "maneuvers": [
            {
                "index": 1,
                "action": "depart",
                "distance_m": 40,
                "street_name": None,
                "edge_type": "footway",
                "access_level": "likely_ok",
            },
            {
                "index": 2,
                "action": "turn_left",
                "distance_m": 120.4,
                "street_name": "Persiaran Elmina",
                "edge_type": "street",
                "access_level": "unknown",
            },
            {
                "index": 3,
                "action": "turn_right",
                "distance_m": 11.8,
                "street_name": "Jalan Maple",
                "edge_type": "street",
                "access_level": "unknown",
            },
            {"index": 4, "action": "arrive", "distance_m": 0, "street_name": None},
        ],
    }
    cases = [
        ("correct_left", "Turn left onto Persiaran Elmina. Continue 120.4 metres.", False, False),
        ("correct_right", "Turn right onto Jalan Maple. Continue 11.8 metres.", False, False),
        ("wrong_capitalized_control", "Turn right onto Persiaran Elmina.", True, False),
        ("wrong_lowercase", "Turn right onto persiaran elmina.", True, False),
        ("wrong_unnamed_stretch", "Turn right onto the footway.", True, False),
        (
            "wrong_same_street_distance",
            "Turn left onto Persiaran Elmina. Continue 11.8 metres.",
            True,
            True,
        ),
        (
            "correct_same_street_distance",
            "Turn left onto Persiaran Elmina. Continue 120.4 metres.",
            False,
            True,
        ),
    ]
    rows = []
    for name, text, reject, same_street in cases:
        selected = copy.deepcopy(route)
        if same_street:
            selected["maneuvers"][2]["street_name"] = "Persiaran Elmina"
        record = TurnRecord(tool_calls=["plan_route"])
        record.routes["rt-1"] = selected
        record.route_status["rt-1"] = "likely_ok"
        record.evidence["ev-1"] = Evidence(
            id="ev-1", element_id="seg-1", attribute="access_point", value="n", status="reported"
        )
        answer = FinalAnswer(
            answer_status="partial",
            summary="The mapped route is likely OK, estimated from map data. " + text,
            route_id="rt-1",
            caveats=["Likely OK sections are estimated from map data, not checked on site."],
            claims=[Claim(text="Route", status="unverified", evidence_ids=["ev-1"])],
        )
        errors = validate_answer(answer, record)
        rows.append(
            {
                "case": name,
                "text": text,
                "expected_rejected": reject,
                "rejected": bool(errors),
                "pass": bool(errors) == reject,
                "validator_errors": errors,
                "selected_route": selected,
            }
        )
    return {"cases": rows, "live_questions": 0, "cost_usd": 0}


if __name__ == "__main__":
    result = probe()
    Path(__file__).with_suffix(".json").write_text(json.dumps(result, indent=2) + "\n")
    for row in result["cases"]:
        print(row["case"], "PASS" if row["pass"] else "FAIL", row["validator_errors"])
