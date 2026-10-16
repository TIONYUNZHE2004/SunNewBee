"""SSE chat events and scene intents. Single source of truth for FE↔AI (exported via OpenAPI)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

IntentKind = Literal[
    "camera.fly_to",
    "place.focus",
    "route.highlight",
    "flood.set_level",
    "layer.toggle",
    "whatif.diff",  # before/after lines of a what-if simulation (geojson attached by the server)
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
