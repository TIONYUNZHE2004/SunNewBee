from typing import Literal

from pydantic import BaseModel, Field

from .events import AnswerSceneIntent


class Claim(BaseModel):
    text: str
    status: Literal["verified", "stale", "unverified", "unknown", "indicative"]
    evidence_ids: list[str] = Field(default_factory=list)


class FinalAnswer(BaseModel):
    """The forced final_answer. Every claim must cite evidence_ids returned by tools this turn."""

    answer_status: Literal["answered", "partial", "cannot_answer"]
    language: str = "en"
    summary: str
    steps: list[str] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    route_id: str | None = None
    scenario_id: str | None = None
    # Model-facing intents: the server attaches geometry, summaries and journey plans (run.py).
    scene_intents: list[AnswerSceneIntent] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list)
