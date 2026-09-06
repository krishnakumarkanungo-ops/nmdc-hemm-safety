import asyncio
import websockets
import json
import time
import subprocess
import urllib.request
import base64

async def test_demo():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    port = 9223
    proc = subprocess.Popen([
        chrome_path, '--headless', '--disable-gpu',
        f'--remote-debugging-port={port}',
        '--window-size=1920,1080',
        'http://127.0.0.1:8000'
    ])
    try:
        await asyncio.sleep(2)
        tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/json').read().decode())
        ws_url = tabs[0]['webSocketDebuggerUrl']
        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps({'id': 1, 'method': 'Runtime.enable'}))
            await ws.recv()
            # Click Demo Mode
            await ws.send(json.dumps({
                'id': 2,
                'method': 'Runtime.evaluate',
                'params': {'expression': 'document.getElementById("btn-enter-training").click(); "CLICKED";'}
            }))
            await ws.recv()
            await asyncio.sleep(2)
            # Take screenshot via CDP
            await ws.send(json.dumps({'id': 3, 'method': 'Page.enable'}))
            await ws.recv()
            await ws.send(json.dumps({'id': 4, 'method': 'Page.captureScreenshot'}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get('id') == 4:
                    data = base64.b64decode(msg['result']['data'])
                    with open(r'C:\Users\Krishna Kumar\.gemini\antigravity\scratch\screenshot_demo_mode.png', 'wb') as f:
                        f.write(data)
                    print('Demo screenshot saved successfully!')
                    break
    finally:
        proc.terminate()

asyncio.run(test_demo())
