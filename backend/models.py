"""
Data models and schemas for HEMM Safety System (NMDC Bailadila Sector).
Complies with Telemetry JSON standard for 10-20 Hz real-time streaming.
"""

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class CollisionStateEnum(str, Enum):
    CLEAR = "CLEAR"
    ADVISORY = "ADVISORY"
    CRITICAL = "CRITICAL"


class HazardTypeEnum(str, Enum):
    NONE = "NONE"
    MINER_IN_FOG = "MINER_IN_FOG"
    LV_BLINDSPOT = "LV_BLINDSPOT"
    EXTREME_FOG = "EXTREME_FOG"
    BERM_DRIFT_LEFT = "BERM_DRIFT_LEFT"
    BERM_DRIFT_RIGHT = "BERM_DRIFT_RIGHT"
    OBSTACLE_SPILL = "OBSTACLE_SPILL"


class GPSData(BaseModel):
    lat: float = Field(..., description="Latitude (Decimal degrees)")
    lng: float = Field(..., description="Longitude (Decimal degrees)")
    altitude_m: float = Field(..., description="Pit elevation above sea level in meters")


class RadarTarget(BaseModel):
    target_id: str
    distance_m: float
    relative_speed_kmh: float
    azimuth_deg: float
    elevation_deg: float = 0.0
    snr_db: float = 24.5
    target_type: str = "UNKNOWN"  # PERSON, LIGHT_VEHICLE, HEMM, BERM_ROCK, OBSTACLE
    ttc_seconds: Optional[float] = None


class RadarTelemetry(BaseModel):
    target_detected: bool = False
    distance_m: float = 999.0
    relative_speed_kmh: float = 0.0
    targets: List[RadarTarget] = []
    fov_deg: float = 120.0
    range_max_m: float = 60.0
    sweep_angle_deg: float = 0.0


class VL53L1XData(BaseModel):
    left_cm: float = 420.0
    right_cm: float = 410.0
    left_m: float = 4.20
    right_m: float = 4.10
    berm_warning: bool = False
    warning_side: Optional[str] = None  # "LEFT", "RIGHT", or None


class MPU6050Data(BaseModel):
    pitch_deg: float = -3.2  # Haul road ramp slope
    roll_deg: float = 0.8  # Vehicle tilt angle
    yaw_deg: float = 182.0
    grade_percent: float = -5.6  # Ramp gradient percentage (- = downhill)
    g_force_z: float = 1.01  # G-force / road vibration
    impact_detected: bool = False


class WheelEncoderData(BaseModel):
    speed_kmh: float = 16.5
    rpm: int = 1720
    trip_meters: float = 432.0
    pulses_per_sec: int = 145


class BMP280Data(BaseModel):
    temp_celsius: float = 24.8
    pressure_hpa: float = 982.5  # Mining pit barometric air pressure
    altitude_m: float = 582.0


class V2VLinkData(BaseModel):
    connected: bool = True
    peer_car_id: str = "CAR-2 [HEMM-DUMP-02]"
    distance_to_peer_m: float = 18.5
    relative_speed_kmh: float = -4.0
    rssi_dbm: int = -64  # Wi-Fi / LoRa signal strength
    v2v_alert: bool = False
    auto_stop_actuated: bool = False  # ESP32 Motor Stop trigger status


class RaspberryPiEdgeData(BaseModel):
    """Raspberry Pi 4B Edge Compute & Data Fusion Node"""
    cpu_temp_c: float = 43.5
    data_fusion_active: bool = True
    fusion_latency_ms: float = 12.4
    camera_fps: float = 28.5
    active_cooler_rpm: int = 4200


class ESP32MotorControlData(BaseModel):
    """ESP32 NodeMCU Motor Control & Safety Actuation"""
    motor_pwm_duty: int = 180  # 0-255 PWM speed throttle
    emergency_stop_actuated: bool = False  # E-Stop relay status
    buzzer_active: bool = False  # Warning buzzer status
    warning_led_active: bool = False  # High-intensity LED beacon
    brake_solenoid_engaged: bool = False  # Mechanical/service brake
    status: str = "NORMAL"  # NORMAL, THROTTLE_CUT, EMERGENCY_STOP


class BermProximity(BaseModel):
    """Safety Berm Proximity Clearance for AR Guide"""
    left_dist_m: float = 4.2
    right_dist_m: float = 4.1
    lane_offset_m: float = 0.0
    departure_warning: bool = False
    critical_side: Optional[str] = None


