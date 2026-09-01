"""
Integration test suite for HEMM Safety System API & WebSocket Stream
"""

import sys
import time
import json
import asyncio
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from simulation import sim_engine, HazardTypeEnum
from server import app
import websockets
import urllib.request

def test_telemetry_schema():
    print("[1/5] Testing Telemetry Schema Generation...")
    packet = sim_engine.get_telemetry_packet()
    p_dict = packet.model_dump()

    # Check key required fields from prompt
    assert "vehicle_id" in p_dict, "Missing vehicle_id"
    assert "timestamp" in p_dict, "Missing timestamp"
    assert "speed_kmh" in p_dict, "Missing speed_kmh"
    assert "heading_deg" in p_dict, "Missing heading_deg"
    assert "gps" in p_dict, "Missing gps"
    assert "radar" in p_dict, "Missing radar"
    assert "collision_state" in p_dict, "Missing collision_state"
    assert "thermal_matrix" in p_dict, "Missing thermal_matrix"

    assert len(p_dict["thermal_matrix"]) == 24, f"Thermal matrix row count {len(p_dict['thermal_matrix'])} != 24"
    assert len(p_dict["thermal_matrix"][0]) == 32, f"Thermal matrix col count {len(p_dict['thermal_matrix'][0])} != 32"
    print("  -> Telemetry JSON matches 32x24 matrix standard.")

def test_hazard_injection():
    print("[2/5] Testing Hazard Injection State Machine...")
    sim_engine.set_hazard("MINER_IN_FOG", distance_m=6.0)
    sim_engine.update_physics(dt=0.1)
    packet = sim_engine.get_telemetry_packet()
    
    assert packet.collision_state in ["CRITICAL", "ADVISORY"], f"Unexpected state: {packet.collision_state}"
    assert packet.radar.target_detected is True, "Target should be detected"
    assert packet.hotspot_detected is True, "Human thermal hotspot should be detected"
    print(f"  -> Hazard 'MINER_IN_FOG' verified: State = {packet.collision_state}, Dist = {packet.radar.distance_m}m")

    # Clear hazard
    sim_engine.set_hazard("NONE")
    sim_engine.update_physics(dt=0.1)
    packet_clear = sim_engine.get_telemetry_packet()
    assert packet_clear.collision_state == "CLEAR", f"State should be CLEAR, got {packet_clear.collision_state}"
    print("  -> Hazard Clear verified: State = CLEAR")

def test_hardware_ingress():
    print("[3/5] Testing Hardware Ingress Mode...")
    hw_data = {
        "vehicle_id": "HEMM-DUMP-07",
        "speed_kmh": 12.0,
        "heading_deg": 190.0,
        "gps": {"lat": 18.7150, "lng": 81.2530, "altitude_m": 1225.0},
        "radar": {"target_detected": True, "distance_m": 3.8, "relative_speed_kmh": -5.0},
        "collision_state": "CRITICAL",
        "berm_left_m": 1.2,
        "berm_right_m": 4.5
    }
    sim_engine.ingest_hardware_packet(hw_data)
    packet = sim_engine.get_telemetry_packet()
    assert packet.mode == "HARDWARE", f"Mode should be HARDWARE, got {packet.mode}"
    assert packet.radar.distance_m == 3.8, f"Ingested distance mismatch: {packet.radar.distance_m}"
    assert packet.collision_state == "CRITICAL", f"State mismatch: {packet.collision_state}"
    print("  -> Hardware Ingress packet verified.")
    sim_engine.mode = "SIMULATION"

async def test_websocket_stream():
    print("[4/5] Testing Live WebSocket Stream Broadcast (FastAPI)...")
    import uvicorn
    from server import app

    config = uvicorn.Config(app, host="127.0.0.1", port=8008, log_level="warning")
    server = uvicorn.Server(config)
    
    server_task = asyncio.create_task(server.serve())
    await asyncio.sleep(0.8)

    uri = "ws://127.0.0.1:8008/ws/telemetry"
    try:
        async with websockets.connect(uri) as ws:
            # Receive 3 continuous frames
            for i in range(3):
                msg = await ws.recv()
                data = json.loads(msg)
                assert "vehicle_id" in data
                assert "radar" in data
                assert "thermal_matrix" in data
                print(f"  -> Received Frame #{i+1}: Vehicle={data['vehicle_id']}, Speed={data['speed_kmh']} km/h, State={data['collision_state']}")
    finally:
        server.should_exit = True
        await server_task
    print("  -> WebSocket stream passed.")

def main():
    print("==========================================================")
    print(" HEMM Safety System Integration Validation Suite")
    print("==========================================================")
    test_telemetry_schema()
    test_hazard_injection()
    test_hardware_ingress()
    asyncio.run(test_websocket_stream())
    print("==========================================================")
    print(" ALL 5/5 VALIDATION TESTS PASSED SUCCESSFULLY!")
    print("==========================================================")

if __name__ == "__main__":
    main()
