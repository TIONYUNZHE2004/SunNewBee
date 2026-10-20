import asyncio
from dataclasses import dataclass, field

from pydantic_ai.usage import RunUsage
from townshiplens_spatial.devsim_models import DevelopmentPlan
from townshiplens_spatial.models import Evidence, JourneyPlan


@dataclass
class TurnRecord:
    evidence: dict[str, Evidence] = field(default_factory=dict)
    routes: dict[str, dict] = field(default_factory=dict)
    route_status: dict[str, str] = field(default_factory=dict)
    # The journey plan of each route above (journeys.plan_for, built in call_tool from the world
    # and the tool's route): the validator checks journey.play and the answer's rest and
    # unchecked-place counts against it, never against model text. Missing when it can't be built.
    journeys: dict[str, JourneyPlan] = field(default_factory=dict)
    scenarios_used: set[str] = field(default_factory=set)
    vrs: list[dict] = field(default_factory=list)
    tool_calls: list[str] = field(default_factory=list)
    # True once a validator rejection moved the turn to the escalation model (build_agent).
    escalated: bool = False
    # Wall-clock seconds spent inside each spatial tool this turn (summed per tool name), so an
    # eval can split a slow turn into engine time and model time.
    tool_seconds: dict[str, float] = field(default_factory=dict)
    # Every number the model was shown by a tool this turn, by unit ("m", "min", "pct", "any";
    # ids and geometry excluded): an answer may quote a distance, time or slope only if it is one
    # of these, or a rounding of one in the same unit (validate.measurement_errors).
    tool_measures: dict[str, set[float]] = field(default_factory=dict)
    # River stages the resident named in the question ("if the river rises 10 m"): a refusal may
    # repeat them ("no scenario for +10 m"); no other fact may come from the question.
    asked_stages: set[float] = field(default_factory=set)
    # Route endpoints inside a flooded area under the active scenario:
    # place_id -> {"flood_class", "name", "scenario_id"}
    flooded_endpoints: dict[str, dict] = field(default_factory=dict)
    # Names of places/centres the tools returned: stripped before the flood-wording check, so a
    # place called "Taman Selamat" can still be named in a caveat.
    place_names: set[str] = field(default_factory=set)
    # Server-resolved entity IDs, not category words, bind measurements to the right place.
    place_entities: dict[str, dict] = field(default_factory=dict)
    measurement_subjects: list[dict] = field(default_factory=list)
    centre_options: list[dict] = field(default_factory=list)
    amenity_searches: list[dict] = field(default_factory=list)
    selection_error: str | None = None
    strict_selection: bool = False
    context_route: dict | None = None
    # Staff-reported closures plan_route says affect a route (rows with element_name, impact), and
    # every closure row any tool returned this turn (id -> row).
    route_closures: list[dict] = field(default_factory=list)
    closures: dict[str, dict] = field(default_factory=dict)
    # Active closures get_closures returned for the place asked about (all of them when no place
    # was given): the answer must name them and must not call the place open.
    asked_closures: list[dict] = field(default_factory=list)
    # Plan_route warnings about endpoints whose entrance is not mapped (Task 43).
    inferred_notes: list[str] = field(default_factory=list)
    # plan_route warnings by the route they describe (the first route of each call); the
    # answer always keeps the mandatory ones (run.MANDATORY_WARNING, T-021 review).
    route_warnings: dict[str, list[str]] = field(default_factory=dict)
    # simulate_what_if results this turn (tool data, incl. diff_geojson and "imagined").
    what_ifs: list[dict] = field(default_factory=list)
    # An earlier turn of this session ran a simulation (from memory): its numbers may not be
    # repeated unless re-simulated this turn.
    history_simulated: bool = False
    # plan_verifications results this turn (survey plans: facts, places, summary).
    plans: list[dict] = field(default_factory=list)
    # rising_river_rollout / river_tipping_point results this turn (Cycle 3).
    rollouts: list[dict] = field(default_factory=list)
    tippings: list[dict] = field(default_factory=list)
    fixes: list[dict] = field(default_factory=list)  # find_fixes results (Cycle 4)
    # day_rehearsal results this turn (Elmina Day, Cycle 14): synthetic residents' simulated day.
    days: list[dict] = field(default_factory=list)
    day_stages: set[str] = field(default_factory=set)  # river stages a rehearsal chose
    day_changes: list[dict] = field(default_factory=list)  # imagined changes tested on a day
    my_trips: list[dict] = field(default_factory=list)  # residents' own rehearsed trips
    # simulate_development results this turn (developer lens): the tool's data without the plan
    # (brief numbers, facts, "available"), and the plan itself for the development.play intent.
    developments: list[dict] = field(default_factory=list)
    development_plan: DevelopmentPlan | None = None
    # affected_places counts this turn: places and path segments apart (Cycles 5-6 review B1).
    affected: list[dict] = field(default_factory=list)
    # Diagnostics (never shown to users, never stored): the validator's errors for each rejected
    # final_answer attempt, and token usage across all model requests of the turn.
    validator_errors: list[list[str]] = field(default_factory=list)
    repairs: list[str] = field(default_factory=list)  # validate.repair_answer notes
    checks: int = 0  # final_answer attempts judged (validator, or a schema failure)
    draft_attempt: int = 0  # final_answer attempts the draft streamer has started
    usage: RunUsage = field(default_factory=RunUsage)
    queue: asyncio.Queue | None = None
