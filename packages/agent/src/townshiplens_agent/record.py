import asyncio
from dataclasses import dataclass, field

from pydantic_ai.usage import RunUsage
from townshiplens_spatial.models import Evidence


@dataclass
class TurnRecord:
    evidence: dict[str, Evidence] = field(default_factory=dict)
    routes: dict[str, dict] = field(default_factory=dict)
    route_status: dict[str, str] = field(default_factory=dict)
    scenarios_used: set[str] = field(default_factory=set)
    vrs: list[dict] = field(default_factory=list)
    tool_calls: list[str] = field(default_factory=list)
    # Route endpoints inside a flooded area under the active scenario:
    # place_id -> {"flood_class", "name", "scenario_id"}
    flooded_endpoints: dict[str, dict] = field(default_factory=dict)
    # Names of places/centres the tools returned: stripped before the flood-wording check, so a
    # place called "Taman Selamat" can still be named in a caveat.
    place_names: set[str] = field(default_factory=set)
    # Staff-reported closures plan_route says affect a route (rows with element_name, impact), and
    # every closure row any tool returned this turn (id -> row).
    route_closures: list[dict] = field(default_factory=list)
    closures: dict[str, dict] = field(default_factory=dict)
    # Active closures get_closures returned for the place asked about (all of them when no place
    # was given): the answer must name them and must not call the place open.
    asked_closures: list[dict] = field(default_factory=list)
    # Plan_route warnings about endpoints whose entrance is not mapped (Task 43).
    inferred_notes: list[str] = field(default_factory=list)
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
    # Diagnostics (never shown to users, never stored): the validator's errors for each rejected
    # final_answer attempt, and token usage across all model requests of the turn.
    validator_errors: list[list[str]] = field(default_factory=list)
    repairs: list[str] = field(default_factory=list)  # validate.repair_answer notes
    checks: int = 0  # final_answer attempts judged (validator, or a schema failure)
    draft_attempt: int = 0  # final_answer attempts the draft streamer has started
    usage: RunUsage = field(default_factory=RunUsage)
    queue: asyncio.Queue | None = None
