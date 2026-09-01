/**
 * Central Mine Dispatch & Digital Twin View Map (Guaranteed High-Res Satellite View)
 * Leaflet.js map for NMDC Bailadila Iron Ore Complex (Deposit 14 / Deposit 5 Sector)
 * Uses high-resolution free satellite imagery (no API key required) and live fleet markers.
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
    if (!container || typeof L === 'undefined' || container._leaflet_id) return;

    try {
      this.map = L.map(this.containerId, {
        center: this.pitCenter,
        zoom: 15,
        zoomControl: true,
        attributionControl: false,
      });

      // High-Resolution Satellite Pit Imagery (100% Free, No API Key Required)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        subdomains: ['server', 'services'],
      }).addTo(this.map);

      // Haul Road Route Overlay
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

      L.polyline(haulRoadCoords, { color: '#06b6d4', weight: 4, opacity: 0.9, dashArray: '6, 6' }).addTo(this.map);

      // Key Mining Waypoints
      L.circle([18.7105, 81.2525], { radius: 65, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.35, weight: 1.5 })
        .bindPopup("<b style='color:#0f172a;'>Primary Jaw Crusher #1</b>")
        .addTo(this.map);

      L.circle([18.7185, 81.2510], { radius: 75, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.3, weight: 1.5 })
        .bindPopup("<b style='color:#0f172a;'>Bench 14 Loading Face</b>")
        .addTo(this.map);

      // Fog Overlay
      this.fogLayer = L.circle(this.pitCenter, { radius: 850, color: '#38bdf8', fillColor: '#0f172a', fillOpacity: 0.25, weight: 1 })
        .addTo(this.map);

    } catch (e) {
      console.warn("Leaflet map initialization deferred:", e);
    }
  }

  _createVehicleIcon(vehicleId, vehicleType, headingDeg, collisionState, isSelected) {
    let iconColor = "#38bdf8";
    if (collisionState === "CRITICAL") iconColor = "#ef4444";
    else if (collisionState === "ADVISORY") iconColor = "#f59e0b";
    else if (vehicleType === "SHOVEL") iconColor = "#10b981";
    else if (vehicleType === "LIGHT_VEHICLE") iconColor = "#a855f7";

    const pulseClass = collisionState === "CRITICAL" ? "animate-pulse" : "";
    const borderStyle = isSelected ? `border: 2px solid #ffffff; box-shadow: 0 0 15px ${iconColor};` : `border: 2px solid ${iconColor};`;

    const symbol = vehicleType === 'SHOVEL' ? '⛏️' : (vehicleType === 'DOZER' ? '🚜' : (vehicleType === 'LIGHT_VEHICLE' ? '🚙' : '🚛'));

    const html = `
      <div style="position: relative; width: 34px; height: 34px;">
        <div style="width: 32px; height: 32px; border-radius: 6px; background-color: #0f172a; display: flex; align-items: center; justify-content: center; ${borderStyle}" class="${pulseClass}">
          <span style="font-size: 15px;">${symbol}</span>
        </div>
      </div>
      <div style="position: absolute; top: 34px; left: -18px; width: 70px; text-align: center; font-size: 9px; font-family: monospace; font-weight: bold; background: rgba(15,23,42,0.9); color: #f8fafc; border-radius: 3px; border: 1px solid #475569; padding: 1px 2px; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">
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

    const allVehicles = (fleetList && fleetList.length > 0) ? fleetList : (primaryTelemetry ? [primaryTelemetry] : []);
    
    allVehicles.forEach(v => {
      if (!v || !v.vehicle_id) return;
      const isSel = (v.vehicle_id === this.selectedVehicle);
      
      const lat = (v.gps && v.gps.lat !== undefined) ? v.gps.lat : (v.lat || 18.7145);
      const lng = (v.gps && v.gps.lng !== undefined) ? v.gps.lng : (v.lng || 81.2525);
      const latLng = [lat, lng];

      const customIcon = this._createVehicleIcon(
        v.vehicle_id,
        v.vehicle_type || "DUMP_TRUCK",
        v.heading_deg || 180.0,
        v.collision_state || "CLEAR",
        isSel
      );

      if (this.markers[v.vehicle_id]) {
        this.markers[v.vehicle_id].setLatLng(latLng);
        this.markers[v.vehicle_id].setIcon(customIcon);
      } else {
        const marker = L.marker(latLng, { icon: customIcon }).addTo(this.map);
        marker.bindPopup(`
          <div style="font-family: monospace; font-size: 11px; color: #0f172a; padding: 2px;">
            <b>${v.vehicle_id}</b><br/>
            Name: ${v.vehicle_name || 'HEMM Asset'}<br/>
            Speed: ${v.speed_kmh || 0} km/h<br/>
            Status: ${v.status || 'ACTIVE'}
          </div>
        `);
        this.markers[v.vehicle_id] = marker;
      }
    });
  }
}

window.DispatchMapRenderer = DispatchMapRenderer;
