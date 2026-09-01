"""
Simulation & Physical Kinematics Engine (Clean, Deterministic & Rock-Solid)
HEMM Operator & Fleet Safety System - NMDC Bailadila Iron Ore Complex
Zero-jitter, deterministic hazard scenarios, clean V2V collision checks, and direct manual control.
"""

import time
import math
from typing import Dict, Any, List, Optional
from enum import Enum

try:
    from backend.models import (
        TelemetryPacket,
        RadarTelemetry,
        RadarTarget,
        BermProximity,
        GPSData,
        FleetVehicleSummary,
        IncidentRecord,
        CollisionStateEnum,
    )
except ImportError:
    from models import (
        TelemetryPacket,
        RadarTelemetry,
        RadarTarget,
        BermProximity,
        GPSData,
        FleetVehicleSummary,
        IncidentRecord,
        CollisionStateEnum,
    )

class HazardTypeEnum(str, Enum):
    NONE = "NONE"
    MINER_IN_FOG = "MINER_IN_FOG"
    LV_BLINDSPOT = "LV_BLINDSPOT"
    EXTREME_FOG = "EXTREME_FOG"
    BERM_DRIFT_LEFT = "BERM_DRIFT_LEFT"
    BERM_DRIFT_RIGHT = "BERM_DRIFT_RIGHT"
    STATIONARY_OBSTACLE = "STATIONARY_OBSTACLE"

# Fixed GPS Waypoints across NMDC Bailadila Deposit 14/5 Haul Road
BAILADILA_WAYPOINTS = [
    {"lat": 18.7185, "lng": 81.2510, "alt": 1240.0, "name": "Bench 14 - East Loading Face"},
    {"lat": 18.7172, "lng": 81.2525, "alt": 1232.0, "name": "Bench 14 - Switchback Ramp"},
    {"lat": 18.7155, "lng": 81.2538, "alt": 1220.0, "name": "Mid-Pit Berm Zone"},
    {"lat": 18.7138, "lng": 81.2546, "alt": 1205.0, "name": "Fog Valley Choke Point"},
    {"lat": 18.7120, "lng": 81.2540, "alt": 1188.0, "name": "Main Haulage Corridor (South)"},
    {"lat": 18.7105, "lng": 81.2525, "alt": 1165.0, "name": "Primary Crusher #1 Infeed"},
    {"lat": 18.7118, "lng": 81.2505, "alt": 1180.0, "name": "Crusher Return Incline"},
    {"lat": 18.7145, "lng": 81.2492, "alt": 1200.0, "name": "Waste Dump Switchback"},
    {"lat": 18.7170, "lng": 81.2498, "alt": 1225.0, "name": "Waste Dump Return Loop"},
]

