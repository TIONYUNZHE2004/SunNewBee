from townshiplens_spatial.models import Claim, Edge, RouteResult, ToolResult


def test_claim_unknown_has_no_value():
    c = Claim(value=None, status="unknown")
    assert c.status == "unknown" and c.value is None


def test_edge_roundtrip():
    e = Edge(
        id="seg-1",
        type="footway",
        from_node="n-1",
        to_node="n-2",
        coords=[[101.5, 3.18], [101.5001, 3.18]],
        length_m=11.1,
        claims={
            "step_count": Claim(
                value=0,
                status="verified",
                verified_at="2026-10-18",
                evidence_type="team_survey_placeholder",
            )
        },
    )
    assert Edge.model_validate(e.model_dump()).claims["step_count"].value == 0


def test_tool_result_defaults():
    r = ToolResult(ok=True, data={"x": 1})
    assert r.evidence == [] and r.warnings == []


def test_route_result_statuses():
    rr = RouteResult(status="no_data", routes=[], warnings=["unknown place"])
    assert rr.status == "no_data"
