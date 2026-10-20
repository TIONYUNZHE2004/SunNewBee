"""SSE chat events and scene intents. Single source of truth for FE↔AI (exported via OpenAPI)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field
from townshiplens_spatial.models import HHMM_PATTERN, JourneyPlan, RouteStatus

IntentKind = Literal[
    "camera.fly_to",
    "place.focus",
    "route.highlight",
    "flood.set_level",
    "layer.toggle",
    "whatif.diff",  # before/after lines of a what-if simulation (geojson attached by the server)
    "river.rollout",  # open and play the rising-river rollout (the client fetches /river-rollout)
    "day.show",  # open an Elmina Day rehearsal on the map, paused at `t_min` (server-added)
    "day.trip",  # a resident's own rehearsed trip: day.show plus the trip (geojson, server-built)
    "journey.play",  # play a planned route as a journey (JourneyPlan attached by the server)
]


# A scene intent as the model writes it in `final_answer` (no docstring: it would become part of
# the model's output schema). The server-built journey plan is not part of it, so the model never
# writes one and its large schema stays out of the model's prompt. run.py turns each one into a
# `SceneIntent`, the wire model.
class AnswerSceneIntent(BaseModel):
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
    route_status: RouteStatus | None = None  # the engine's statuses, incl. likely_ok (T-020)
    distance_m: float | None = None
    est_minutes: float | None = None
    day: str | None = None  # day.show: weekday | storm | event | friday
    t_min: int | None = None  # day.show: the rehearsal clock, minutes after midnight
    # journey.play: the local time the walk starts ("HH:MM"), with route_id from plan_route.
    start_time: str | None = Field(default=None, pattern=HHMM_PATTERN)


class SceneIntent(AnswerSceneIntent):
    """A scene intent on the wire (SSE `scene.intent`)."""

    # Attached by the server for journey.play from the route plan_route returned this turn
    # (townshiplens_spatial.journey.build_journey); never set by the model.
    journey: JourneyPlan | None = None


class TextDelta(BaseModel):
    type: Literal["text.delta"] = "text.delta"
    delta: str


class AnswerDraft(BaseModel):
    """Provisional summary text while the model writes its answer. Not checked yet: the client
    shows it as a draft and replaces it with the validated `text.delta` stream."""

    type: Literal["answer.draft"] = "answer.draft"
    attempt: int
    delta: str


class AnswerCheck(BaseModel):
    """The validator's verdict on one answer attempt: accepted, or sent back with readable
    reasons (the model then rewrites it). `repairs` counts fact-free fixes applied first."""

    type: Literal["answer.check"] = "answer.check"
    attempt: int
    ok: bool
    issues: list[str] = Field(default_factory=list)
    repairs: int = 0


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
    lens: Literal["flood", "whatif"] = "flood"
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
    | AnswerDraft
    | AnswerCheck
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
    # A random per-tab id (the web client mints it) keying short in-memory follow-up context.
    session_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{8,64}$")
    # Which screen asks (T-023): the management panel gets every tool and no topic refusal; the
    # resident panel keeps ASSISTANT_SCOPE.
    panel: Literal["resident", "management"] = "resident"
