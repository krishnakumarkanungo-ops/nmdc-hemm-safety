/**
 * Central Mine Dispatch & Digital Twin View Map
 * Leaflet.js map for NMDC Bailadila Iron Ore Complex (Deposit 14 / Deposit 5 Sector)
 * Renders pit benches, haul roads, fog layers, and live HEMM fleet positions with heading arrows.
 */

class DispatchMapRenderer {
  constructor(mapContainerId) {
    this.containerId = mapContainerId;
    this.map = null;
    this.markers = {};
    this.trailPolylines = {};
    this.fogLayer = null;
    this.pitCenter = [18.7145, 81.2525];
    this.selectedVehicle = "HEMM-DUMP-07";

    this.initMap();
  }

  initMap() {
    const container = document.getElementById(this.containerId);
    if (!container || typeof L === 'undefined') return;

    // Initialize Leaflet Map
    this.map = L.map(this.containerId, {
      center: this.pitCenter,
      zoom: 15,
      zoomControl: true,
      attributionControl: false,
    });

    // Dark Matter tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(this.map);

    // 1. Draw NMDC Bailadila Haul Road Polylines
    const haulRoadCoords = [
      [18.7185, 81.2510],
      [18.7172, 81.2525],
      [18.7155, 81.2538],
      [18.7138, 81.2546],
      [18.7120, 81.2540],
      [18.7105, 81.2525],
      [18.7118, 81.2505],
      [18.7145, 81.2492],
      [18.7170, 81.2498],
      [18.7185, 81.2510],
    ];

    // Main Haul Road (Glow Line)
    L.polyline(haulRoadCoords, {
      color: '#06b6d4',
      weight: 6,
      opacity: 0.8,
      dashArray: '8, 8',
    }).addTo(this.map);

    // Haul Road Center
    L.polyline(haulRoadCoords, {
      color: '#38bdf8',
      weight: 2,
      opacity: 0.9,
    }).addTo(this.map);

    // 2. Draw Key NMDC Pit Infrastructure Zones
    // Jaw Crusher Plant
    L.circle([18.7105, 81.2525], {
      radius: 65,
      color: '#f59e0b',
      fillColor: '#f59e0b',
      fillOpacity: 0.25,
      weight: 2,
    }).bindPopup("<b>Primary Jaw Crusher Hopper #1</b><br>Deposit 14 Crushing Station<br>Capacity: 3,000 TPH").addTo(this.map);

    // Shovel Loading Face
    L.circle([18.7185, 81.2510], {
      radius: 75,
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.2,
      weight: 2,
    }).bindPopup("<b>Bench 14 - East Loading Face</b><br>High-Grade Hematite Iron Ore<br>Shovel: P&H 1900AL").addTo(this.map);

    // Fog Valley Hazard Choke Point
    L.polygon([
      [18.7150, 81.2530],
      [18.7135, 81.2555],
      [18.7125, 81.2545],
      [18.7138, 81.2520],
    ], {
      color: '#ef4444',
      fillColor: '#64748b',
      fillOpacity: 0.45,
      weight: 2,
      dashArray: '4, 4',
    }).bindPopup("<b>⚠️ FOG VALLEY CHOKE POINT</b><br>Zero-Visibility Heavy Fog Zone<br>Speed Limit: 15 km/h").addTo(this.map);

    // 3. Dynamic Fog Density Layer (Semi-transparent overlay over pit)
    this.fogLayer = L.circle(this.pitCenter, {
      radius: 800,
      color: '#94a3b8',
      fillColor: '#0f172a',
      fillOpacity: 0.4,
      weight: 0,
    }).addTo(this.map);
  }

  _createVehicleIcon(vehicleId, vehicleType, headingDeg, collisionState, isSelected) {
    let iconColor = "#38bdf8";
    if (collisionState === "CRITICAL") iconColor = "#ef4444";
    else if (collisionState === "ADVISORY") iconColor = "#f59e0b";
    else if (vehicleType === "SHOVEL") iconColor = "#10b981";
    else if (vehicleType === "LIGHT_VEHICLE") iconColor = "#a855f7";

    const pulseClass = collisionState === "CRITICAL" ? "animate-pulse" : "";
    const borderStyle = isSelected ? "border: 2px solid #ffffff; box-shadow: 0 0 15px " + iconColor + ";" : "";

    const html = `
      <div style="position: relative; width: 34px; height: 34px; transform: rotate(${headingDeg}deg);" class="${pulseClass}">
        <div style="width: 32px; height: 32px; border-radius: 6px; background-color: #0f172a; border: 2px solid ${iconColor}; display: flex; align-items: center; justify-content: center; ${borderStyle}">
          <span style="font-size: 14px;">${vehicleType === 'SHOVEL' ? '⛏️' : (vehicleType === 'DOZER' ? '🚜' : (vehicleType === 'LIGHT_VEHICLE' ? '🚙' : '🚛'))}</span>
        </div>
        <div style="position: absolute; top: -6px; left: 12px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid ${iconColor};"></div>
      </div>
      <div style="position: absolute; top: 34px; left: -15px; width: 64px; text-align: center; font-size: 9px; font-family: monospace; font-weight: bold; background: rgba(15,23,42,0.85); color: #f1f5f9; border-radius: 3px; border: 1px solid #334155; padding: 1px 2px;">
        ${vehicleId.replace('HEMM-', '')}
      </div>
    `;

    return L.divIcon({
      className: 'custom-hemm-icon',
      html: html,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  update(primaryTelemetry, fleetList, fogDensity) {
    if (!this.map) return;

    // Update fog density visual opacity
    if (this.fogLayer && fogDensity !== undefined) {
      this.fogLayer.setStyle({ fillOpacity: Math.max(0.15, Math.min(0.7, fogDensity * 0.65)) });
    }

    // Process all fleet machines
    const allVehicles = fleetList || [];
    
    // Ensure primary vehicle is included
    const activeIds = new Set();

    allVehicles.forEach(v => {
      activeIds.add(v.vehicle_id);
      const isSel = (v.vehicle_id === this.selectedVehicle);
      const latLng = [v.gps.lat, v.gps.lng];

      const customIcon = this._createVehicleIcon(
        v.vehicle_id,
        v.vehicle_type,
        v.heading_deg,
        v.collision_state,
        isSel
      );

      if (this.markers[v.vehicle_id]) {
        this.markers[v.vehicle_id].setLatLng(latLng);
        this.markers[v.vehicle_id].setIcon(customIcon);
      } else {
        const marker = L.marker(latLng, { icon: customIcon }).addTo(this.map);
        marker.bindPopup(`
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
            <b style="color: #38bdf8; font-size: 13px;">${v.vehicle_id}</b><br>
            <b>Model:</b> ${v.vehicle_name}<br>
            <b>Operator:</b> ${v.operator_name}<br>
            <b>Zone:</b> ${v.current_zone}<br>
            <b>Speed:</b> ${v.speed_kmh} km/h<br>
            <b>Payload:</b> ${v.payload_tons} Tons<br>
            <b>Status:</b> <span style="color:${v.collision_state === 'CRITICAL' ? '#ef4444' : '#10b981'}">${v.status}</span>
          </div>
        `);
        this.markers[v.vehicle_id] = marker;
      }
    });

    // Center map on selected truck if required
    if (this.selectedVehicle && this.markers[this.selectedVehicle]) {
      // Optional gentle panning
    }
  }
}

window.DispatchMapRenderer = DispatchMapRenderer;
