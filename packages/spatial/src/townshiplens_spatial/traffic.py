"""Assumed destination/time weights and road-class pressure, never traffic counts."""

from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from .models import site_tz

CONFIG = Path(__file__).resolve().parents[4] / "config/traffic/peak_weights.yaml"


class Peak(BaseModel):
    types: list[str]
    days: list[int]
    windows: list[tuple[str, str]]
    weight: float = Field(gt=0)


class Bands(BaseModel):
    low_below: float
    high_above: float


class TrafficConfig(BaseModel):
    weights_note: str
    default_weight: float = Field(gt=0)
    peaks: list[Peak]
    capacity: dict[str, float]
    bands: Bands


@lru_cache(maxsize=1)
def config() -> TrafficConfig:
    return TrafficConfig.model_validate(yaml.safe_load(CONFIG.read_text()))


def trip_weight(destination_type: str, at: datetime, timezone: str | None) -> float:
    """Start inclusive, end exclusive; overlapping assumptions use the largest weight."""
    local = at.astimezone(site_tz(timezone))
    clock = local.strftime("%H:%M")
    table = config()
    return max(
        [table.default_weight]
        + [
            peak.weight
            for peak in table.peaks
            if destination_type in peak.types
            and local.weekday() in peak.days
            and any(start <= clock < end for start, end in peak.windows)
        ]
    )


def pressure(weighted_trips: float, road_class: str) -> Literal["low", "medium", "high"]:
    table = config()
    ratio = weighted_trips / table.capacity.get(road_class, table.capacity["others"])
    return (
        "low"
        if ratio < table.bands.low_below
        else "high"
        if ratio > table.bands.high_above
        else "medium"
    )
