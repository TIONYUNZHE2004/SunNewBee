import logging
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from townshiplens_agent.events import ChatEventDoc, ChatRequest, Done, ErrorEvent

from .. import state

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/schema/chat-event", response_model=ChatEventDoc, include_in_schema=True)
def chat_event_schema() -> ChatEventDoc:
    """Documentation-only endpoint so OpenAPI exports the ChatEvent union."""
    return ChatEventDoc(
        event={"type": "done", "message_id": "doc", "answer_status": "answered", "model": "doc"}
    )


class AssistantScope(BaseModel):
    """What the resident assistant covers (T-011): `access_flood` (the default) or `all`. The
    resident screen shows features outside access and flood, such as Rehearse my trip, only
    under `all`, so the screen and the assistant agree on what residents can ask about."""

    scope: Literal["access_flood", "all"]


@router.get("/assistant/scope", response_model=AssistantScope)
def assistant_scope() -> AssistantScope:
    from townshiplens_agent.settings import AgentSettings

    return AssistantScope(scope=AgentSettings().assistant_scope)


@router.post("/chat")
async def chat(req: ChatRequest):
    async def gen():
        try:
            from townshiplens_agent.run import run_turn
        except ImportError:
            for ev in (
                ErrorEvent(code="agent_unavailable", message="agent not installed"),
                Done(message_id="none", answer_status="cannot_answer", model="none"),
            ):
                yield {"event": ev.type, "data": ev.model_dump_json()}
            return
        try:
            async for ev in run_turn(state.get_ctx(), req):
                yield {"event": ev.type, "data": ev.model_dump_json()}
        except Exception:
            log.exception("chat turn failed")
            for ev in (
                ErrorEvent(code="internal", message="internal error"),
                Done(message_id="none", answer_status="cannot_answer", model="none"),
            ):
                yield {"event": ev.type, "data": ev.model_dump_json()}

    return EventSourceResponse(gen())
