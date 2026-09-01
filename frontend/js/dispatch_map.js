/**
 * Central Mine Dispatch & Digital Twin View Map (High Performance Optimized)
 * Leaflet.js map for NMDC Bailadila Iron Ore Complex (Deposit 14 / Deposit 5 Sector)
 */

class DispatchMapRenderer {
  constructor(mapContainerId) {
    this.containerId = mapContainerId;
    this.map = null;
    this.markers = {};
    this.fogLayer = null;
    this.pitCenter = [18.7145, 81.2525];
    this.selectedVehicle = "HEMM-DUMP-07";
    this.lastMapUpdate = 0;

    this.initMap();
  }

  initMap() {
    const container = document.getElementById(this.containerId);
    if (!container || typeof L === 'undefined') return;

    this.map = L.map(this.containerId, {
      center: this.pitCenter,
      zoom: 15,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(this.map);

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

    L.polyline(haulRoadCoords, { color: '#06b6d4', weight: 4, opacity: 0.8, dashArray: '6, 6' }).addTo(this.map);

    L.circle([18.7105, 81.2525], { radius: 65, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.25, weight: 1 }).bindPopup("<b>Primary Jaw Crusher #1</b>").addTo(this.map);
    L.circle([18.7185, 81.2510], { radius: 75, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.2, weight: 1 }).bindPopup("<b>Bench 14 Loading Face</b>").addTo(this.map);

    this.fogLayer = L.circle(this.pitCenter, { radius: 800, color: '#94a3b8', fillColor: '#0f172a', fillOpacity: 0.35, weight: 0 }).addTo(this.map);
  }

  _createVehicleIcon(vehicleId, vehicleType, headingDeg, collisionState, isSelected) {
    let iconColor = "#38bdf8";
    if (collisionState === "CRITICAL") iconColor = "#ef4444";
    else if (collisionState === "ADVISORY") iconColor = "#f59e0b";
    else if (vehicleType === "SHOVEL") iconColor = "#10b981";
    else if (vehicleType === "LIGHT_VEHICLE") iconColor = "#a855f7";

    const pulseClass = collisionState === "CRITICAL" ? "animate-pulse" : "";
    const borderStyle = isSelected ? `border: 2px solid #ffffff; box-shadow: 0 0 15px ${iconColor};` : "";

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

    // Throttle map updates to ~4 Hz for ultra-smooth map panning
    const now = Date.now();
    if (now - this.lastMapUpdate < 250) return;
    this.lastMapUpdate = now;

    const allVehicles = fleetList || [];
    allVehicles.forEach(v => {
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
        this.markers[v.vehicle_id] = marker;
      }
    });
  }
}

window.DispatchMapRenderer = DispatchMapRenderer;
