from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .routes import chat, closures, core, evidence, flood, manage, sim
from .settings import ApiSettings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    sim.recover_interrupted_runs()  # once per process, before any request starts a run
    yield


app = FastAPI(title="TownshipLens API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ApiSettings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
for r in (
    core.router,
    flood.router,
    manage.router,
    evidence.router,
    chat.router,
    sim.router,
    closures.router,
):
    app.include_router(r)
