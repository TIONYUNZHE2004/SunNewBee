from pathlib import Path

from townshiplens_spatial.devsim_models import DevelopmentPlan

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "apps/web/src/features/devsim/fixtures/plan.provisional.json"
)


def test_provisional_fixture_validates():
    plan = DevelopmentPlan.model_validate_json(FIXTURE.read_text(encoding="utf-8"))
    assert plan.provisional is True
    assert plan.world == "elmina"
    assert plan.total_s == 66
    assert [a.name for a in plan.acts] == [
        "Brief",
        "Construction",
        "Handover",
        "Daily Life",
        "Summary",
    ]
    assert [b.n for b in plan.bubbles] == list(range(1, 8))
    assert plan.facts.detour is not None and plan.facts.detour.detour_side_switch
    assert {b.who for b in plan.bubbles} <= {c.id for c in plan.cast}
