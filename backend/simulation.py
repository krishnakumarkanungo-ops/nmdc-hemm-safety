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
        VL53L1XData,
        MPU6050Data,
        WheelEncoderData,
        BMP280Data,
        V2VLinkData,
        RaspberryPiEdgeData,
        ESP32MotorControlData,
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
        VL53L1XData,
        MPU6050Data,
        WheelEncoderData,
        BMP280Data,
        V2VLinkData,
        RaspberryPiEdgeData,
        ESP32MotorControlData,
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
                "name": "CAT 777D Dump Truck (Unit 07)",
                "type": "DUMP_TRUCK",
                "car_role": "DUMP_TRUCK",
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
                "v2v_dist": 18.5,
                "v2v_rel_speed": -2.0,
                "v2v_rssi": -62,
                "v2v_alert": False,
                "auto_stop": False,
            },
            "HEMM-DUMP-02": {
                "name": "Komatsu HD785 Dump Truck (Unit 02)",
                "type": "DUMP_TRUCK",
                "car_role": "DUMP_TRUCK",
                "progress": 0.284,
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
                "zone": "Mid-Pit Berm Zone",
                "collision_state": "CLEAR",
                "v2v_dist": 18.5,
                "v2v_rel_speed": 2.0,
                "v2v_rssi": -62,
                "v2v_alert": False,
                "auto_stop": False,
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

        # Dynamic V2V Communication (Wi-Fi / LoRa) & ESP32 Motor Stop Actuation between CAR 1 & CAR 2
        car1 = self.fleet_vehicles.get("HEMM-DUMP-07")
        car2 = self.fleet_vehicles.get("HEMM-DUMP-02")
        if car1 and car2:
            prog_diff = abs(car1["progress"] - car2["progress"])
            if prog_diff > 0.5:
                prog_diff = 1.0 - prog_diff
            dist_m = max(1.5, prog_diff * loop_length)
            rel_speed = car2["speed"] - car1["speed"]
            
            # Attenuate RSSI based on distance & fog density
            rssi = max(-95, min(-45, int(-48 - (dist_m * 0.8) - (self.fog_density * 15))))
            
            v2v_alert = False
            auto_stop = False
            
            # Proximity safety decision logic (Coordinated V2V)
            if dist_m < 15.0 or (self.active_hazard != HazardTypeEnum.NONE.value and self.hazard_distance < 12.0):
                v2v_alert = True
                if dist_m < 6.5 or (self.active_hazard != HazardTypeEnum.NONE.value and self.hazard_distance < 6.0):
                    auto_stop = True
                    # Actuate ESP32 Motor Cutoff & Service Brake on following CAR 2
                    car2["speed"] = max(0.0, car2["speed"] - 25.0 * dt)
                    car2["brake_psi"] = 320.0
                    car2["collision_state"] = "CRITICAL"
                else:
                    car2["collision_state"] = "ADVISORY"
            else:
                if self.active_hazard == HazardTypeEnum.NONE.value:
                    car2["collision_state"] = "CLEAR"
                    car2["brake_psi"] = 55.0
            
            car1["v2v_dist"] = dist_m
            car1["v2v_rel_speed"] = -rel_speed
            car1["v2v_rssi"] = rssi
            car1["v2v_alert"] = v2v_alert
            car1["auto_stop"] = auto_stop
            
            car2["v2v_dist"] = dist_m
            car2["v2v_rel_speed"] = rel_speed
            car2["v2v_rssi"] = rssi
            car2["v2v_alert"] = v2v_alert
            car2["auto_stop"] = auto_stop

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

    def get_telemetry_packet(self, vehicle_id: str = "HEMM-DUMP-07", include_thermal: bool = True) -> TelemetryPacket:
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
            v_info["roll"] = -8.5
            collision_state = CollisionStateEnum.CRITICAL.value if berm_left < 1.2 else CollisionStateEnum.ADVISORY.value

        elif h == HazardTypeEnum.BERM_DRIFT_RIGHT.value:
            berm_right = self.hazard_distance or 0.8
            lane_offset = 2.0
            target_detected = True
            target_dist = berm_right
            v_info["roll"] = 8.5
            collision_state = CollisionStateEnum.CRITICAL.value if berm_right < 1.2 else CollisionStateEnum.ADVISORY.value

        elif h == HazardTypeEnum.EXTREME_FOG.value:
            self.fog_density = 0.95
            self.visibility_m = 1.8
            v_info["roll"] = 0.5
            collision_state = CollisionStateEnum.ADVISORY.value
        else:
            self.fog_density = 0.65
            self.visibility_m = 8.5
            v_info["roll"] = 0.5

        if include_thermal:
            matrix, min_t, max_t, center_t, label = self.generate_thermal_matrix(hotspot_x, hotspot_y, hotspot_label)
        else:
            matrix = []
            min_t, max_t, center_t, label = 22.0, 26.0, 24.0, None

        v_info["collision_state"] = collision_state

        ttc_s = None
        if target_detected and target_dist < 900.0 and abs(rel_speed) > 0.5:
            ttc_s = round(target_dist / (abs(rel_speed) * 1000.0 / 3600.0), 1)

        car_role = v_info.get("car_role", "DUMP_TRUCK")
        loop_length = 4200.0
        wheel_rpm = int(my_speed * 105.0)
        is_stopped = v_info.get("auto_stop", False) or collision_state == "CRITICAL"
        
        # Dual VL53L1X ToF Laser Ranging Data
        tof_data = VL53L1XData(
            left_cm=round(berm_left * 100.0, 1),
            right_cm=round(berm_right * 100.0, 1),
            left_m=round(berm_left, 2),
            right_m=round(berm_right, 2),
            berm_warning=berm_left < 1.2 or berm_right < 1.2,
            warning_side="LEFT" if berm_left < 1.2 else ("RIGHT" if berm_right < 1.2 else None),
        )
        
        # MPU6050 6-Axis IMU Data
        imu_data = MPU6050Data(
            pitch_deg=round(v_info.get("pitch", -2.8), 1),
            roll_deg=round(v_info.get("roll", 0.5), 1),
            yaw_deg=round(my_heading, 1),
            grade_percent=round(math.tan(math.radians(v_info.get("pitch", -2.8))) * 100.0, 1),
            g_force_z=round(1.01 + (0.04 if my_speed > 0 else 0.0), 2),
            impact_detected=is_stopped and collision_state == "CRITICAL",
        )
        
        # Optical Wheel Encoder Telemetry
        encoder_data = WheelEncoderData(
            speed_kmh=round(my_speed, 1),
            rpm=wheel_rpm,
            trip_meters=round(v_info["progress"] * loop_length, 1),
            pulses_per_sec=int(wheel_rpm * 20 / 60),
        )
        
        # BMP280 Atmospheric Data
        atmosphere_data = BMP280Data(
            temp_celsius=round(24.5 - (my_gps.altitude_m - 1100.0) * 0.0065, 1),
            pressure_hpa=round(1013.25 * math.exp(-my_gps.altitude_m / 8400.0), 1),
            altitude_m=round(my_gps.altitude_m, 1),
        )
        
        # V2V Inter-Vehicle Mesh Link
        v2v_data = V2VLinkData(
            connected=True,
            peer_car_id="HEMM-DUMP-02 [Komatsu HD785]" if vehicle_id == "HEMM-DUMP-07" else "HEMM-DUMP-07 [CAT 777D]",
            distance_to_peer_m=round(v_info.get("v2v_dist", 18.5), 1),
            relative_speed_kmh=round(v_info.get("v2v_rel_speed", -2.0), 1),
            rssi_dbm=int(v_info.get("v2v_rssi", -62)),
            v2v_alert=v_info.get("v2v_alert", False),
            auto_stop_actuated=v_info.get("auto_stop", False),
        )
        
        # Raspberry Pi 4B Data Fusion Node
        rpi_data = RaspberryPiEdgeData(
            cpu_temp_c=round(42.5 + (0.15 * my_speed), 1),
            data_fusion_active=True,
            fusion_latency_ms=11.2 if collision_state == "CLEAR" else 14.5,
            camera_fps=29.4,
            active_cooler_rpm=4300 if my_speed > 0 else 3600,
        )
        
        # ESP32 Motor Control & Actuation Node
        motor_data = ESP32MotorControlData(
            motor_pwm_duty=0 if is_stopped else int(min(255, my_speed * 12.0)),
            emergency_stop_actuated=is_stopped,
            buzzer_active=collision_state in ["ADVISORY", "CRITICAL"] or v_info.get("v2v_alert", False),
            warning_led_active=collision_state == "CRITICAL" or v_info.get("auto_stop", False),
            brake_solenoid_engaged=is_stopped,
            status="EMERGENCY_STOP" if is_stopped else ("THROTTLE_CUT" if collision_state == "ADVISORY" else "NORMAL"),
        )

        return TelemetryPacket(
            vehicle_id=vehicle_id,
            vehicle_name=v_info["name"],
            vehicle_type=v_info["type"],
            car_role=car_role,
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
            tof_laser=tof_data,
            imu=imu_data,
            encoder=encoder_data,
            atmosphere=atmosphere_data,
            v2v=v2v_data,
            rpi_edge=rpi_data,
            motor_control=motor_data,
            camera_stream_active=True,
            camera_detections_count=len(targets),
            camera_primary_label=hotspot_label or (targets[0].target_type if targets else None),
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
                car_role=v.get("car_role", v["type"]),
                speed_kmh=round(v["speed"], 1),
                heading_deg=round(v.get("heading", 180.0), 1),
                gps=gps_val,
                collision_state=v.get("collision_state", "CLEAR"),
                current_zone=v.get("zone", "Haul Road"),
                payload_tons=v["payload"],
                operator_name=v.get("operator", "NMDC Driver"),
                status=v["status"],
                radar_target_detected=False,
                nearest_target_m=999.0,
                v2v_peer_distance_m=round(v.get("v2v_dist", 18.5), 1) if "v2v_dist" in v else None,
                auto_stop_actuated=v.get("auto_stop", False),
            ))
        return res

sim_engine = SimulationEngine()
