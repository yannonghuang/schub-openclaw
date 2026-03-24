# redis_client.py
import os
import json
import redis.asyncio as redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client: redis.Redis | None = None

def get_redis():
    global redis_client
    if redis_client is None:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return redis_client

async def publish_and_stream(channel: str, message: dict, maxlen=1000):
    """Publish payload to pubsub and append to stream for persistence / later replay."""
    r = get_redis()
    payload = json.dumps(message)
    await r.publish(channel, payload)
    stream_key = f"stream:{channel}"
    await r.xadd(stream_key, {"message": payload}, maxlen=maxlen, approximate=True)
