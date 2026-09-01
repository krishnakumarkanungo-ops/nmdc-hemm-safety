"""
Universal Root Application Entrypoint for Render, Docker, and Cloud Deployment
Dynamically binds to $PORT (Render/Heroku/AWS standard)
"""

import os
import sys
from pathlib import Path

# Add project root and backend directory to Python path
BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR / "backend"

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Export app at root level for ASGI servers (uvicorn main:app)
from backend.server import app

if __name__ == "__main__":
    import uvicorn
    # Render and cloud providers pass the port in the PORT environment variable
    port_str = os.environ.get("PORT", "8000")
    try:
        port = int(port_str)
    except ValueError:
        port = 8000

    print(f"[*] Starting HEMM Safety System on 0.0.0.0:{port}...")
    uvicorn.run("backend.server:app", host="0.0.0.0", port=port, log_level="info")
