# ruff: noqa: E501
import pytest
from pydantic_ai import ModelRetry
from tests_support import TINY
from townshiplens_agent import agent, template
from townshiplens_agent.answer import FinalAnswer
from townshiplens_agent.events import ChatRequest, SceneIntent
from townshiplens_agent.record import TurnRecord
from townshiplens_agent.route_binding import (
    RouteSelectionError,
    bound_measurement_errors,
    effective_profile,
    effective_scenario,
    guard_endpoints,
    guard_origin,
)
from townshiplens_agent.run import _answer_events
from townshiplens_agent.validate import validate_answer
from townshiplens_spatial import tools
from townshiplens_spatial.models import Place
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world


def context():
    return tools.Ctx(load_world(TINY), VerificationStore(":memory:"))


@pytest.mark.parametrize(
    "question,mode",
    [
        ("Find a nearby toilet", "wheelchair"),
        ("Can I push a stroller?", "stroller"),
        ("Boleh saya guna kerusi roda?", "wheelchair"),
        ("我用轮椅去游乐场", "wheelchair"),
        ("Can I drive there?", "drive"),
    ],
)
def test_profile_follows_request_and_explicit_mode(question, mode):
    assert effective_profile(question, "wheelchair") == mode


def test_silent_walking_downgrade_is_rejected():
    with pytest.raises(RouteSelectionError, match="do not substitute"):
        effective_profile("Find a toilet for my wheelchair", "wheelchair", "default")


async def test_amenity_default_uses_wheelchair_not_stairs():
    ctx = context()
    deps = agent.Deps(
        ctx, TurnRecord(), ChatRequest(message="Find a toilet within 150 m", profile="wheelchair")
    )
    result = await agent.call_tool(
        deps, "nearby_amenities", origin_id="park-b", amenity="toilet", max_walk_m=150
    )
    assert result["data"] == []
    assert not any("default profile" in w for w in result["warnings"])


@pytest.mark.parametrize(
    "question",
    [
        "From Car Park B to the playground",
        "Dari Car Park B ke taman permainan",
        "从Car Park B到游乐场",
    ],
)
def test_generic_playground_cannot_be_a_distant_name_match(question):
    world = context().world
    world.places["far-playground"] = Place(
        id="far-playground", type="playground", name="Taman Permainan", coord=[102, 4]
    )
    with pytest.raises(RouteSelectionError, match="local playground"):
        guard_endpoints(world, question, {"from_id": "park-b", "to_id": "far-playground"})
    guard_endpoints(world, question, {"from_id": "park-b", "to_id": "playground"})


def test_ambiguous_generic_place_requires_clarification():
    world = context().world
    world.places["another"] = world.places["playground"].model_copy(
        update={"id": "another", "name": "Another playground"}
    )
    with pytest.raises(RouteSelectionError, match="Which playground"):
        guard_endpoints(
            world, "From Car Park B to the playground", {"from_id": "park-b", "to_id": "playground"}
        )


async def test_wrong_named_route_never_calls_engine_or_files_tickets():
    ctx = context()
    deps = agent.Deps(
        ctx, TurnRecord(), ChatRequest(message="From Car Park B to Park toilet", profile="stroller")
    )
    with pytest.raises(ModelRetry, match="exact place"):
        await agent.call_tool(
            deps, "plan_route", from_id="park-b", to_id="playground", profile="stroller"
        )
    assert not deps.rec.routes
    assert ctx.vrs.list("all") == []
    answer = template.template_answer(deps.rec, deps.request.message)
    assert answer.answer_status == "cannot_answer"
    assert not [e for e in _answer_events(answer, deps.rec, ctx) if e.type == "scene.intent"]


async def test_exact_place_measurement_cannot_borrow_same_category_distance():
    # Two distinct worship places and two routes with the same entity category.
    rec = TurnRecord()
    rec.place_entities = {
        "a": {"name": "Surau Al Mahdi"},
        "b": {"name": "Surau At Taqwa"},
        "c": {"name": "Surau Rentak Perdana"},
    }
    rec.measurement_subjects = [
        {"place_ids": ["a", "b"], "values": {"length": {363.8}, "time": {5.2}}}
    ]
    wrong = FinalAnswer(
        answer_status="partial",
        summary="From Surau Rentak Perdana to Surau At Taqwa, the route is 363.8 m.",
    )
    assert bound_measurement_errors(wrong, rec)
    right = wrong.model_copy(
        update={"summary": "From Surau Al Mahdi to Surau At Taqwa, the route is about 360 m."}
    )
    assert bound_measurement_errors(right, rec) == []
    rec.measurement_subjects.append({"place_ids": ["c", "b"], "values": {"length": {800}}})
    assert bound_measurement_errors(wrong, rec)  # correct identity, wrong value still fails


