"""T-024: answers call a place flooded or cut off only when affected_places returned it so."""

import pytest
from townshiplens_agent.answer import Claim, FinalAnswer
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.run import FLASH_FLOOD_NOTE, flash_flood_note
from townshiplens_agent.validate import flood_impact_errors

PLACES = {
    "playground": {"name": "Urban Park playground", "aliases": [], "type": "playground"},
    "bench-3": {"name": "Urban Park bench 3", "aliases": [], "type": "seating"},
    "mall": {"name": "Elmina Lakeside Mall", "aliases": [], "type": "mall"},
}


def _rec() -> TurnRecord:
    rec = TurnRecord(scenarios_used={"stage_p3m"})
    rec.place_entities = PLACES
    rec.affected.append(
        {
            "likely_place_count": 1,
            "flooded": {"playground": "Urban Park playground"},
            "possible": {},
            "cut_off": {"bench-3": "Urban Park bench 3"},
        }
    )
    return rec


def _ans(summary: str) -> FinalAnswer:
    return FinalAnswer(
        answer_status="answered",
        summary=summary,
        scenario_id="stage_p3m",
        claims=[Claim(text="Scenario", status="indicative", evidence_ids=["ev-scn-stage_p3m"])],
    )


@pytest.mark.parametrize(
    "summary",
    [
        "Urban Park playground is likely flooded and Urban Park bench 3 is cut off.",
        "Cut off, no mapped way in or out (indicative): Urban Park bench 3.",
        "Elmina Lakeside Mall is not cut off in this scenario.",  # a negation claims nothing
        "Taman Urban Park bench 3 terputus dalam senario indikatif ini.",
    ],
)
def test_returned_places_may_be_called_flooded_or_cut_off(summary):
    assert flood_impact_errors(_ans(summary), _rec()) == []


@pytest.mark.parametrize(
    "summary",
    [
        "Elmina Lakeside Mall is cut off at River +3 m.",
        "Elmina Lakeside Mall is likely flooded in this indicative scenario.",
        "Urban Park playground is cut off.",  # flooded, but the tool did not say cut off
        "Elmina Lakeside Mall 被切断。",
    ],
)
def test_a_flooded_or_cut_off_claim_the_tool_did_not_return_is_rejected(summary):
    errs = flood_impact_errors(_ans(summary), _rec())
    assert errs and "did not return these as flooded or cut off" in errs[0]


def test_flash_flood_line_follows_language_and_is_not_repeated():
    ans = _ans("Urban Park playground is likely flooded.")
    assert flash_flood_note(ans, _rec()) == FLASH_FLOOD_NOTE["en"]
    assert flash_flood_note(ans, _rec(), "ms") == FLASH_FLOOD_NOTE["ms"]
    said = ans.model_copy(update={"caveats": ["Flash floods from heavy rain are not shown."]})
    assert flash_flood_note(said, _rec()) is None
    no_river = _ans("Route found.").model_copy(update={"scenario_id": None})
    assert flash_flood_note(no_river, TurnRecord()) is None
