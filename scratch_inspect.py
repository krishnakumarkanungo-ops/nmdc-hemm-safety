import subprocess
import time
import json
import urllib.request
import asyncio
import websockets

async def main():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    port = 9222
    proc = subprocess.Popen([
        chrome_path,
        "--headless",
        "--disable-gpu",
        f"--remote-debugging-port={port}",
        "http://127.0.0.1:8000"
    ])
    
    try:
        await asyncio.sleep(2.5)
        # Fetch debugger URL
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
            # Enable Runtime & Console
            await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
            await ws.send(json.dumps({"id": 2, "method": "Log.enable"}))
            
            # Evaluate expressions
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
            
            app_exists = await eval_js("typeof window.app")
            print("typeof window.app:", app_exists)
            
            cam_exists = await eval_js("Boolean(window.app && window.app.cameraRenderer)")
            print("cameraRenderer exists:", cam_exists)
            
            tof_exists = await eval_js("Boolean(window.app && window.app.tofRenderer)")
            print("tofRenderer exists:", tof_exists)
            
            imu_exists = await eval_js("Boolean(window.app && window.app.inclinometerRenderer)")
            print("inclinometerRenderer exists:", imu_exists)
            
            cam_data = await eval_js("Boolean(window.app && window.app.cameraRenderer && window.app.cameraRenderer.canvas)")
            print("cameraRenderer.canvas exists:", cam_data)
            
            cam_w = await eval_js("window.app && window.app.cameraRenderer && window.app.cameraRenderer.width")
            cam_h = await eval_js("window.app && window.app.cameraRenderer && window.app.cameraRenderer.height")
            print(f"camera dimensions: {cam_w} x {cam_h}")
            
            # Let's test calling render directly and check for errors
            res = await eval_js("""
            (() => {
                try {
                    window.app.cameraRenderer.render({ speed_kmh: 16, collision_state: 'CLEAR', active_hazard: 'NONE' });
                    return "SUCCESS";
                } catch(e) {
                    return "ERROR: " + e.message + " stack: " + e.stack;
                }
            })()
            """)
            print("Manual cameraRenderer.render test:", res)
            
            # Check console errors
            errs = await eval_js("""
            (() => {
                return window.__errors || "No logged errors";
            })()
            """)
            print("Window errors:", errs)
            
    finally:
        proc.terminate()

asyncio.run(main())