def test_map_cannot_draw_a_different_returned_route():
    ctx = context()
    rec = TurnRecord(tool_calls=["plan_route"])
    rec.routes = {
        "a": {"id": "a", "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}},
        "b": {"id": "b", "geometry": {"type": "LineString", "coordinates": [[1, 1], [2, 2]]}},
    }
    rec.route_status = {"a": "confirmed", "b": "confirmed"}
    ans = FinalAnswer(
        answer_status="partial",
        summary="Route found",
        route_id="a",
        scene_intents=[SceneIntent(kind="route.highlight", route_id="b")],
    )
    assert any("map route" in e for e in validate_answer(ans, rec))
    assert not [e for e in _answer_events(ans, rec, ctx) if e.type == "scene.intent"]


def test_unknown_endpoint_cannot_fall_back_to_demo_place():
    with pytest.raises(RouteSelectionError, match="exact name"):
        guard_endpoints(
            context().world, "From Car Park B to Mars", {"from_id": "park-b", "to_id": "playground"}
        )


def test_followup_keeps_exact_previous_route():
    with pytest.raises(RouteSelectionError, match="previous route"):
        guard_endpoints(
            context().world,
            "And if the river rises?",
            {"from_id": "park-b", "to_id": "toilet-1"},
            context={"from_place": "park-b", "to_place": "playground"},
            strict=True,
        )


def test_unknown_named_clinic_cannot_be_treated_as_any_nearby_clinic():
    with pytest.raises(RouteSelectionError, match="exact name"):
        guard_endpoints(
            context().world,
            "From Car Park B to Everspring Clinic",
            {"from_id": "park-b", "to_id": "playground"},
        )


def test_nearby_origin_cannot_be_silently_substituted():
    with pytest.raises(RouteSelectionError, match="exact named starting"):
        guard_origin(context().world, "Find a toilet near Car Park B", "lakeside-mall", strict=True)


def test_active_flood_cannot_be_overridden_by_a_model_baseline():
    world = context().world
    assert (
        effective_scenario("From Car Park B to the playground", world, "stage_p3m") == "stage_p3m"
    )
    with pytest.raises(RouteSelectionError, match="do not substitute baseline"):
        effective_scenario("From Car Park B to the playground", world, "stage_p3m", "baseline")
    assert (
        effective_scenario(
            "Without flooding, from Car Park B to the playground", world, "stage_p3m", "baseline"
        )
        == "baseline"
    )
    assert (
        effective_scenario("If the river rises 5 m", world, "stage_p3m", "stage_p5m") == "stage_p5m"
    )


def test_negated_driving_does_not_override_selected_wheelchair_mode():
    assert (
        effective_profile("I am not driving. Find a route for my wheelchair", "wheelchair")
        == "wheelchair"
    )


@pytest.mark.parametrize(
    "text",
    [
        "This route is step-free.",
        "Staff checked this route.",
        "This route is wheelchair accessible.",
        "这条路线已核实。",
        "Laluan ini disahkan.",
    ],
)
def test_estimates_reject_positive_physical_claims(text):
    from townshiplens_agent.route_binding import estimate_text_errors

    rec = TurnRecord(routes={"r": {"status": "likely_ok"}})
    assert estimate_text_errors(text, rec)


@pytest.mark.parametrize(
    "text",
    [
        "Estimated from map data, not checked.",
        "Anggaran daripada peta, belum diperiksa.",
        "基于地图数据估计，尚未核实。",
    ],
)
def test_estimate_qualifiers_keep_negation(text):
    from townshiplens_agent.route_binding import estimate_text_errors, has_estimate_qualifier

    rec = TurnRecord(routes={"r": {"status": "likely_ok"}})
    assert estimate_text_errors(text, rec) == []
    assert has_estimate_qualifier(text)


async def test_amenity_radius_cannot_be_widened_by_the_model():
    ctx = context()
    deps = agent.Deps(
        ctx,
        TurnRecord(),
        ChatRequest(message="Find a toilet within 150 m of Car Park B", profile="wheelchair"),
    )
    with pytest.raises(ModelRetry, match="do not widen"):
        await agent.call_tool(
            deps, "nearby_amenities", origin_id="park-b", amenity="toilet", max_walk_m=300
        )


def test_empty_amenity_search_cannot_recommend_a_find_place_candidate():
    from townshiplens_agent.route_binding import amenity_selection_errors, entities

    rec = TurnRecord(
        place_entities=entities(context().world),
        amenity_searches=[{"origin_id": "park-b", "amenity": "toilet", "ids": []}],
    )
    assert amenity_selection_errors(
        FinalAnswer(answer_status="answered", summary="Check Park toilet instead."), rec
    )
    assert not amenity_selection_errors(
        FinalAnswer(
            answer_status="answered", summary="No matching toilet route was found from Car Park B."
        ),
        rec,
    )


def test_feature_amenity_search_does_not_reject_the_answered_route_endpoints():
    from townshiplens_agent.route_binding import amenity_selection_errors, entities

    rec = TurnRecord(
        place_entities=entities(context().world),
        amenity_searches=[{"origin_id": "park-b", "amenity": "elevator", "ids": []}],
    )
    assert not amenity_selection_errors(
        FinalAnswer(
            answer_status="partial",
            summary="From Car Park B to Urban Park playground, there is a partly unverified route.",
        ),
        rec,
    )


@pytest.mark.parametrize(
    "question,mode",
    [
        ("Saya naik kereta dari Car Park B ke mall", "drive"),
        ("Saya jalan kaki dari Car Park B ke mall", "default"),
        ("我坐车从Car Park B到mall", "drive"),
        ("I am walking from Car Park B to the mall.", "default"),
    ],
)
def test_explicit_mode_overrides_previous_ui_choice(question, mode):
    assert effective_profile(question, "wheelchair") == mode


def test_generic_walking_word_does_not_remove_older_adult_rest_constraint():
    assert (
        effective_profile(
            "My father needs to rest often. Can he walk to the mall?", "older_adult_rest"
        )
        == "older_adult_rest"
    )


@pytest.mark.parametrize(
    "text", ["Find a toilet within 0.15 km", "Find a toilet within 150 metres", "找150米以内的厕所"]
)
def test_search_radius_uses_the_shared_measurement_units(text):
    from townshiplens_agent.route_binding import requested_radius

    assert requested_radius(text) == 150


def test_map_flood_level_must_match_the_checked_route():
    rec = TurnRecord(
        routes={"r": {"id": "r", "status": "partly_unverified", "scenario_id": "stage_p3m"}},
        route_status={"r": "partly_unverified"},
        scenarios_used={"stage_p3m"},
    )
    ans = FinalAnswer(
        answer_status="partial",
        summary="A mapped route.",
        route_id="r",
        scenario_id="stage_p3m",
        scene_intents=[SceneIntent(kind="flood.set_level", scenario_id="baseline")],
    )
    assert any("map flood scenario" in e for e in validate_answer(ans, rec))
    assert not [e for e in _answer_events(ans, rec, context()) if e.type == "scene.intent"]
    ans.scenario_id = "stage_p5m"
    assert any("answer scenario" in e for e in validate_answer(ans, rec))


# AI cross-check 20 Oct (evals/audits/2026-10-20-route-binding): honest phrasings the guards
# blocked, and the dishonest selections they must still block.
from townshiplens_agent.route_binding import RouteSelectionError as _RSE  # noqa: E402
from townshiplens_agent.route_binding import effective_profile as _profile  # noqa: E402
from townshiplens_agent.route_binding import guard_endpoints as _guard  # noqa: E402
from townshiplens_agent.settings import ROOT as _ROOT  # noqa: E402

_SEED = _ROOT / "data/seed/elmina"
_MAHDI, _TAQWA = "osm-way-910405528", "osm-way-910378231"


@pytest.mark.parametrize(
    "question, ui, want",
    [
        ("My mum is not in a wheelchair, she walks with a stick.", "default", "default"),
        ("Saya tidak guna kerusi roda.", "wheelchair", "default"),
        ("我不坐轮椅，走路去。", "wheelchair", "default"),
        (
            "Can my father in a wheelchair go there, and are there rest points?",
            "wheelchair",
            "wheelchair",
        ),
        ("A route with rest points for my grandmother", "default", "older_adult_rest"),
        ("Push a stroller there", "default", "stroller"),
    ],
)
def test_mode_words_respect_negation_and_rest_points(question, ui, want):
    assert _profile(question, ui) == want


@pytest.mark.parametrize(
    "question, supplied",
    [
        ("Is the wheelchair route from A to B ok?", "default"),  # named mode, walking substituted
        ("Wheelchair or stroller to B", None),  # "or" is allowed, but walking is not
    ],
)
def test_named_mode_cannot_be_replaced_by_walking(question, supplied):
    with pytest.raises(_RSE):
        _profile(question, "default", supplied or "default")


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "question",
    [
        "Take me to Surau At Taqwa, starting at Surau Al Mahdi.",
        "I'm at Surau Al Mahdi. Is Surau At Taqwa reachable on foot?",
        "How far is Surau At Taqwa from Surau Al Mahdi?",
    ],
)
def test_both_named_endpoints_are_accepted(question):
    world = load_world(_SEED)
    _guard(world, question, {"from_id": _MAHDI, "to_id": _TAQWA}, strict=True)


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "question, args",
    [
        (
            "Take me to Surau At Taqwa, starting at Surau Al Mahdi.",
            {"from_id": "park-b", "to_id": _TAQWA},
        ),
        (
            "I'm at Surau Al Mahdi. Is Surau At Taqwa reachable?",
            {"from_id": _MAHDI, "to_id": "playground"},
        ),
        ("How far is it?", {"from_id": _MAHDI, "to_id": _TAQWA}),  # nothing named, no context
    ],
)
def test_substituted_or_unnamed_endpoints_are_still_blocked(question, args):
    world = load_world(_SEED)
    with pytest.raises(_RSE):
        _guard(world, question, args, strict=True)


