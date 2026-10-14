from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
from townshiplens_agent.events import ChatEventDoc, ChatRequest, Done, ErrorEvent

from .. import state

router = APIRouter()


@router.get("/schema/chat-event", response_model=ChatEventDoc, include_in_schema=True)
def chat_event_schema() -> ChatEventDoc:
    """Documentation-only endpoint so OpenAPI exports the ChatEvent union."""
    return ChatEventDoc(
        event={"type": "done", "message_id": "doc", "answer_status": "answered", "model": "doc"}
    )


@router.post("/chat")
async def chat(req: ChatRequest):
    async def gen():
        try:
            from townshiplens_agent.run import run_turn  # Task 9; may not exist yet
        except ImportError:
            for ev in (
                ErrorEvent(code="agent_unavailable", message="agent not installed"),
                Done(message_id="none", answer_status="cannot_answer", model="none"),
            ):
                yield {"event": ev.type, "data": ev.model_dump_json()}
            return
        async for ev in run_turn(state.get_ctx(), req):
            yield {"event": ev.type, "data": ev.model_dump_json()}

    return EventSourceResponse(gen())