class TelemetryPacket(BaseModel):
    vehicle_id: str = "HEMM-DUMP-07"
    vehicle_name: str = "CAT 777D Dump Truck"
    vehicle_type: str = "DUMP_TRUCK"
    car_role: str = "DUMP_TRUCK"
    timestamp: float
    speed_kmh: float = 16.5
    heading_deg: float = 182.0
    gear: str = "D3"
    rpm: int = 1720
    pitch_deg: float = -3.2
    roll_deg: float = 0.8
    brake_pressure_psi: float = 85.0
    payload_tons: float = 94.2
    collision_state: str = "CLEAR"  # CLEAR, ADVISORY, CRITICAL
    
    # 1. mmWave Radar (24/77 GHz)
    radar: RadarTelemetry
    
    # 2. Dual VL53L1X ToF Laser Ranging
    tof_laser: VL53L1XData = Field(default_factory=VL53L1XData)
    
    # 3. MPU6050 6-Axis IMU Inclinometer
    imu: MPU6050Data = Field(default_factory=MPU6050Data)
    
    # 4. Optical Wheel Encoder Telemetry
    encoder: WheelEncoderData = Field(default_factory=WheelEncoderData)
    
    # 5. BMP280 Environmental Atmosphere
    atmosphere: BMP280Data = Field(default_factory=BMP280Data)
    
    # 6. V2V Inter-Vehicle Mesh Link (Fleet Vehicles)
    v2v: V2VLinkData = Field(default_factory=V2VLinkData)
    
    # 7. NEO-M8N GPS
    gps: GPSData
    
    # 8. Raspberry Pi 4B Data Fusion Node
    rpi_edge: RaspberryPiEdgeData = Field(default_factory=RaspberryPiEdgeData)
    
    # 9. ESP32 Motor Control Node
    motor_control: ESP32MotorControlData = Field(default_factory=ESP32MotorControlData)
    
    # 10. Raspberry Pi Camera Module 3 Wide Vision Feed
    camera_stream_active: bool = True
    camera_detections_count: int = 0
    camera_primary_label: Optional[str] = None
    
    # 11. Thermal Vision Matrix (32x24)
    thermal_matrix: List[List[float]] = []
    thermal_min_c: float = 22.0
    thermal_max_c: float = 26.0
    thermal_center_c: float = 24.0
    hotspot_detected: bool = False
    hotspot_grid_x: Optional[int] = None
    hotspot_grid_y: Optional[int] = None
    hotspot_temp_c: Optional[float] = None
    hotspot_label: Optional[str] = None
    
    # 12. Legacy Berm Proximity (Backwards compatibility)
    berm_proximity: BermProximity = Field(default_factory=BermProximity)
    
    fog_density: float = 0.65  # 0.0 to 1.0
    visibility_m: float = 8.5
    time_to_collision_s: Optional[float] = None
    mode: str = "HARDWARE"  # HARDWARE or DEMO_TRAINING
    zone_name: str = "Bench 14 - Ramp 3 South"
    active_hazard: str = "NONE"
    incident_count: int = 0


# --- BOM DATA MODELS (SIH26007 Prototype Inventory) ---

class BOMItem(BaseModel):
    category: str  # TO PURCHASE, IN-HAND, RECOMMENDED TOOLS
    component: str
    specification: str
    quantity: int
    allocation: str
    primary_role: str
    in_stock: bool = True


class ConsolidatedBOM(BaseModel):
    to_purchase: List[BOMItem]
    in_hand: List[BOMItem]
    tools_hardware: List[BOMItem]


class FleetVehicleSummary(BaseModel):
    vehicle_id: str
    vehicle_name: str
    vehicle_type: str = "DUMP_TRUCK"  # DUMP_TRUCK, SHOVEL, DOZER, WATER_TANKER, LIGHT_VEHICLE
    car_role: str = "CAR_1"
    gps: GPSData
    speed_kmh: float = 0.0
    heading_deg: float = 180.0
    collision_state: str = "CLEAR"
    payload_tons: float = 0.0
    status: str = "HAULING"  # HAULING, LOADING, DUMPING, IDLE, EMERGENCY_STOP
    current_zone: str = "Deposit 14 Haul Road"
    operator_name: str = "NMDC Operator"
    radar_target_detected: bool = False
    nearest_target_m: float = 999.0
    v2v_peer_distance_m: Optional[float] = None
    auto_stop_actuated: bool = False


class IncidentRecord(BaseModel):
    id: str
    timestamp: float
    timestamp_str: str
    vehicle_id: str
    hazard_type: str
    collision_state: str
    distance_m: float
    speed_kmh: float
    visibility_m: float
    action_taken: str
    resolved: bool = False


class HazardInjectionRequest(BaseModel):
    hazard_type: str
    distance_m: Optional[float] = 7.0
    duration_s: Optional[float] = 0.0
    custom_message: Optional[str] = None


class HardwareIngressPayload(BaseModel):
    vehicle_id: Optional[str] = "HEMM-DUMP-07"
    speed_kmh: Optional[float] = None
    heading_deg: Optional[float] = None
    gps: Optional[Dict[str, float]] = None
    radar: Optional[Dict[str, Any]] = None
    tof_left_cm: Optional[float] = None
    tof_right_cm: Optional[float] = None
    imu_pitch: Optional[float] = None
    imu_roll: Optional[float] = None
    bmp_temp: Optional[float] = None
    bmp_pressure: Optional[float] = None
    wheel_rpm: Optional[int] = None
    v2v_distance_m: Optional[float] = None
    auto_stop: Optional[bool] = None
    collision_state: Optional[str] = None


class NoteRecord(BaseModel):
    id: str
    timestamp: float
    timestamp_str: str
    author: str
    vehicle_id: str
    category: str
    content: str


class NoteCreateRequest(BaseModel):
    author: Optional[str] = "Operator"
    vehicle_id: Optional[str] = "HEMM-DUMP-07"
    category: Optional[str] = "GENERAL"
    content: str
