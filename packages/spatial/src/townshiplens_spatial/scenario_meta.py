"""Provenance label for flood-scenario evidence.

Lives in its own module because `routing` needs it and `flood` imports `routing` at module level.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .world import World


def scenario_source(world: World, scenario_id: str | None) -> str:
    """Describe the scenario's actual method, e.g. "REM scenario (indicative)"."""
    s = next((s for s in world.flood.scenarios if s.id == scenario_id), None)
    return f"{s.method} scenario (indicative)" if s else "flood scenario (indicative)"
