# --- auth/main.py (FastAPI) ---

from fastapi.middleware.cors import CORSMiddleware
from data.models import User, Business, Invite, Base
import os
import logging
from fastapi import FastAPI
from routes import business, auth, material, mcp, tool, transportation, location, subagent, thread, system, async_jobs
import uvicorn

app = FastAPI()

logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

app = FastAPI()

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    #allow_origins=[os.getenv("NEXT_PUBLIC_FRONTEND_URL", "http://localhost:3000", "https://192.168.73.141")],
    #allow_origins=[os.getenv("NEXT_PUBLIC_FRONTEND_URL")],    
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from utils.database import engine
from sqlmodel import Session
Base.metadata.create_all(engine)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(business.router, prefix="/business", tags=["business"])
app.include_router(material.router, prefix="/material", tags=["material"])
app.include_router(location.router, prefix="/location", tags=["location"])
app.include_router(mcp.router, prefix="/mcp", tags=["mcp"])
app.include_router(tool.router, prefix="/tool", tags=["tool"])
app.include_router(transportation.router, prefix="/transportation", tags=["transportation"])
app.include_router(subagent.router, prefix="/subagent", tags=["subagent"])
app.include_router(thread.router, prefix="/thread", tags=["thread"])
app.include_router(system.router, prefix="/system", tags=["system"])
app.include_router(async_jobs.router, prefix="/async-jobs", tags=["async-jobs"])


@app.on_event("startup")
def startup_seed():
    with Session(engine) as db:
        system.seed_system_prompts(db)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=4000)
