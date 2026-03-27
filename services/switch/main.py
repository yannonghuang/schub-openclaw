from fastapi import FastAPI
from routes.switch import router
from utils.redis import init_redis, close_redis
from fastapi.routing import APIRoute, APIWebSocketRoute
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins (for testing). Replace with specific origins in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await init_redis()

@app.on_event("shutdown")
async def shutdown():
    await close_redis()

app.include_router(router)

for route in app.routes:
    if isinstance(route, APIRoute):
        print("Route:", route.path, route.methods)
    elif isinstance(route, APIWebSocketRoute):
        print("WebSocket Route:", route.path)
    else:
        print("Other Route:", route.path)
