from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .routes import chat, core, flood, manage
from .settings import ApiSettings

app = FastAPI(title="TownshipLens API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ApiSettings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
for r in (core.router, flood.router, manage.router, chat.router):
    app.include_router(r)
