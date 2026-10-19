"""Offline backend cross-check of maneuver claims in the published AI integration."""

import json
from pathlib import Path

from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.steps import maneuver_errors, maneuver_steps
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
            {
                "index": 4,
                "action": "arrive",
                "distance_m": 0,
                "street_name": None,
                "edge_type": "street",
                "access_level": "unknown",
            },
        ],
    }
    record = TurnRecord(tool_calls=["plan_route"])
    record.routes["rt-1"] = route
    record.route_status["rt-1"] = "likely_ok"
    record.evidence["ev-1"] = Evidence(
        id="ev-1", element_id="seg-1", attribute="access_point", value="n", status="reported"
    )
    cases = [
        ("model_correct_left_rejected_by_policy", "Turn left onto Persiaran Elmina.", True),
        ("model_correct_right_rejected_by_policy", "Turn right onto Jalan Maple.", True),
        (
            "descriptive_left_street_control",
            "It runs along Persiaran Elmina for 120.4 metres.",
            False,
        ),
        ("descriptive_right_street_control", "It runs along Jalan Maple for 11.8 metres.", False),
        ("wrong_street_turn_binding", "Turn right onto Persiaran Elmina.", True),
        ("invented_name_suffix", "Turn left onto Persiaran Elmina Secretshortcut.", True),
        ("unhandled_slight_turn", "Bear right onto Persiaran Elmina.", True),
        ("borrowed_step_distance", "Turn left onto Persiaran Elmina. Continue 11.8 metres.", True),
        ("invented_distance_control", "Turn left after 999 metres onto Persiaran Elmina.", True),
    ]
    results = []
    for name, text, reject in cases:
        answer = FinalAnswer(
            answer_status="partial",
            summary="The mapped route is likely OK, estimated from map data. " + text,
            route_id="rt-1",
            caveats=["Likely OK sections are estimated from map data, not checked on site."],
            claims=[Claim(text="Route", status="unverified", evidence_ids=["ev-1"])],
        )
        errors = validate_answer(answer, record)
        results.append(
            {
                "case": name,
                "text": text,
                "expected_rejected": reject,
                "rejected": bool(errors),
                "pass": bool(errors) == reject,
                "validator_errors": errors,
                "maneuver_errors": maneuver_errors(text, route),
            }
        )
    long = {
        "maneuvers": [dict(route["maneuvers"][0], index=i) for i in range(9)]
        + [dict(route["maneuvers"][-1], index=10)]
    }
    return {
        "cases": results,
        "long_route_notice": maneuver_steps(long)[-2],
        "long_route_limit": (
            "No maneuver list/map-step UI has been implemented in the frontend lane; "
            "do not claim hidden steps are shown there."
        ),
        "live_questions": 0,
        "cost_usd": 0,
    }


if __name__ == "__main__":
    output = probe()
    Path(__file__).with_suffix(".json").write_text(json.dumps(output, indent=2) + "\n")
    for row in output["cases"]:
        print(row["case"], "PASS" if row["pass"] else "FAIL", row["validator_errors"])
