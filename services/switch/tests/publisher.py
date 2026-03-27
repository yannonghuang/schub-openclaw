import httpx
import asyncio

async def main():
    url = "http://localhost:6000/publish"
    payload = {
        "sender": "biz123",
        "content": "We have new stock available!",
        "recipients": ["biz456", "biz789"]
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload)
        print("Publish response:", resp.json())

if __name__ == "__main__":
    asyncio.run(main())
