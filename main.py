"""
Root application entrypoint for Render, Docker, and Cloud Deployment
"""

import os
import sys
from pathlib import Path

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Import FastAPI app from server
from server import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"[*] Starting HEMM Safety System on 0.0.0.0:{port}...")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
