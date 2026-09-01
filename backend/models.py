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


class BermProximity(BaseModel):
    left_dist_m: float = 4.2
    right_dist_m: float = 4.0
    lane_center_offset_m: float = 0.0  # negative = left, positive = right
    lane_departure_warning: bool = False
    berm_warning_side: Optional[str] = None  # "LEFT", "RIGHT", or None


class TelemetryPacket(BaseModel):
    vehicle_id: str = "HEMM-DUMP-07"
    vehicle_name: str = "CAT 777D 100-Ton Haul Truck"
    vehicle_type: str = "DUMP_TRUCK"
    timestamp: float
    speed_kmh: float = 14.5
    heading_deg: float = 182.0
    gear: str = "D3"
    rpm: int = 1650
    pitch_deg: float = -4.2  # Downhill haul ramp
    roll_deg: float = 1.1
    brake_pressure_psi: float = 85.0
    payload_tons: float = 94.2
    gps: GPSData
    radar: RadarTelemetry
    collision_state: str = "CLEAR"  # CLEAR, ADVISORY, CRITICAL
    thermal_matrix: List[List[float]] = []  # 32x24 array of float temperatures
    thermal_min_c: float = 21.0
    thermal_max_c: float = 38.5
    thermal_center_c: float = 24.2
    hotspot_detected: bool = False
    hotspot_temp_c: Optional[float] = None
    hotspot_grid_x: Optional[int] = None
    hotspot_grid_y: Optional[int] = None
    hotspot_label: Optional[str] = None
    berm_proximity: BermProximity
    fog_density: float = 0.65  # 0.0 to 1.0
    visibility_m: float = 6.5
    time_to_collision_s: Optional[float] = None
    mode: str = "SIMULATION"  # SIMULATION or HARDWARE
    zone_name: str = "Bench 14 - Ramp 3 South"


class FleetVehicleSummary(BaseModel):
    vehicle_id: str
    vehicle_name: str
    vehicle_type: str  # DUMP_TRUCK, SHOVEL, DOZER, WATER_TANKER, LIGHT_VEHICLE
    gps: GPSData
    speed_kmh: float
    heading_deg: float
    collision_state: str
    payload_tons: float
    status: str  # HAULING, LOADING, DUMPING, IDLE, EMERGENCY_STOP
    current_zone: str
    operator_name: str
    radar_target_detected: bool
    nearest_target_m: float


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
    custom_message: Optional[str] = None


class HardwareIngressPayload(BaseModel):
    vehicle_id: Optional[str] = "HEMM-DUMP-07"
    speed_kmh: Optional[float] = None
    heading_deg: Optional[float] = None
    gps: Optional[Dict[str, float]] = None
    radar: Optional[Dict[str, Any]] = None
    collision_state: Optional[str] = None
    thermal_matrix: Optional[List[List[float]]] = None
    berm_left_m: Optional[float] = None
    berm_right_m: Optional[float] = None


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
