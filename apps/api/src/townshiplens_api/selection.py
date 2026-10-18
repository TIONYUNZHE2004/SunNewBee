"""Validate profile/scenario selections before a request can produce baseline facts."""

from fastapi import HTTPException
from townshiplens_spatial.scenario_meta import selection_error
from townshiplens_spatial.world import World


def require_selection(world: World, profile: str, scenario_id: str | None = None) -> None:
    if error := selection_error(world, profile, scenario_id):
        raise HTTPException(404 if error.startswith("unknown scenario ") else 422, error)