class SimulationEngine:
    def __init__(self):
        self.mode = "SIMULATION"
        self.active_hazard = HazardTypeEnum.NONE.value
        self.hazard_start_time = 0.0
        self.hazard_distance = 999.0
        self.hazard_duration = 0.0

        self.fog_density: float = 0.65
        self.visibility_m: float = 8.5
        self.radar_sweep_angle: float = 0.0

        self.fleet_vehicles: Dict[str, Dict[str, Any]] = self._init_fleet()
        self.incidents: List[IncidentRecord] = []
        self.hardware_packets: Dict[str, Dict[str, Any]] = {}
        self.is_paused: bool = False

    def _init_fleet(self) -> Dict[str, Dict[str, Any]]:
        return {
            "HEMM-DUMP-07": {
                "name": "CAT 777D (100T)",
                "type": "DUMP_TRUCK",
                "progress": 0.28,
                "speed": 16.0,
                "heading": 182.0,
                "gear": "D3",
                "rpm": 1650,
                "pitch": -2.8,
                "roll": 0.5,
                "brake_psi": 60.0,
                "payload": 96.4,
                "status": "HAULING",
                "operator": "Rajesh Verma (ID: EMP-4092)",
                "zone": "Mid-Pit Berm Zone",
                "collision_state": "CLEAR",
            },
            "HEMM-DUMP-02": {
                "name": "Komatsu HD785-7 (100T)",
                "type": "DUMP_TRUCK",
                "progress": 0.35,
                "speed": 18.0,
                "heading": 185.0,
                "gear": "D4",
                "rpm": 1700,
                "pitch": -2.5,
                "roll": -0.3,
                "brake_psi": 55.0,
                "payload": 0.0,
                "status": "HAULING",
                "operator": "Amit Soren (ID: EMP-3811)",
                "zone": "Fog Valley Choke Point",
                "collision_state": "CLEAR",
            },
            "HEMM-SHOV-04": {
                "name": "P&H 1900AL Electric Shovel",
                "type": "SHOVEL",
                "progress": 0.02,
                "speed": 0.0,
                "heading": 90.0,
                "gear": "N",
                "rpm": 900,
                "pitch": 0.0,
                "roll": 0.0,
                "brake_psi": 120.0,
                "payload": 0.0,
                "status": "LOADING_FACE",
                "operator": "Manoj Mandavi (ID: EMP-1904)",
                "zone": "Bench 14 - East Loading Face",
                "collision_state": "CLEAR",
            },
            "HEMM-DOZ-01": {
                "name": "CAT D11T Heavy Dozer",
                "type": "DOZER",
                "progress": 0.72,
                "speed": 5.0,
                "heading": 210.0,
                "gear": "F1",
                "rpm": 1750,
                "pitch": 1.5,
                "roll": 0.8,
                "brake_psi": 90.0,
                "payload": 0.0,
                "status": "BERM_PUSHING",
                "operator": "Suresh Kawasi (ID: EMP-2219)",
                "zone": "Waste Dump Return Loop",
                "collision_state": "CLEAR",
            },
            "MINE-LV-03": {
                "name": "Mahindra Bolero Mine Safety Patrol",
                "type": "LIGHT_VEHICLE",
                "progress": 0.38,
                "speed": 25.0,
                "heading": 180.0,
                "gear": "4",
                "rpm": 2100,
                "pitch": -2.8,
                "roll": 0.1,
                "brake_psi": 40.0,
                "payload": 0.0,
                "status": "FOG_ESCORT",
                "operator": "Safety Officer Devraj (ID: SFT-08)",
                "zone": "Fog Valley Choke Point",
                "collision_state": "CLEAR",
            },
        }

    def _interpolate_gps(self, progress: float) -> (GPSData, float, str):
        total_pts = len(BAILADILA_WAYPOINTS)
        scaled = (progress % 1.0) * total_pts
        idx = int(scaled) % total_pts
        next_idx = (idx + 1) % total_pts
        frac = scaled - idx

        p1 = BAILADILA_WAYPOINTS[idx]
        p2 = BAILADILA_WAYPOINTS[next_idx]

        lat = p1["lat"] + (p2["lat"] - p1["lat"]) * frac
        lng = p1["lng"] + (p2["lng"] - p1["lng"]) * frac
        alt = p1["alt"] + (p2["alt"] - p1["alt"]) * frac

        d_lat = p2["lat"] - p1["lat"]
        d_lng = p2["lng"] - p1["lng"]
        heading = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360

        return GPSData(lat=round(lat, 6), lng=round(lng, 6), altitude_m=round(alt, 1)), round(heading, 1), p1["name"]

    def set_hazard(self, hazard_type: str, distance_m: float = 7.0, duration_s: float = 0.0):
        self.active_hazard = hazard_type
        self.hazard_start_time = time.time()
        self.hazard_distance = distance_m
        self.hazard_duration = duration_s

    def toggle_mode(self, mode: Optional[str] = None) -> str:
        if mode:
            self.mode = mode.upper()
        else:
            self.mode = "HARDWARE" if self.mode == "SIMULATION" else "SIMULATION"
        return self.mode

    def toggle_pause(self) -> bool:
        self.is_paused = not self.is_paused
        return self.is_paused

    def set_manual_control(self, speed_delta: float = 0.0, steer_delta: float = 0.0, brake: bool = False):
        v = self.fleet_vehicles.get("HEMM-DUMP-07")
        if v:
            if brake:
                v["speed"] = 0.0
                v["brake_psi"] = 320.0
            else:
                v["speed"] = max(0.0, min(45.0, v["speed"] + speed_delta))
                v["brake_psi"] = max(20.0, v["brake_psi"] - 25.0)

    def ingest_hardware_packet(self, payload: Dict[str, Any]):
        v_id = payload.get("vehicle_id", "HEMM-DUMP-07")
        self.hardware_packets[v_id] = {
            "packet": payload,
            "timestamp": time.time(),
        }
        self.mode = "HARDWARE"

    def update_physics(self, dt: float = 0.1):
        if self.is_paused:
            return

        now = time.time()
        loop_length = 4200.0
        for v_id, v_data in self.fleet_vehicles.items():
            if v_data["speed"] > 0:
                dist_traveled = (v_data["speed"] * 1000.0 / 3600.0) * dt
                v_data["progress"] = (v_data["progress"] + dist_traveled / loop_length) % 1.0

            gps_val, heading_val, zone_val = self._interpolate_gps(v_data["progress"])
            v_data["gps"] = gps_val
            v_data["heading"] = heading_val
            v_data["zone"] = zone_val

        # Rotate radar sweep
        self.radar_sweep_angle = (self.radar_sweep_angle + 240.0 * dt) % 360.0

    def generate_thermal_matrix(self, hotspot_x: Optional[int] = None, hotspot_y: Optional[int] = None, hotspot_label: Optional[str] = None):
        rows, cols = 24, 32
        matrix = []
        for r in range(rows):
            row = []
            for c in range(cols):
                # Clean infrared base: cooler at top sky, warmer near ground
                val = 22.0 + (r / rows) * 4.0
                row.append(round(val, 1))
            matrix.append(row)

        min_t, max_t = 22.0, 26.0

        if hotspot_x is not None and hotspot_y is not None:
            core_temp = 68.0 if "VEHICLE" in str(hotspot_label) else 37.0
            max_t = core_temp
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    nr, nc = hotspot_y + dr, hotspot_x + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        matrix[nr][nc] = core_temp

        center_t = matrix[12][16]
        return matrix, min_t, max_t, center_t, hotspot_label

    def get_telemetry_packet(self, vehicle_id: str = "HEMM-DUMP-07") -> TelemetryPacket:
        now = time.time()
        v_info = self.fleet_vehicles.get(vehicle_id, self.fleet_vehicles["HEMM-DUMP-07"])
        my_gps = v_info.get("gps", self._interpolate_gps(v_info["progress"])[0])
        my_speed = v_info["speed"]
        my_heading = v_info.get("heading", 182.0)

        # Hardware mode override
        if self.mode == "HARDWARE" and vehicle_id in self.hardware_packets:
            hw_entry = self.hardware_packets[vehicle_id]
            if now - hw_entry["timestamp"] < 3.5:
                hw = hw_entry["packet"]
                return TelemetryPacket(
                    vehicle_id=vehicle_id,
                    vehicle_name=v_info["name"],
                    vehicle_type=v_info["type"],
                    timestamp=now,
                    speed_kmh=hw.get("speed_kmh", my_speed),
                    heading_deg=hw.get("heading_deg", my_heading),
                    gps=GPSData(
                        lat=hw.get("gps", {}).get("lat", my_gps.lat),
                        lng=hw.get("gps", {}).get("lng", my_gps.lng),
                        altitude_m=hw.get("gps", {}).get("altitude_m", my_gps.altitude_m),
                    ),
                    radar=RadarTelemetry(
                        target_detected=hw.get("radar", {}).get("target_detected", False),
                        distance_m=hw.get("radar", {}).get("distance_m", 999.0),
                        relative_speed_kmh=hw.get("radar", {}).get("relative_speed_kmh", 0.0),
                        targets=[],
                    ),
                    collision_state=hw.get("collision_state", "CLEAR"),
                    thermal_matrix=hw.get("thermal_matrix", []),
                    berm_proximity=BermProximity(
                        left_dist_m=hw.get("berm_left_m", 4.2),
                        right_dist_m=hw.get("berm_right_m", 4.1),
                    ),
                    mode="HARDWARE",
                    zone_name=v_info.get("zone", "Haul Road"),
                )

        target_detected = False
        target_dist = 999.0
        rel_speed = 0.0
        targets: List[RadarTarget] = []
        hotspot_x, hotspot_y = None, None
        hotspot_label = None
        collision_state = CollisionStateEnum.CLEAR.value

        berm_left = 4.2
        berm_right = 4.1
        lane_offset = 0.0

        # Process Explicit User Injected Hazard Command
        h = self.active_hazard
        if h == HazardTypeEnum.MINER_IN_FOG.value:
            target_detected = True
            target_dist = self.hazard_distance or 7.0
            rel_speed = -my_speed
            targets.append(RadarTarget(
                target_id="RAD-MINER-01",
                distance_m=target_dist,
                relative_speed_kmh=rel_speed,
                azimuth_deg=0.0,
                snr_db=28.0,
                target_type="PERSON",
                ttc_seconds=round(target_dist / (abs(rel_speed) * 1000 / 3600), 1) if abs(rel_speed) > 0.5 else 9.9
            ))
            hotspot_x, hotspot_y = 16, 12
            hotspot_label = "PERSON [MINER]"
            collision_state = CollisionStateEnum.CRITICAL.value if target_dist < 8.0 else CollisionStateEnum.ADVISORY.value

        elif h == HazardTypeEnum.LV_BLINDSPOT.value:
            target_detected = True
            target_dist = self.hazard_distance or 8.5
            rel_speed = -12.0
            targets.append(RadarTarget(
                target_id="V2V-MINE-LV-03",
                distance_m=target_dist,
                relative_speed_kmh=rel_speed,
                azimuth_deg=25.0,
                snr_db=34.0,
                target_type="LIGHT_VEHICLE",
                ttc_seconds=2.5
            ))
            hotspot_x, hotspot_y = 22, 12
            hotspot_label = "VEHICLE [BOLERO]"
            collision_state = CollisionStateEnum.CRITICAL.value if target_dist < 9.0 else CollisionStateEnum.ADVISORY.value

        elif h == HazardTypeEnum.BERM_DRIFT_LEFT.value:
            berm_left = self.hazard_distance or 0.8
            lane_offset = -2.0
            target_detected = True
            target_dist = berm_left
            collision_state = CollisionStateEnum.CRITICAL.value if berm_left < 1.2 else CollisionStateEnum.ADVISORY.value

        elif h == HazardTypeEnum.BERM_DRIFT_RIGHT.value:
            berm_right = self.hazard_distance or 0.8
            lane_offset = 2.0
            target_detected = True
            target_dist = berm_right
            collision_state = CollisionStateEnum.CRITICAL.value if berm_right < 1.2 else CollisionStateEnum.ADVISORY.value

        elif h == HazardTypeEnum.EXTREME_FOG.value:
            self.fog_density = 0.95
            self.visibility_m = 1.8
            collision_state = CollisionStateEnum.ADVISORY.value
        else:
            self.fog_density = 0.65
            self.visibility_m = 8.5

        matrix, min_t, max_t, center_t, label = self.generate_thermal_matrix(hotspot_x, hotspot_y, hotspot_label)

        v_info["collision_state"] = collision_state

        ttc_s = None
        if target_detected and target_dist < 900.0 and abs(rel_speed) > 0.5:
            ttc_s = round(target_dist / (abs(rel_speed) * 1000.0 / 3600.0), 1)

        return TelemetryPacket(
            vehicle_id=vehicle_id,
            vehicle_name=v_info["name"],
            vehicle_type=v_info["type"],
            timestamp=now,
            speed_kmh=round(my_speed, 1),
            heading_deg=round(my_heading, 1),
            gear=v_info["gear"],
            rpm=v_info["rpm"],
            pitch_deg=v_info["pitch"],
            roll_deg=v_info["roll"],
            brake_pressure_psi=v_info["brake_psi"],
            payload_tons=v_info["payload"],
            fog_density=round(self.fog_density, 2),
            visibility_m=round(self.visibility_m, 1),
            zone_name=v_info.get("zone", "Haul Road"),
            gps=my_gps,
            radar=RadarTelemetry(
                target_detected=target_detected,
                distance_m=round(target_dist, 1),
                relative_speed_kmh=round(rel_speed, 1),
                azimuth_deg=0.0 if not targets else targets[0].azimuth_deg,
                snr_db=32.0 if target_detected else 0.0,
                targets=targets,
                sweep_angle_deg=round(self.radar_sweep_angle, 1),
            ),
            collision_state=collision_state,
            time_to_collision_s=ttc_s,
            thermal_matrix=matrix,
            thermal_min_c=min_t,
            thermal_max_c=max_t,
            thermal_center_c=center_t,
            hotspot_detected=hotspot_x is not None,
            hotspot_grid_x=hotspot_x,
            hotspot_grid_y=hotspot_y,
            hotspot_temp_c=max_t if hotspot_x is not None else None,
            hotspot_label=label,
            berm_proximity=BermProximity(
                left_dist_m=round(berm_left, 1),
                right_dist_m=round(berm_right, 1),
                lane_offset_m=round(lane_offset, 1),
                departure_warning=lane_offset != 0.0,
                critical_side="LEFT" if berm_left < 1.2 else ("RIGHT" if berm_right < 1.2 else None)
            ),
            mode=self.mode,
            active_hazard=self.active_hazard,
        )

    def get_fleet_summary(self) -> List[FleetVehicleSummary]:
        res = []
        for v_id, v in self.fleet_vehicles.items():
            gps_val = v.get("gps", self._interpolate_gps(v["progress"])[0])
            res.append(FleetVehicleSummary(
                vehicle_id=v_id,
                vehicle_name=v["name"],
                vehicle_type=v["type"],
                speed_kmh=round(v["speed"], 1),
                heading_deg=round(v.get("heading", 180.0), 1),
                gps=gps_val,
                collision_state=v.get("collision_state", "CLEAR"),
                current_zone=v.get("zone", "Haul Road"),
                payload_tons=v["payload"],
                operator_name=v["operator"],
                status=v["status"],
            ))
        return res

sim_engine = SimulationEngine()
