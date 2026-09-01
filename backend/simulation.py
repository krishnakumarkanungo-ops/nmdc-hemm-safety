"""
High-fidelity Mine Telemetry & Sensor Simulation Engine
Specialized for NMDC Bailadila Iron Ore Complex (Deposit 14 / Deposit 5 Sector)
Features:
- Multi-Vehicle V2V (Vehicle-to-Vehicle) collision avoidance
- 10-20 Hz real-time physics for multiple HEMM units (Dumpers, Shovels, Dozers, Light Vehicles)
- 24/77 GHz mmWave radar with mutual inter-vehicle proximity detection
- 32x24 thermal matrix (MLX90640) with vehicle engine and human heat signatures
- Virtual haul lane berm distances and multi-device hardware ingress
"""

import time
import math
import random
from typing import List, Dict, Any, Optional
from datetime import datetime

from models import (
    TelemetryPacket,
    GPSData,
    RadarTelemetry,
    RadarTarget,
    BermProximity,
    FleetVehicleSummary,
    IncidentRecord,
    CollisionStateEnum,
    HazardTypeEnum,
)

# Coordinates for NMDC Bailadila Deposit 14 / 5 Open-Cast Pit
BAILADILA_WAYPOINTS = [
    {"lat": 18.7185, "lng": 81.2510, "alt": 1260, "name": "Bench 14 - East Loading Face"},
    {"lat": 18.7172, "lng": 81.2525, "alt": 1245, "name": "Switchback Ramp 2"},
    {"lat": 18.7155, "lng": 81.2538, "alt": 1220, "name": "Mid-Pit Berm Zone"},
    {"lat": 18.7138, "lng": 81.2546, "alt": 1195, "name": "Fog Valley Choke Point"},
    {"lat": 18.7120, "lng": 81.2540, "alt": 1170, "name": "Crusher Plant Incline"},
    {"lat": 18.7105, "lng": 81.2525, "alt": 1145, "name": "Primary Jaw Crusher Hopper #1"},
    {"lat": 18.7118, "lng": 81.2505, "alt": 1180, "name": "Waste Dump Return Loop"},
    {"lat": 18.7145, "lng": 81.2492, "alt": 1215, "name": "West Haul Ramp 4"},
    {"lat": 18.7170, "lng": 81.2498, "alt": 1245, "name": "Upper Pit Access Way"},
]


