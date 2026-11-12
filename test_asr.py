import os
import json
import asyncio
import websockets
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("CHARIOT_API_KEY")

if not API_KEY:
    raise ValueError("CHARIOT_API_KEY is missing from .env")

URL = (
    "wss://api.chariot.in/v1/asr/ws"
    "?model_type=chariot-1-asr-realtime&language=none"
)

async def main():
    async with websockets.connect(
        URL,
        max_size=None,
        additional_headers={"chariotai-api-key": API_KEY},
    ) as ws:

        started = json.loads(await ws.recv())
        print("Session:", started)

        async def send_audio():
            with open("speech.pcm", "rb") as f:
                while chunk := f.read(4096):
                    await ws.send(chunk)
                    await asyncio.sleep(0)

            await ws.send(json.dumps({"type": "input.done"}))

        async def receive_transcript():
            async for msg in ws:
                evt = json.loads(msg)

                if evt["type"] == "transcript.delta":
                    print(evt["text"], end="", flush=True)

                elif evt["type"] == "transcript.committed":
                    print("\nUtterance:", evt["text"])

                elif evt["type"] == "transcript.done":
                    print("\nFinal:", evt["text"])
                    return

                elif evt["type"] == "error":
                    print("API Error:", evt)
                    return

        async with asyncio.TaskGroup() as tasks:
            tasks.create_task(send_audio())
            tasks.create_task(receive_transcript())

asyncio.run(main())