"""
FastAPI Server & WebSocket Real-Time Stream Engine
HEMM Operator & Fleet Safety System (NMDC Bailadila Sector)
Supports multi-vehicle V2V telemetry, hardware ingress for multiple machines, and 15 Hz stream.
"""

import os
import sys
import json
import time
import asyncio
from typing import Set, Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

# Add backend directory to path
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

from models import (
    TelemetryPacket,
    HazardInjectionRequest,
    HardwareIngressPayload,
    FleetVehicleSummary,
    IncidentRecord,
)
from simulation import sim_engine, HazardTypeEnum

app = FastAPI(
    title="HEMM Operator & Fleet Safety API - NMDC Bailadila",
    description="Mission-critical zero-visibility safety system for Heavy Earth Moving Machinery",
    version="1.0.0",
)

# CORS middleware for open accessibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


# Real-time simulation & broadcast background task (15 Hz)
async def real_time_broadcaster_loop():
    fps = 15.0  # 15 Hz stream frequency
    interval = 1.0 / fps
    while True:
        try:
            start_t = time.time()
            # Advance simulation physics for all vehicles
            sim_engine.update_physics(dt=interval)
            
            # Generate multi-vehicle telemetry packets
            all_telemetry = {}
            for v_id in sim_engine.fleet_vehicles.keys():
                v_packet = sim_engine.get_telemetry_packet(vehicle_id=v_id)
                all_telemetry[v_id] = v_packet.model_dump()

            # Default packet is HEMM-DUMP-07
            packet_dict = dict(all_telemetry.get("HEMM-DUMP-07", {}))
            packet_dict["all_vehicles_telemetry"] = all_telemetry
            packet_dict["fleet_summary"] = [f.model_dump() for f in sim_engine.get_fleet_summary()]
            packet_dict["incident_count"] = len(sim_engine.incidents)
            packet_dict["active_hazard"] = sim_engine.active_hazard

            # Broadcast to all connected WebSocket clients
            await manager.broadcast_json(packet_dict)

            elapsed = time.time() - start_t
            sleep_time = max(0.001, interval - elapsed)
            await asyncio.sleep(sleep_time)
        except Exception as e:
            print(f"[Broadcaster Error]: {e}", file=sys.stderr)
            await asyncio.sleep(0.1)


@app.on_event("startup")
async def startup_event():
    print("==================================================================")
    print(" HEMM Operator & Fleet Safety System - NMDC Bailadila Active")
    print(" Target Stream Rate: 15 Hz Multi-Vehicle V2V Broadcast")
    print("==================================================================")
    asyncio.create_task(real_time_broadcaster_loop())


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
        "fps_rate": 15,
        "timestamp": time.time(),
    }


@app.get("/api/telemetry/current")
async def get_current_telemetry(vehicle_id: str = Query("HEMM-DUMP-07")):
    packet = sim_engine.get_telemetry_packet(vehicle_id=vehicle_id)
    return packet.model_dump()


@app.get("/api/fleet")
async def get_fleet():
    fleet = sim_engine.get_fleet_summary()
    return [f.model_dump() for f in fleet]


@app.get("/api/incidents")
async def get_incidents():
    return [inc.model_dump() for inc in sim_engine.incidents]


@app.post("/api/incidents/clear")
async def clear_incidents():
    sim_engine.incidents.clear()
    return {"status": "SUCCESS", "message": "Incident log cleared"}


@app.post("/api/simulation/inject_hazard")
async def inject_hazard(req: HazardInjectionRequest):
    sim_engine.set_hazard(req.hazard_type, req.distance_m or 7.0)
    return {
        "status": "SUCCESS",
        "active_hazard": sim_engine.active_hazard,
        "distance_m": req.distance_m,
        "message": f"Hazard '{req.hazard_type}' injected successfully.",
    }


@app.post("/api/mode/toggle")
async def toggle_mode(mode: str = None):
    new_mode = sim_engine.toggle_mode(mode)
    return {"status": "SUCCESS", "mode": new_mode}


# In-memory and persistent notes storage
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
async def add_note(req: NoteCreateRequest):
    note_id = f"NOTE-{len(system_notes) + 1:03d}"
    now = time.time()
    from datetime import datetime
    new_note = {
        "id": note_id,
        "timestamp": now,
        "timestamp_str": datetime.now().strftime("%H:%M:%S"),
        "author": req.author or "Operator",
        "vehicle_id": req.vehicle_id or "HEMM-DUMP-07",
        "category": req.category or "GENERAL",
        "content": req.content,
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
    """
    Hardware Mode: Accepts live JSON packets from ESP32 / Arduino / USB Serial bridge for ANY vehicle.
    """
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
    """
    Dedicated high-speed WebSocket ingress stream for physical ESP32/microcontroller bridge.
    """
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
        return FileResponse(str(FRONTEND_DIR / "index.html"))
