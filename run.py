"""
One-click Application Launcher
HEMM Operator & Fleet Safety System (NMDC Bailadila Sector)
Starts the FastAPI + WebSocket server and opens the browser.
"""

import os
import sys
import webbrowser
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR / "backend"

def main():
    port = 8000
    host = "127.0.0.1"
    url = f"http://{host}:{port}"

    print("============================================================================")
    print(" ⛏️  NMDC BAILADILA HEMM OPERATOR & FLEET SAFETY SYSTEM")
    print("     Zero-Visibility Collision Avoidance System (CAS)")
    print("============================================================================")
    print(f"[*] Starting Safety Telemetry Server on {url}")
    print("[*] WebSocket Stream Endpoint: ws://127.0.0.1:8000/ws/telemetry (15 Hz)")
    print("[*] Press Ctrl+C to terminate.")
    print("============================================================================")

    # Automatically open browser in 1.5 seconds
    def open_browser():
        import time
        time.sleep(1.5)
        print(f"[*] Launching In-Cab HUD at {url}")
        webbrowser.open(url)

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # Run Uvicorn
    import uvicorn
    sys.path.insert(0, str(BACKEND_DIR))
    from server import app
    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == "__main__":
    main()
