import asyncio
from dataclasses import dataclass, field

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
    queue: asyncio.Queue | None = None
