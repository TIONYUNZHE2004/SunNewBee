"""SSE chat events and scene intents. Single source of truth for FE↔AI (exported via OpenAPI)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

IntentKind = Literal[
    "camera.fly_to", "place.focus", "route.highlight", "flood.set_level", "layer.toggle"
]


class SceneIntent(BaseModel):
    kind: IntentKind
    place_id: str | None = None
    route_id: str | None = None
    scenario_id: str | None = None
    center: list[float] | None = None  # [lon, lat]
    range_m: float | None = None
    lens: Literal["access", "flood", "waste"] | None = None
    visible: bool | None = None
    geojson: dict[str, Any] | None = None  # attached by the server for route.highlight
    # Attached by the server for route.highlight from the route plan_route returned this turn
    # (never set by the model): lets the UI show a summary without computing any fact.
    route_status: Literal["confirmed", "partly_unverified", "blocked", "no_data"] | None = None
    distance_m: float | None = None
    est_minutes: float | None = None


class TextDelta(BaseModel):
    type: Literal["text.delta"] = "text.delta"
    delta: str


class ToolCall(BaseModel):
    type: Literal["tool.call"] = "tool.call"
    id: str
    name: str
    args: dict[str, Any]


class ToolResultEvent(BaseModel):
    type: Literal["tool.result"] = "tool.result"
    id: str
    name: str
    summary: str


class SceneIntentEvent(BaseModel):
    type: Literal["scene.intent"] = "scene.intent"
    intent: SceneIntent


class Citation(BaseModel):
    type: Literal["citation"] = "citation"
    ref: int
    evidence_id: str
    element_id: str
    attribute: str
    status: str
    verified_at: str | None = None
    source_type: str | None = None
    photo_url: str | None = None


class Uncertainty(BaseModel):
    type: Literal["uncertainty"] = "uncertainty"
    level: Literal["none", "partial", "high"]
    items: list[dict[str, str]] = Field(default_factory=list)  # {element_id, attribute, note}


class Disclaimer(BaseModel):
    type: Literal["disclaimer"] = "disclaimer"
    lens: Literal["flood"] = "flood"
    text: str
    links: list[dict[str, str]] = Field(default_factory=list)


class VerificationRequested(BaseModel):
    type: Literal["verification.requested"] = "verification.requested"
    request_id: str
    element_id: str
    attribute: str
    created: bool
    demand: int
    # Why the check was asked for (the VR's reason); a demo replay files the same reason.
    reason: str | None = None


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


class Done(BaseModel):
    type: Literal["done"] = "done"
    message_id: str
    answer_status: str
    model: str


ChatEvent = Annotated[
    TextDelta
    | ToolCall
    | ToolResultEvent
    | SceneIntentEvent
    | Citation
    | Uncertainty
    | Disclaimer
    | VerificationRequested
    | ErrorEvent
    | Done,
    Field(discriminator="type"),
]


class ChatEventDoc(BaseModel):
    """Wrapper used only so that OpenAPI exports the ChatEvent union for the TS client."""

    event: ChatEvent


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    profile: Literal["default", "stroller", "wheelchair", "older_adult_rest", "drive"] = "default"
    # Constrained: it is interpolated into the agent's instructions (prompt-injection guard).
    scenario_id: str | None = Field(default=None, pattern=r"^(baseline|stage_p[1-5]m)$")
    session_id: str | None = None
