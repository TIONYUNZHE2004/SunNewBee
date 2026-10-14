from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import chat, core, flood, manage

app = FastAPI(title="TownshipLens API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (core.router, flood.router, manage.router, chat.router):
    app.include_router(r)
