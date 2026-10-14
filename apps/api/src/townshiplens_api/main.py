from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from townshiplens_agent.events import ChatEventDoc, ChatRequest
from townshiplens_spatial.models import (
    AffectedResult,
    CentreReachability,
    FloodBundle,
    RouteResult,
    Scenario,
    Site,
    ToolResult,
    VerificationRequest,
    WastePoint,
)

from . import stubs

app = FastAPI(title="TownshipLens API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/site", response_model=Site)
def site() -> Site:
    return Site.model_validate(stubs.read("site.json"))


@app.get("/layers/{lens}")
def layers(lens: str, profile: str = "default", scenario_id: str | None = None) -> dict:
    return stubs.read("base/walk.geojson")


@app.get("/places", response_model=ToolResult)
def places(q: str = Query("", max_length=200)) -> ToolResult:
    return ToolResult(ok=True, data=[])


@app.get("/places/{place_id}", response_model=ToolResult)
def place(place_id: str) -> ToolResult:
    return ToolResult(ok=False, warnings=["stub"])


@app.post("/routes", response_model=RouteResult)
def routes(body: dict) -> RouteResult:
    return RouteResult(status="no_data", routes=[], warnings=["stub"])


@app.get("/scenarios", response_model=list[Scenario])
def scenarios() -> list[Scenario]:
    return FloodBundle.model_validate(stubs.read("flood/scenarios.json")).scenarios


@app.get("/scenarios/{scenario_id}")
def scenario(scenario_id: str) -> dict:
    return stubs.read(f"flood/{scenario_id}.geojson")


@app.get("/scenarios/{scenario_id}/affected", response_model=AffectedResult)
def affected(scenario_id: str, profile: str = "default") -> AffectedResult:
    return AffectedResult(
        scenario_id=scenario_id, likely=[], possible=[], isolated_components=[], disclaimer="stub"
    )


@app.get("/evacuation-centres", response_model=list[CentreReachability])
def evac(scenario_id: str | None = None, profile: str = "default", near: str | None = None):
    return []


@app.get("/waste-points", response_model=list[WastePoint])
def waste(type: str | None = None) -> list[WastePoint]:
    return []


@app.get("/verification-requests", response_model=list[VerificationRequest])
def vrs(status: str = "open") -> list[VerificationRequest]:
    return []


@app.get("/schema/chat-event", response_model=ChatEventDoc, include_in_schema=True)
def chat_event_schema() -> ChatEventDoc:
    """Documentation-only endpoint so OpenAPI exports the ChatEvent union."""
    return ChatEventDoc(
        event={"type": "done", "message_id": "doc", "answer_status": "answered", "model": "doc"}
    )


@app.post("/chat")
async def chat(req: ChatRequest):
    from sse_starlette.sse import EventSourceResponse

    async def gen():
        yield {
            "event": "done",
            "data": (
                '{"type":"done","message_id":"stub","answer_status":"cannot_answer","model":"stub"}'
            ),
        }

    return EventSourceResponse(gen())
