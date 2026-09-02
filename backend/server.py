"""
FastAPI Server & WebSocket Real-Time Stream Engine
HEMM Operator & Fleet Safety System (NMDC Bailadila Sector)
Supports lifespan background task, multi-vehicle V2V telemetry, and HTTP fallback polling.
"""

import os
import sys
import json
import time
import asyncio
from typing import Set, Dict, Any, Optional
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

# Add backend directory to path
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"

for p in [str(BASE_DIR), str(ROOT_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from backend.models import (
        TelemetryPacket,
        HazardInjectionRequest,
        HardwareIngressPayload,
        FleetVehicleSummary,
        IncidentRecord,
    )
except ImportError:
    from models import (
        TelemetryPacket,
        HazardInjectionRequest,
        HardwareIngressPayload,
        FleetVehicleSummary,
        IncidentRecord,
    )

try:
    from backend.simulation import sim_engine, HazardTypeEnum
except ImportError:
    from simulation import sim_engine, HazardTypeEnum

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast_json(self, data: dict):
        if not self.active_connections:
            return
        dead_connections = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(data)
            except Exception:
                dead_connections.add(connection)
        for dead in dead_connections:
            self.active_connections.discard(dead)

manager = ConnectionManager()

# Background broadcast loop (10 Hz)
async def real_time_broadcaster_loop():
    fps = 10.0
    interval = 1.0 / fps
    while True:
        try:
            start_t = time.time()
            sim_engine.update_physics(dt=interval)

            all_telemetry = {}
            for v_id in sim_engine.fleet_vehicles.keys():
                v_packet = sim_engine.get_telemetry_packet(vehicle_id=v_id)
                all_telemetry[v_id] = v_packet.model_dump()

            packet_dict = dict(all_telemetry.get("HEMM-DUMP-07", {}))
            packet_dict["all_vehicles_telemetry"] = all_telemetry
            packet_dict["fleet_summary"] = [f.model_dump() for f in sim_engine.get_fleet_summary()]
            packet_dict["incident_count"] = len(sim_engine.incidents)
            packet_dict["active_hazard"] = sim_engine.active_hazard

            await manager.broadcast_json(packet_dict)

            elapsed = time.time() - start_t
            sleep_time = max(0.01, interval - elapsed)
            await asyncio.sleep(sleep_time)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Broadcaster Error]: {e}", file=sys.stderr)
            await asyncio.sleep(0.1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Guaranteed startup of the simulation background loop
    print("==================================================================")
    print(" HEMM Operator & Fleet Safety System - NMDC Bailadila Active")
    print(" 10 Hz Real-Time Broadcast & Lifespan Task Started")
    print("==================================================================")
    task = asyncio.create_task(real_time_broadcaster_loop())
    yield
    task.cancel()

app = FastAPI(
    title="HEMM Operator & Fleet Safety API - NMDC Bailadila",
    description="Mission-critical zero-visibility safety system for Heavy Earth Moving Machinery",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST Endpoints
@app.get("/api/status")
async def get_system_status():
    return {
        "status": "OPERATIONAL",
        "sector": "NMDC Bailadila Iron Ore Complex (Deposit 14/5)",
        "mode": sim_engine.mode,
        "active_clients": len(manager.active_connections),
        "active_hazard": sim_engine.active_hazard,
        "fleet_count": len(sim_engine.fleet_vehicles),
        "fps_rate": 10,
    }

@app.get("/api/telemetry")
async def get_telemetry_snapshot(vehicle: str = "HEMM-DUMP-07"):
    """
    HTTP snapshot & fallback endpoint for clients when WebSocket is blocked.
    """
    all_telemetry = {}
    for v_id in sim_engine.fleet_vehicles.keys():
        v_packet = sim_engine.get_telemetry_packet(vehicle_id=v_id)
        all_telemetry[v_id] = v_packet.model_dump()

    packet_dict = dict(all_telemetry.get(vehicle, all_telemetry.get("HEMM-DUMP-07", {})))
    packet_dict["all_vehicles_telemetry"] = all_telemetry
    packet_dict["fleet_summary"] = [f.model_dump() for f in sim_engine.get_fleet_summary()]
    packet_dict["incident_count"] = len(sim_engine.incidents)
    packet_dict["active_hazard"] = sim_engine.active_hazard
    return packet_dict

@app.get("/api/fleet")
async def get_fleet_telemetry():
    return sim_engine.get_fleet_summary()

@app.get("/api/incidents")
async def get_incidents():
    return sim_engine.incidents

@app.delete("/api/incidents")
async def clear_incidents():
    sim_engine.incidents.clear()
    return {"status": "SUCCESS", "message": "Incident log cleared"}

@app.post("/api/hazard/inject")
async def inject_hazard(req: HazardInjectionRequest):
    dur = req.duration_s if req.duration_s is not None else 8.0
    sim_engine.set_hazard(req.hazard_type, req.distance_m, dur)
    return {
        "status": "SUCCESS",
        "active_hazard": sim_engine.active_hazard,
        "distance_m": req.distance_m,
        "duration_s": dur,
        "message": f"Hazard '{req.hazard_type}' injected successfully.",
    }

@app.post("/api/simulation/inject_hazard")
async def inject_hazard_legacy(req: HazardInjectionRequest):
    dur = req.duration_s if req.duration_s is not None else 8.0
    sim_engine.set_hazard(req.hazard_type, req.distance_m, dur)
    return {
        "status": "SUCCESS",
        "active_hazard": sim_engine.active_hazard,
        "distance_m": req.distance_m,
        "duration_s": dur,
    }

@app.post("/api/mode/toggle")
async def toggle_mode(req: Optional[dict] = None):
    mode = req.get("mode") if req else None
    new_mode = sim_engine.toggle_mode(mode)
    return {"status": "SUCCESS", "mode": new_mode}

@app.post("/api/simulation/pause")
async def pause_simulation():
    is_paused = sim_engine.toggle_pause()
    return {"status": "SUCCESS", "is_paused": is_paused}

@app.post("/api/simulation/control")
async def control_simulation(payload: dict):
    speed_delta = float(payload.get("speed_delta", 0.0))
    brake = bool(payload.get("brake", False))
    steer_delta = float(payload.get("steer_delta", 0.0))
    sim_engine.set_manual_control(speed_delta=speed_delta, steer_delta=steer_delta, brake=brake)
    return {"status": "SUCCESS", "speed": sim_engine.fleet_vehicles["HEMM-DUMP-07"]["speed"]}

# Shift notes & Operator log
system_notes = [
    {
        "id": "NOTE-001",
        "timestamp": time.time() - 3600,
        "timestamp_str": "18:30:00",
        "author": "Rajesh Verma (Operator)",
        "vehicle_id": "HEMM-DUMP-07",
        "category": "FOG_HAZARD",
        "content": "Heavy fog patch at Bench 14 Switchback Ramp. 77 GHz radar CAS assist operating smoothly.",
    },
    {
        "id": "NOTE-002",
        "timestamp": time.time() - 1800,
        "timestamp_str": "19:00:00",
        "author": "Safety Officer Devraj",
        "vehicle_id": "MINE-LV-03",
        "category": "BERM_CHECK",
        "content": "Safety berm inspected near Fog Valley Choke Point. Clearance verified at 4.2m.",
    }
]

@app.get("/api/notes")
async def get_notes():
    return system_notes

@app.post("/api/notes")
async def add_note(req: dict):
    note_id = f"NOTE-{len(system_notes) + 1:03d}"
    now = time.time()
    from datetime import datetime
    new_note = {
        "id": note_id,
        "timestamp": now,
        "timestamp_str": datetime.now().strftime("%H:%M:%S"),
        "author": req.get("author") or "Operator",
        "vehicle_id": req.get("vehicle_id") or "HEMM-DUMP-07",
        "category": req.get("category") or "GENERAL",
        "content": req.get("content", ""),
    }
    system_notes.insert(0, new_note)
    return {"status": "SUCCESS", "note": new_note}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str):
    global system_notes
    system_notes = [n for n in system_notes if n["id"] != note_id]
    return {"status": "SUCCESS", "message": f"Note {note_id} deleted"}

@app.post("/api/telemetry/ingress")
async def ingress_hardware_telemetry(payload: HardwareIngressPayload):
    sim_engine.ingest_hardware_packet(payload.model_dump(exclude_unset=True))
    return {"status": "SUCCESS", "ingested_at": time.time(), "vehicle_id": payload.vehicle_id or "HEMM-DUMP-07", "mode": "HARDWARE"}

# WebSockets Endpoints
@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            raw_msg = await websocket.receive_text()
            try:
                msg_data = json.loads(raw_msg)
                action = msg_data.get("action")
                if action == "inject_hazard":
                    h_type = msg_data.get("hazard_type", "NONE")
                    dist = float(msg_data.get("distance_m", 7.0))
                    sim_engine.set_hazard(h_type, dist)
                elif action == "toggle_mode":
                    m = msg_data.get("mode")
                    sim_engine.toggle_mode(m)
                elif action == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": time.time()})
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

@app.websocket("/ws/hardware")
async def websocket_hardware_ingress(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                packet_data = json.loads(raw_data)
                sim_engine.ingest_hardware_packet(packet_data)
                await websocket.send_json({"status": "ACK", "timestamp": time.time()})
            except Exception as parse_err:
                await websocket.send_json({"status": "ERR", "detail": str(parse_err)})
    except WebSocketDisconnect:
        pass

# Static UI Files Mounting
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    async def serve_index():
        response = FileResponse(str(FRONTEND_DIR / "index.html"))
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