# T-022: sloppy names in route questions, and no derived alias that is another place's name.
from townshiplens_agent.route_binding import entities as _entities  # noqa: E402

_SK, _SURAU_SK = "osm-way-894147407", "osm-way-910352168"


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
def test_derived_alias_never_equals_another_place_name():
    reg = _entities(load_world(_SEED))
    assert "SK Taman Bukit Subang" not in reg[_SURAU_SK]["aliases"]


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "question, args",
    [
        ("How do I walk from surau al mahdi to sk taman?", {"from_id": _MAHDI, "to_id": _SK}),
        (
            "Dari Surau Al Mahdi ke surau at takwa, boleh jalan kaki?",
            {"from_id": _MAHDI, "to_id": _TAQWA},
        ),
        ("from SK TAMAN BKT SUBANG to surau at takwa", {"from_id": _SK, "to_id": _TAQWA}),
        # live round 6: "subang走到surau" was one word, so neither name was found
        ("从SK TAMAN BKT SUBANG走到surau at takwa怎么走？", {"from_id": _SK, "to_id": _TAQWA}),
        (
            "from surau al mahdi to surau sk taman bukit subang",
            {"from_id": _MAHDI, "to_id": _SURAU_SK},
        ),
    ],
)
def test_sloppy_names_bind_to_the_named_place(question, args):
    _guard(load_world(_SEED), question, args, strict=True)


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
def test_one_loose_word_in_a_sentence_is_not_a_place_name():
    """ "free" is one typo from "Green" (Elmina Green One Park); "kaki" from two place words."""
    from townshiplens_agent.route_binding import fuzzy_mentions

    assert fuzzy_mentions(load_world(_SEED), "Is it step-free? Boleh jalan kaki?") == (set(), [])


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
@pytest.mark.parametrize(
    "question, args",
    [
        ("from sk taman to surau at takwa", {"from_id": _SK, "to_id": _MAHDI}),  # wrong place
        (
            "Dari Lakeside Mall Car Park B ke taman permainan",
            {"from_id": "park-b", "to_id": "osm-way-781364799"},
        ),
    ],
)
def test_wrong_ambiguous_or_generic_names_are_not_taken(question, args):
    """A different place, and the generic 'taman permainan' (playground near the start), never
    bind to the typed words."""
    with pytest.raises(_RSE):
        _guard(load_world(_SEED), question, args, strict=True)


@pytest.mark.skipif(not (_SEED / "site.json").exists(), reason="Elmina seed not built")
def test_two_places_with_one_name_make_the_guard_ask_which_one():
    """T-022 rule 5 with a same-name twin (the cleanup removed the real second Klinik Siti)."""
    from townshiplens_spatial.models import Place

    world = load_world(_SEED)
    one = next(p for p in world.places.values() if p.name == "Klinik Siti")
    twin = Place(id="klinik-siti-2", type="clinic", name="Klinik Siti", coord=[101.474, 3.207])
    twin.node_id = one.node_id
    world.places[twin.id] = twin
    args = {"from_id": _MAHDI, "to_id": one.id}
    with pytest.raises(_RSE, match="Klinik Siti"):
        _guard(world, "from Surau Al Mahdi to klinik siti", args, strict=True)
