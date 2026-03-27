import redis.asyncio as redis
import json
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
STREAM_MAXLEN = int(os.getenv("STREAM_MAXLEN", "1000"))  # keep last 1000 msgs by default


redis_client: redis.Redis | None = None

async def get_redis_client():
    global redis_client
    if redis_client is None:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return redis_client

async def init_redis():
    global redis_client
    if redis_client is None:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)

async def close_redis():
    global redis_client
    if redis_client:
        await redis_client.close()
        redis_client = None

async def publish_message(channel: str, message: dict):
    global redis_client
    if not redis_client:
        raise RuntimeError("Redis not initialized")
    
    payload = json.dumps(message)

    # 1️⃣ Publish to Pub/Sub
    await redis_client.publish(channel, payload)

    # 2️⃣ Append to Redis Stream
    stream_key = f"stream:{channel}"
    #await redis_client.xadd(stream_key, {"message": payload})
    await redis_client.xadd(
        stream_key,
        {"message": payload},
        maxlen=STREAM_MAXLEN,
        approximate=True,  # faster trimming
    )


async def get_events_since(business_id: str, last_seq: int) -> list[tuple[int, str]]:
    """Return AG-UI events stored after last_seq for Last-Event-ID replay (up to 200)."""
    global redis_client
    if not redis_client:
        return []
    current_seq = await redis_client.get(f"agui:seq:{business_id}")
    if not current_seq:
        return []
    current_seq = int(current_seq)
    results = []
    for seq in range(last_seq + 1, min(current_seq + 1, last_seq + 201)):
        payload = await redis_client.get(f"agui:event:{business_id}:{seq}")
        if payload:
            results.append((seq, payload))
    return results