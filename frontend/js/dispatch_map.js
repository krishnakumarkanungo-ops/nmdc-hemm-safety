/**
 * Central Mine Dispatch & Digital Twin View Map (Google Maps Satellite Hybrid)
 * Real-Time Fleet & Demo Vehicle Tracking for NMDC Bailadila Iron Ore Complex (Deposit 14 / Deposit 5 Sector)
 * Uses high-resolution Google Maps satellite imagery with haul road overlays & animated demo vehicle.
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
    this.hasAutoCentered = false;

    this.initMap();
  }

  initMap() {
    const container = document.getElementById(this.containerId);
    if (!container || typeof L === 'undefined' || container._leaflet_id) return;

    try {
      this.map = L.map(this.containerId, {
        center: this.pitCenter,
        zoom: 16,
        zoomControl: true,
        attributionControl: false,
      });

      // Genuine Google Maps Satellite Hybrid (Photographic Satellite + Road & Terrain Labels)
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['0', '1', '2', '3'],
        attribution: '&copy; Google Maps Satellite',
      }).addTo(this.map);

      // Haul Road Route Overlay (Neon Cyan Route Guideline)
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

      L.polyline(haulRoadCoords, {
        color: '#06b6d4',
        weight: 5,
        opacity: 0.9,
        dashArray: '8, 8'
      }).addTo(this.map);

      // Key Mining Waypoints
      L.circle([18.7105, 81.2525], { radius: 60, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.4, weight: 2 })
        .bindPopup("<b style='color:#0f172a;'>Primary Jaw Crusher #1</b>")
        .addTo(this.map);

      L.circle([18.7185, 81.2510], { radius: 70, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.35, weight: 2 })
        .bindPopup("<b style='color:#0f172a;'>Bench 14 Loading Face</b>")
        .addTo(this.map);

      // Fog Overlay
      this.fogLayer = L.circle(this.pitCenter, { radius: 950, color: '#38bdf8', fillColor: '#0f172a', fillOpacity: 0.18, weight: 1.5 })
        .addTo(this.map);

      // Watermarked Badge: Google Maps Satellite View
      const mapBadge = L.control({ position: 'bottomleft' });
      mapBadge.onAdd = function() {
        const div = L.DomUtil.create('div', 'google-map-tag');
        div.innerHTML = `
          <div style="background: rgba(15,23,42,0.85); border: 1px solid #0284c7; color: #38bdf8; font-family: monospace; font-size: 10px; font-weight: bold; padding: 3px 8px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.5);">
            🗺️ GOOGLE MAPS SATELLITE (DEPOSIT 14 PIT)
          </div>
        `;
        return div;
      };
      mapBadge.addTo(this.map);

    } catch (e) {
      console.warn("Leaflet Google Map initialization deferred:", e);
    }
  }

  _createVehicleIcon(vehicleId, vehicleName, vehicleType, headingDeg, collisionState, isSelected, isDemo) {
    let iconColor = isDemo ? "#f59e0b" : "#38bdf8";
    if (collisionState === "CRITICAL") iconColor = "#ef4444";
    else if (collisionState === "ADVISORY") iconColor = "#f59e0b";
    else if (vehicleType === "SHOVEL") iconColor = "#10b981";
    else if (vehicleType === "LIGHT_VEHICLE") iconColor = "#a855f7";

    const pulseClass = (collisionState === "CRITICAL" || isDemo) ? "animate-pulse" : "";
    const borderStyle = isDemo 
      ? `border: 2.5px solid #f59e0b; box-shadow: 0 0 16px rgba(245,158,11,0.9);` 
      : (isSelected ? `border: 2px solid #ffffff; box-shadow: 0 0 14px ${iconColor};` : `border: 2px solid ${iconColor};`);

    const symbol = vehicleType === 'SHOVEL' ? '⛏️' : (vehicleType === 'DOZER' ? '🚜' : (vehicleType === 'LIGHT_VEHICLE' ? '🚙' : '🚛'));
    const label = isDemo ? "DEMO VEHICLE" : (vehicleId.replace('HEMM-', ''));

    const html = `
      <div style="position: relative; width: 40px; height: 40px;">
        <div style="width: 38px; height: 38px; border-radius: 8px; background-color: #0b1120; display: flex; align-items: center; justify-content: center; ${borderStyle}" class="${pulseClass}">
          <span style="font-size: 18px;">${symbol}</span>
        </div>
      </div>
      <div style="position: absolute; top: 40px; left: -26px; width: 92px; text-align: center; font-size: 9px; font-family: monospace; font-weight: bold; background: ${isDemo ? 'rgba(180,83,9,0.95)' : 'rgba(15,23,42,0.92)'}; color: ${isDemo ? '#fef3c7' : '#f8fafc'}; border-radius: 3px; border: 1px solid ${isDemo ? '#f59e0b' : '#475569'}; padding: 1.5px 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.6);">
        ${label}
      </div>
    `;

    return L.divIcon({
      className: 'custom-hemm-icon',
      html: html,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  clearMarkers() {
    Object.values(this.markers).forEach(m => {
      try { this.map?.removeLayer(m); } catch (e) {}
    });
    this.markers = {};
  }

  update(primaryTelemetry, fleetList, fogDensity, isHardwareMode = false, hasHardwareIngested = false) {
    if (!this.map) return;

    // Build consolidated vehicle list — ALWAYS keep Demo Vehicle on map!
    const allVehicles = (fleetList && fleetList.length > 0) ? [...fleetList] : [];
    if (primaryTelemetry && !allVehicles.some(v => v.vehicle_id === primaryTelemetry.vehicle_id)) {
      allVehicles.unshift(primaryTelemetry);
    }

    // Default fallback if no telemetry yet
    if (allVehicles.length === 0) {
      allVehicles.push({
        vehicle_id: "HEMM-DUMP-07",
        vehicle_name: "CAT 777D Dump Truck (Demo Vehicle)",
        vehicle_type: "DUMP_TRUCK",
        lat: 18.7145,
        lng: 81.2525,
        speed_kmh: 16.0,
        heading_deg: 182.0,
        collision_state: "CLEAR",
        status: "HAULING (DEMO ACTIVE)",
      });
    }

    const activeIds = new Set(allVehicles.map(v => v.vehicle_id));

    // Remove obsolete markers
    Object.keys(this.markers).forEach(id => {
      if (!activeIds.has(id)) {
        try { this.map.removeLayer(this.markers[id]); } catch (e) {}
        delete this.markers[id];
      }
    });
    
    allVehicles.forEach(v => {
      if (!v || !v.vehicle_id) return;
      const isDemo = (v.vehicle_id === "HEMM-DUMP-07" || v.vehicle_id.includes("DEMO"));
      const isSel = (v.vehicle_id === this.selectedVehicle) || isDemo;
      
      const lat = (v.gps && v.gps.lat !== undefined) ? v.gps.lat : (v.lat || 18.7145);
      const lng = (v.gps && v.gps.lng !== undefined) ? v.gps.lng : (v.lng || 81.2525);
      const latLng = [lat, lng];

      // Auto-center map once on Demo Vehicle position
      if (isDemo && !this.hasAutoCentered) {
        this.map.setView(latLng, 16);
        this.hasAutoCentered = true;
      }

      const customIcon = this._createVehicleIcon(
        v.vehicle_id,
        v.vehicle_name || "HEMM Vehicle",
        v.vehicle_type || "DUMP_TRUCK",
        v.heading_deg || 180.0,
        v.collision_state || "CLEAR",
        isSel,
        isDemo
      );

      const popupContent = `
        <div style="font-family: monospace; font-size: 11px; color: #0f172a; padding: 4px; min-width: 170px;">
          <b style="color: ${isDemo ? '#d97706' : '#0284c7'}; font-size: 12px;">${isDemo ? '⭐ DEMO VEHICLE' : 'HEMM FLEET UNIT'}</b><br/>
          <b>ID:</b> ${v.vehicle_id}<br/>
          <b>Model:</b> ${v.vehicle_name || 'CAT 777D'}<br/>
          <b>Speed:</b> ${v.speed_kmh || 0} km/h<br/>
          <b>Heading:</b> ${Math.round(v.heading_deg || 0)}°<br/>
          <b>Status:</b> ${v.status || 'HAULING'}<br/>
          <b>GPS:</b> ${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E
        </div>
      `;

      if (this.markers[v.vehicle_id]) {
        this.markers[v.vehicle_id].setLatLng(latLng);
        this.markers[v.vehicle_id].setIcon(customIcon);
        this.markers[v.vehicle_id].getPopup()?.setContent(popupContent);
      } else {
        const marker = L.marker(latLng, { icon: customIcon }).addTo(this.map);
        marker.bindPopup(popupContent);
        this.markers[v.vehicle_id] = marker;
      }
    });
  }
}

window.DispatchMapRenderer = DispatchMapRenderer;
