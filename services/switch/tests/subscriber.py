import asyncio
import websockets
import ssl

async def listen(business_id: str):
    #uri = f"ws://127.0.0.1:6000/ws/{business_id}"
    uri = f"wss://localhost/ws/{business_id}"

    # --- SSL context ---
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False   # disable for self-signed
    ssl_context.verify_mode = ssl.CERT_NONE  # trust all (testing only)

    # OR safer: trust a specific CA
    # ssl_context.load_verify_locations("cert.pem")
    #     
    #async with websockets.connect(uri) as websocket:
    async with websockets.connect(uri, ssl=ssl_context) as websocket:        
        print(f"Subscribed as {business_id}, waiting for messages...")
        try:
            while True:
                msg = await websocket.recv()
                print(f"[{business_id}] Received:", msg)
        except websockets.ConnectionClosed:
            print("Connection closed")

if __name__ == "__main__":
    # Example: subscribe as biz456
    asyncio.run(listen("biz456"))

