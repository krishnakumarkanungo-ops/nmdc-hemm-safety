import subprocess
import time
import json
import urllib.request
import asyncio
import websockets
import base64
import os

async def main():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    port = 9223
    proc = subprocess.Popen([
        chrome_path,
        "--headless",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--remote-debugging-port={port}",
        "http://127.0.0.1:8000"
    ])
    
    try:
        await asyncio.sleep(3.0)
        tab_info = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read().decode())
        ws_url = None
        for tab in tab_info:
            if "8000" in tab.get("url", ""):
                ws_url = tab.get("webSocketDebuggerUrl")
                break
        if not ws_url and tab_info:
            ws_url = tab_info[0].get("webSocketDebuggerUrl")
            
        print(f"Connecting to CDP at {ws_url}...")
        async with websockets.connect(ws_url) as ws:
            # Let it run animations and websocket messages for 2.5 seconds
            await asyncio.sleep(2.5)
            
            # Send Page.captureScreenshot
            req_id = 999
            await ws.send(json.dumps({
                "id": req_id,
                "method": "Page.captureScreenshot",
                "params": {"format": "png"}
            }))
            
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == req_id:
                    img_data = base64.b64decode(msg["result"]["data"])
                    dest1 = r"C:\Users\Krishna Kumar\.gemini\antigravity\scratch\hemm_safety_system\screenshot_fixed_cockpit.png"
                    dest2 = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\screenshot_fixed_cockpit.png"
                    with open(dest1, "wb") as f:
                        f.write(img_data)
                    with open(dest2, "wb") as f:
                        f.write(img_data)
                    print(f"Screenshot successfully saved to {dest1} and {dest2} ({len(img_data)} bytes)")
                    break
    finally:
        proc.terminate()

asyncio.run(main())