class SimulationEngine:
    def __init__(self):
        self.mode = "SIMULATION"  # "SIMULATION" or "HARDWARE"
        self.active_hazard: str = HazardTypeEnum.NONE.value
        self.hazard_start_time: float = 0.0
        self.hazard_distance: float = 7.0
        
        # Radar scan state
        self.radar_sweep_angle = 0.0
        
        # Environmental / Fog state
        self.fog_density: float = 0.65  # 0 to 1
        self.visibility_m: float = 6.2
        
        # Multi-Vehicle Fleet State
        self.fleet_vehicles: Dict[str, Dict[str, Any]] = self._init_fleet()
        
        # Incident logs buffer
        self.incidents: List[IncidentRecord] = []
        self._last_logged_incident_time: float = 0.0
        
        # Multi-device hardware packets buffer: vehicle_id -> { packet, timestamp }
        self.hardware_packets: Dict[str, Dict[str, Any]] = {}

    def _init_fleet(self) -> Dict[str, Dict[str, Any]]:
        """Initialize fleet of HEMM machines operating in Bailadila Deposit 14."""
        return {
            "HEMM-DUMP-07": {
                "name": "CAT 777D (100T)",
                "type": "DUMP_TRUCK",
                "progress": 0.28,
                "speed": 18.5,
                "base_speed": 22.0,
                "heading": 182.0,
                "gear": "D3",
                "rpm": 1680,
                "pitch": -3.8,
                "roll": 0.8,
                "brake_psi": 85.0,
                "payload": 96.4,
                "status": "HAULING",
                "operator": "Rajesh Verma (ID: EMP-4092)",
                "zone": "Mid-Pit Berm Zone",
                "collision_state": "CLEAR",
            },
            "HEMM-DUMP-02": {
                "name": "Komatsu HD785-7 (100T)",
                "type": "DUMP_TRUCK",
                "progress": 0.32,  # Close to DUMP-07 for realistic V2V demonstration
                "speed": 21.0,
                "base_speed": 24.0,
                "heading": 185.0,
                "gear": "D4",
                "rpm": 1720,
                "pitch": -3.5,
                "roll": -0.5,
                "brake_psi": 75.0,
                "payload": 0.0,
                "status": "HAULING",
                "operator": "Amit Soren (ID: EMP-3811)",
                "zone": "Mid-Pit Berm Zone",
                "collision_state": "CLEAR",
            },
            "HEMM-SHOV-04": {
                "name": "P&H 1900AL Electric Shovel",
                "type": "SHOVEL",
                "progress": 0.02,
                "speed": 0.0,
                "base_speed": 0.0,
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
                "speed": 6.2,
                "base_speed": 8.0,
                "heading": 210.0,
                "gear": "F1",
                "rpm": 1800,
                "pitch": 2.1,
                "roll": 1.4,
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
                "progress": 0.29,
                "speed": 28.0,
                "base_speed": 35.0,
                "heading": 180.0,
                "gear": "4",
                "rpm": 2200,
                "pitch": -3.8,
                "roll": 0.2,
                "brake_psi": 45.0,
                "payload": 0.0,
                "status": "FOG_ESCORT",
                "operator": "Safety Officer Devraj (ID: SFT-08)",
                "zone": "Fog Valley Choke Point",
                "collision_state": "CLEAR",
            },
        }

    def _interpolate_gps(self, progress: float) -> (GPSData, float, str):
        """Calculates interpolated GPS coordinate, heading, and zone along the haul road."""
        total_pts = len(BAILADILA_WAYPOINTS)
        scaled = (progress % 1.0) * total_pts
        idx = int(scaled)
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

    def _calculate_geo_distance_m(self, gps1: GPSData, gps2: GPSData) -> float:
        """Calculates approximate metric distance between two GPS coordinates."""
        # Standard equirectangular approximation for pit distances
        lat_mid = math.radians((gps1.lat + gps2.lat) / 2.0)
        d_lat = math.radians(gps2.lat - gps1.lat) * 111139.0
        d_lng = math.radians(gps2.lng - gps1.lng) * (111139.0 * math.cos(lat_mid))
        d_alt = (gps2.altitude_m - gps1.altitude_m)
        return math.sqrt(d_lat * d_lat + d_lng * d_lng + d_alt * d_alt)

    def set_hazard(self, hazard_type: str, distance_m: float = 7.0, duration_s: float = 8.0):
        """Inject a hazard dynamically or clear active hazards with auto-timeout."""
        self.active_hazard = hazard_type
        self.hazard_start_time = time.time()
        self.hazard_distance = distance_m
        self.hazard_duration = duration_s

    def toggle_mode(self, mode: Optional[str] = None) -> str:
        """Toggle or set backend operating mode (SIMULATION vs HARDWARE)."""
        if mode:
            self.mode = mode.upper()
        else:
            self.mode = "HARDWARE" if self.mode == "SIMULATION" else "SIMULATION"
        return self.mode

    def ingest_hardware_packet(self, payload: Dict[str, Any]):
        """Ingest live JSON packet from hardware serial/REST bridge for any specific vehicle."""
        v_id = payload.get("vehicle_id", "HEMM-DUMP-07")
        self.hardware_packets[v_id] = {
            "packet": payload,
            "timestamp": time.time(),
        }
        self.mode = "HARDWARE"

    def update_physics(self, dt: float = 0.05):
        """Update simulation physics at high frequency (10-20 Hz) for all vehicles."""
        now = time.time()
        loop_length_meters = 4200.0  # ~4.2 km pit loop

        # Auto-clear injected hazard after duration (e.g. 8 seconds)
        if self.active_hazard != HazardTypeEnum.NONE.value:
            if now - self.hazard_start_time > getattr(self, "hazard_duration", 8.0):
                self.active_hazard = HazardTypeEnum.NONE.value

        for v_id, v_data in self.fleet_vehicles.items():
            if v_data["speed"] > 0:
                speed_mps = (v_data["speed"] * 1000.0) / 3600.0
                progress_delta = (speed_mps * dt) / loop_length_meters
                v_data["progress"] = (v_data["progress"] + progress_delta) % 1.0

            gps_val, heading_val, zone_val = self._interpolate_gps(v_data["progress"])
            v_data["gps"] = gps_val
            v_data["heading"] = heading_val
            v_data["zone"] = zone_val

        # Update Fog & Visibility
        base_fog = 0.60 + 0.15 * math.sin(time.time() * 0.1)
        if self.active_hazard == HazardTypeEnum.EXTREME_FOG.value:
            self.fog_density = min(0.98, self.fog_density + dt * 0.4)
            self.visibility_m = max(1.8, 12.0 * (1.0 - self.fog_density))
        else:
            self.fog_density = base_fog
            self.visibility_m = max(4.0, 18.0 * (1.0 - self.fog_density) + 2.0)

        # Update Radar sweep angle
        self.radar_sweep_angle = (self.radar_sweep_angle + 240.0 * dt) % 360.0

    def generate_thermal_matrix(self, hotspot_x: Optional[int] = None, hotspot_y: Optional[int] = None, hotspot_type: str = "NONE") -> (List[List[float]], float, float, float, Optional[str]):
        """Generates 32x24 grid representing MLX90640 thermal infrared sensor."""
        cols, rows = 32, 24
        t_now = time.time()
        matrix = []
        min_temp = 999.0
        max_temp = -999.0
        sum_temp = 0.0

        for r in range(rows):
            row_data = []
            for c in range(cols):
                noise = random.gauss(0, 0.22)
                fog_cooling = -1.5 * (1.0 - (r / rows))
                val = 22.8 + fog_cooling + 0.4 * math.sin(c * 0.3 + t_now * 2.0) + noise
                row_data.append(round(val, 2))
            matrix.append(row_data)

        hotspot_label = None

        if hotspot_x is not None and hotspot_y is not None and hotspot_type != "NONE":
            if hotspot_type == "PERSON":
                hotspot_label = "HUMAN_MINER_SIGNATURE"
                core_temp = 36.8 + random.uniform(-0.3, 0.4)
                for dr in range(-3, 4):
                    for dc in range(-2, 3):
                        nr, nc = hotspot_y + dr, hotspot_x + dc
                        if 0 <= nr < rows and 0 <= nc < cols:
                            dist = math.sqrt((dr * 1.2)**2 + dc**2)
                            if dist < 3.5:
                                heat_boost = (1.0 - dist / 3.5) * (core_temp - matrix[nr][nc])
                                matrix[nr][nc] = round(matrix[nr][nc] + heat_boost, 2)
            elif hotspot_type in ["VEHICLE", "HEMM"]:
                hotspot_label = "V2V_VEHICLE_ENGINE_HEAT"
                core_temp = 68.5 + random.uniform(-1.0, 1.5)
                for dr in range(-4, 5):
                    for dc in range(-5, 6):
                        nr, nc = hotspot_y + dr, hotspot_x + dc
                        if 0 <= nr < rows and 0 <= nc < cols:
                            dist = math.sqrt((dr * 1.0)**2 + (dc * 0.7)**2)
                            if dist < 4.5:
                                heat_boost = (1.0 - dist / 4.5) * (core_temp - matrix[nr][nc])
                                matrix[nr][nc] = round(matrix[nr][nc] + heat_boost, 2)

        for r in range(rows):
            for c in range(cols):
                v = matrix[r][c]
                if v < min_temp: min_temp = v
                if v > max_temp: max_temp = v
                sum_temp += v

        center_temp = matrix[12][16]
        return matrix, min_temp, max_temp, center_temp, hotspot_label

    def get_telemetry_packet(self, vehicle_id: str = "HEMM-DUMP-07") -> TelemetryPacket:
        """
        Generates customized real-time TelemetryPacket for ANY chosen vehicle.
        Performs multi-vehicle V2V collision checks, radar, thermal, and berm calculations.
        """
        now = time.time()
        v_info = self.fleet_vehicles.get(vehicle_id, self.fleet_vehicles["HEMM-DUMP-07"])
        my_gps = v_info.get("gps", self._interpolate_gps(v_info["progress"])[0])
        my_speed = v_info["speed"]
        my_heading = v_info.get("heading", 180.0)

        # Check for hardware override for this specific vehicle
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
                        left_dist_m=hw.get("berm_left_m", 4.0),
                        right_dist_m=hw.get("berm_right_m", 4.0),
                    ),
                    mode="HARDWARE",
                    zone_name=v_info.get("zone", "Haul Road"),
                )

        # SIMULATION & V2V ENGINE
        target_detected = False
        target_dist = 999.0
        rel_speed = 0.0
        targets: List[RadarTarget] = []
        hotspot_x, hotspot_y = None, None
        hotspot_type = "NONE"
        hotspot_temp = None

        berm_left = 4.2 + 0.3 * math.sin(now * 0.8)
        berm_right = 4.1 - 0.3 * math.sin(now * 0.8)
        lane_offset = 0.0
        lane_dep_warning = False
        berm_warning_side = None
        collision_state = CollisionStateEnum.CLEAR.value

        # 1. Real-time V2V Mutual Proximity Detection
        for other_id, other_v in self.fleet_vehicles.items():
            if other_id == vehicle_id:
                continue
            other_gps = other_v.get("gps", self._interpolate_gps(other_v["progress"])[0])
            dist_to_other = self._calculate_geo_distance_m(my_gps, other_gps)

            # If other vehicle is within 45 meters, detect it on radar!
            if dist_to_other < 45.0:
                target_detected = True
                target_dist = min(target_dist, dist_to_other)
                rel_v = other_v["speed"] - my_speed
                rel_speed = rel_v
                ttc = dist_to_other / (abs(rel_v) * 1000.0 / 3600.0) if abs(rel_v) > 0.5 else 9.9

                # Approximate azimuth angle from my heading
                d_lat = other_gps.lat - my_gps.lat
                d_lng = other_gps.lng - my_gps.lng
                bearing = (math.degrees(math.atan2(d_lng, d_lat)) + 360) % 360
                azimuth = (bearing - my_heading + 180) % 360 - 180

                targets.append(
                    RadarTarget(
                        target_id=f"V2V-{other_id.replace('HEMM-', '')}",
                        distance_m=round(dist_to_other, 1),
                        relative_speed_kmh=round(rel_v, 1),
                        azimuth_deg=round(azimuth, 1),
                        snr_db=36.0,
                        target_type=other_v["type"],
                        ttc_seconds=round(ttc, 1),
                    )
                )

                # Render other vehicle heat signature on thermal canvas
                hotspot_x = int(16 + (azimuth / 60.0) * 12)
                hotspot_x = max(2, min(29, hotspot_x))
                hotspot_y = 12
                hotspot_type = "VEHICLE"
                hotspot_temp = 68.5

                if dist_to_other < 8.0 or ttc < 2.5:
                    collision_state = CollisionStateEnum.CRITICAL.value
                elif dist_to_other < 20.0:
                    collision_state = CollisionStateEnum.ADVISORY.value

        # 2. Apply Injected Hazard Scenario (if active)
        if self.active_hazard == HazardTypeEnum.MINER_IN_FOG.value:
            target_detected = True
            elapsed = now - self.hazard_start_time
            target_dist = max(3.8, self.hazard_distance - elapsed * 1.2)
            rel_speed = -my_speed * 0.85
            ttc = target_dist / (abs(rel_speed) * 1000.0 / 3600.0) if abs(rel_speed) > 0.5 else 9.9
            targets.insert(0,
                RadarTarget(
                    target_id="RAD-MINER-01",
                    distance_m=round(target_dist, 1),
                    relative_speed_kmh=round(rel_speed, 1),
                    azimuth_deg=0.0,
                    snr_db=28.0,
                    target_type="PERSON",
                    ttc_seconds=round(ttc, 1),
                )
            )
            hotspot_x, hotspot_y = 16, 12
            hotspot_type = "PERSON"
            hotspot_temp = 36.8
            if target_dist < 6.5 or ttc < 2.5:
                collision_state = CollisionStateEnum.CRITICAL.value
            else:
                collision_state = CollisionStateEnum.ADVISORY.value

        elif self.active_hazard == HazardTypeEnum.BERM_DRIFT_LEFT.value:
            berm_left = max(0.65, 4.2 - (now - self.hazard_start_time) * 0.6)
            lane_offset = -2.1
            lane_dep_warning = True
            berm_warning_side = "LEFT"
            target_detected = True
            target_dist = berm_left
            if berm_left < 1.2:
                collision_state = CollisionStateEnum.CRITICAL.value
            else:
                collision_state = CollisionStateEnum.ADVISORY.value

        elif self.active_hazard == HazardTypeEnum.BERM_DRIFT_RIGHT.value:
            berm_right = max(0.75, 4.0 - (now - self.hazard_start_time) * 0.6)
            lane_offset = 1.9
            lane_dep_warning = True
            berm_warning_side = "RIGHT"
            target_detected = True
            target_dist = berm_right
            if berm_right < 1.2:
                collision_state = CollisionStateEnum.CRITICAL.value
            else:
                collision_state = CollisionStateEnum.ADVISORY.value

        # Generate thermal matrix
        matrix, min_temp, max_temp, center_temp, hotspot_label = self.generate_thermal_matrix(
            hotspot_x, hotspot_y, hotspot_type
        )

        ttc_s = None
        if target_detected and target_dist < 900.0 and abs(rel_speed) > 0.5:
            ttc_s = round(target_dist / (abs(rel_speed) * 1000.0 / 3600.0), 1)

        # Update vehicle's collision state
        v_info["collision_state"] = collision_state

        return TelemetryPacket(
            vehicle_id=vehicle_id,
            vehicle_name=v_info["name"],
            vehicle_type=v_info["type"],
            timestamp=now,
            speed_kmh=round(my_speed, 1),
            heading_deg=round(my_heading, 1),
            gear=v_info.get("gear", "D3"),
            rpm=v_info.get("rpm", 1650),
            pitch_deg=v_info.get("pitch", -3.8),
            roll_deg=v_info.get("roll", 0.8),
            brake_pressure_psi=round(v_info.get("brake_psi", 85.0), 1),
            payload_tons=round(v_info.get("payload", 96.4), 1),
            gps=my_gps,
            radar=RadarTelemetry(
                target_detected=target_detected,
                distance_m=round(target_dist, 1) if target_detected else 999.0,
                relative_speed_kmh=round(rel_speed, 1),
                targets=targets,
                fov_deg=120.0,
                range_max_m=60.0,
                sweep_angle_deg=round(self.radar_sweep_angle, 1),
            ),
            collision_state=collision_state,
            thermal_matrix=matrix,
            thermal_min_c=round(min_temp, 1),
            thermal_max_c=round(max_temp, 1),
            thermal_center_c=round(center_temp, 1),
            hotspot_detected=(hotspot_type != "NONE"),
            hotspot_temp_c=round(hotspot_temp, 1) if hotspot_temp else None,
            hotspot_grid_x=hotspot_x,
            hotspot_grid_y=hotspot_y,
            hotspot_label=hotspot_label,
            berm_proximity=BermProximity(
                left_dist_m=round(berm_left, 1),
                right_dist_m=round(berm_right, 1),
                lane_center_offset_m=round(lane_offset, 2),
                lane_departure_warning=lane_dep_warning,
                berm_warning_side=berm_warning_side,
            ),
            fog_density=round(self.fog_density, 2),
            visibility_m=round(self.visibility_m, 1),
            time_to_collision_s=ttc_s,
            mode=self.mode,
            zone_name=v_info.get("zone", "Mid-Pit Berm Zone"),
        )

    def get_fleet_summary(self) -> List[FleetVehicleSummary]:
        """Returns live summary list of all fleet assets across Bailadila Pit."""
        summaries = []
        for v_id, v_data in self.fleet_vehicles.items():
            gps_val = v_data.get("gps", self._interpolate_gps(v_data["progress"])[0])
            heading_val = v_data.get("heading", 180.0)
            zone_val = v_data.get("zone", "Haul Road")

            summaries.append(
                FleetVehicleSummary(
                    vehicle_id=v_id,
                    vehicle_name=v_data["name"],
                    vehicle_type=v_data["type"],
                    gps=gps_val,
                    speed_kmh=v_data["speed"],
                    heading_deg=heading_val,
                    collision_state=v_data.get("collision_state", "CLEAR"),
                    payload_tons=v_data["payload"],
                    status="EMERGENCY_BRAKE" if v_data.get("collision_state") == "CRITICAL" else v_data["status"],
                    current_zone=zone_val,
                    operator_name=v_data["operator"],
                    radar_target_detected=False,
                    nearest_target_m=999.0,
                )
            )
        return summaries


# Global singleton simulation engine
sim_engine = SimulationEngine()
