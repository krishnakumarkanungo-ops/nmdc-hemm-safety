import subprocess
import time
import json
import urllib.request
import asyncio
import websockets
import base64

async def main():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    port = 9224
    proc = subprocess.Popen([
        chrome_path,
        "--headless",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--remote-debugging-port={port}",
        "http://127.0.0.1:8000"
    ])
    
    try:
        await asyncio.sleep(2.5)
        tab_info = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read().decode())
        ws_url = None
        for tab in tab_info:
            if "8000" in tab.get("url", ""):
                ws_url = tab.get("webSocketDebuggerUrl")
                break
        if not ws_url and tab_info:
            ws_url = tab_info[0].get("webSocketDebuggerUrl")
            
        async with websockets.connect(ws_url) as ws:
            async def eval_js(expr):
                req_id = int(time.time() * 1000) % 100000
                await ws.send(json.dumps({
                    "id": req_id,
                    "method": "Runtime.evaluate",
                    "params": {"expression": expr, "returnByValue": True}
                }))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get("id") == req_id:
                        return msg.get("result", {}).get("result", {}).get("value")
            
            # Click Central Dispatch button
            res = await eval_js("window.app.switchView('DISPATCH')")
            print("Switched to DISPATCH:", res)
            await asyncio.sleep(1.0)
            
            # Check visibility
            hud_hidden = await eval_js("document.getElementById('operator-hud-view').classList.contains('hidden')")
            disp_hidden = await eval_js("document.getElementById('dispatch-twin-view').classList.contains('hidden')")
            print(f"HUD hidden: {hud_hidden}, Dispatch hidden: {disp_hidden}")
            
            # Capture screenshot of Dispatch View
            req_id = 998
            await ws.send(json.dumps({
                "id": req_id,
                "method": "Page.captureScreenshot",
                "params": {"format": "png"}
            }))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == req_id:
                    img_data = base64.b64decode(msg["result"]["data"])
                    with open(r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\screenshot_dispatch_view.png", "wb") as f:
                        f.write(img_data)
                    print("Saved screenshot_dispatch_view.png")
                    break

            # Switch back to HUD
            await eval_js("window.app.switchView('HUD')")
            hud_hidden_after = await eval_js("document.getElementById('operator-hud-view').classList.contains('hidden')")
            print(f"Switched back to HUD. HUD hidden: {hud_hidden_after}")

    finally:
        proc.terminate()

asyncio.run(main())
