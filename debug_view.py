import subprocess
import time
import json
import urllib.request
import asyncio
import websockets

async def main():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    port = 9225
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
            
            print("Initial view:", await eval_js("window.app && window.app.currentView"))
            await eval_js("window.app.switchView('DISPATCH')")
            print("Current view after switch:", await eval_js("window.app.currentView"))
            h_hidden = await eval_js("document.getElementById('operator-hud-view').classList.contains('hidden')")
            d_hidden = await eval_js("document.getElementById('dispatch-twin-view').classList.contains('hidden')")
            print(f"operator-hud-view hidden: {h_hidden}, dispatch-twin-view hidden: {d_hidden}")
    finally:
        proc.terminate()

asyncio.run(main())
