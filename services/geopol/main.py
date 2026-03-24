from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import feedparser
from playwright.async_api import async_playwright
import httpx
import asyncio
import json
#import redis
from datetime import datetime
import redis.asyncio as redis
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
STREAM_MAXLEN = int(os.getenv("STREAM_MAXLEN", "1000"))  # keep last 1000 msgs by default
GEOPOL_INBOUND_CHANNEL = os.getenv("GEOPOL_INBOUND_CHANNEL", "business:-1:channel")

redis_client: redis.Redis | None = None
async def get_redis_client():
    global redis_client
    if redis_client is None:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return redis_client

async def publish_message(channel: str, message: dict):
    global redis_client
    if not redis_client:
        redis_client = await get_redis_client()
    
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

app = FastAPI()
r = redis.Redis(host="redis", port=6379, db=0)

# Initialize APScheduler
scheduler = AsyncIOScheduler()

class CrawlResult(BaseModel):
    count: int
    results: List[dict]

#@app.post("/crawl", response_model=CrawlResult)
async def crawl_commodities():
    url = "https://oilprice.com/rss/main"
    feed = feedparser.parse(url)

    entries = feed.entries or []
    results = []

    for entry in entries[:10]:
        results.append({
            "title": entry.get("title"),
            "link": entry.get("link"),
            "published": entry.get("published"),
            "summary": entry.get("summary")
        })

    return {"count": len(results), "results": results}

# ----------------------------
# RSS feed crawler (/crawl)
# ----------------------------
RSS_FEEDS = [
    "https://oilprice.com/rss/main",
    #"https://www.reuters.com/markets/commodities/rss",
    #"https://feeds.a.dj.com/rss/RSSCommodities.xml"
]
async def fetch_rss():
    results = []
    for feed_url in RSS_FEEDS:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(feed_url)
                resp.raise_for_status()
                parsed = feedparser.parse(resp.text)

                for entry in parsed.entries:
                    results.append({
                        "title": entry.get("title"),
                        "link": entry.get("link"),
                        "published": entry.get("published", None),
                        "source": feed_url
                    })
        except Exception as e:
            results.append({"error": f"Fetch failed: {e}", "source": feed_url})
    return results


@app.post("/crawl")
async def crawl_rss_endpoint():
    data = await fetch_rss()
    return {"count": len(data), "results": data}


# ----------------------------
# ITA crawler (/crawl_ita)
# ----------------------------
async def crawl_ita_steel():
    """Crawl ITA steel/aluminum trade page for reports and resources."""
    url = "https://www.trade.gov/steel"
    results = []

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(url, timeout=60000)

            # Wait for main content
            await page.wait_for_selector("main")

            # Extract links under main content
            links = await page.query_selector_all("main a")
            for link in links:
                href = await link.get_attribute("href")
                text = await link.inner_text()
                if href and text:
                    if "steel" in text.lower() or "aluminum" in text.lower():
                        results.append({"title": text.strip(), "url": href})

            await browser.close()
    except Exception as e:
        results.append({"error": str(e)})

    return results


@app.post("/crawl_ita")
async def crawl_ita_endpoint():
    data = await crawl_ita_steel()
    return {"count": len(data), "results": data}

# --- periodic job ---


async def scheduled_crawl():
    try:
        results = await crawl_ita_steel()
        if results:
            for item in results:
                #await r.publish("geopol:ita", json.dumps(item))
                #await publish_message(GEOPOL_INBOUND_CHANNEL, item)
                await publish_message(GEOPOL_INBOUND_CHANNEL, {"from": -1, "text": json.dumps(item)})

            print(f"{datetime.utcnow()} ✅ Published {len(results)} ITA updates to Redis channel {GEOPOL_INBOUND_CHANNEL}")
        else:
            print(f"{datetime.utcnow()} ⚠️ No ITA results this run.")
    except Exception as e:
        print(f"{datetime.utcnow()} ❌ Error in scheduled_crawl: {e}")


@app.on_event("startup")
async def startup_event():
    # Schedule the async job directly (no lambda, no create_task)
    scheduler.add_job(scheduled_crawl, "interval", minutes=30, coalesce=True)
    scheduler.start()
    print("FastAPI service started, scheduled ITA crawl every 30 minute.")