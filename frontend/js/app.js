/**
 * Master Application Controller & WebSocket Pipeline
 * HEMM Operator & Fleet Safety System (NMDC Bailadila Sector)
 */

class HEMMSafetyApp {
  constructor() {
    this.ws = null;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;
    this.reconnectTimer = null;
    this.currentView = "HUD"; // "HUD", "DISPATCH", "DUAL"
    this.audioAlarm = window.cabAudio;
    this.lastPacket = null;

    // Active vehicle selection (from URL query param ?vehicle=HEMM-DUMP-02 or default)
    const urlParams = new URLSearchParams(window.location.search);
    this.activeVehicleId = urlParams.get('vehicle') || "HEMM-DUMP-07";

    // Component Renderers
    this.radarRenderer = null;
    this.thermalRenderer = null;
    this.arLaneRenderer = null;
    this.dispatchMap = null;

    this.init();
  }

  init() {
    // Sync vehicle selector dropdown
    const selectVeh = document.getElementById("select-active-vehicle");
    if (selectVeh) {
      selectVeh.value = this.activeVehicleId;
      selectVeh.addEventListener("change", (e) => {
        this.activeVehicleId = e.target.value;
        if (this.dispatchMap) this.dispatchMap.selectedVehicle = this.activeVehicleId;
      });
    }

    // 1. Initialize Renderers
    this.radarRenderer = new RadarScopeRenderer("radar-canvas");
    this.thermalRenderer = new ThermalVisionRenderer("thermal-canvas");
    this.arLaneRenderer = new ARLaneHUDRenderer("ar-lane-canvas");
    this.dispatchMap = new DispatchMapRenderer("dispatch-map-container");
    if (this.dispatchMap) this.dispatchMap.selectedVehicle = this.activeVehicleId;

    // 2. Setup Event Listeners
    this.setupUIHandlers();

    // 3. Connect WebSocket Stream
    this.connectWebSocket();

    // 4. Start incident polling fallback
    this.fetchIncidents();
  }

  setupUIHandlers() {
    // Audio unlock on user interaction
    const unlockAudio = () => {
      if (this.audioAlarm) {
        this.audioAlarm.initContext();
      }
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    // View Switcher Buttons
    document.getElementById("btn-view-hud")?.addEventListener("click", () => this.switchView("HUD"));
    document.getElementById("btn-view-dispatch")?.addEventListener("click", () => this.switchView("DISPATCH"));
    document.getElementById("btn-view-dual")?.addEventListener("click", () => this.switchView("DUAL"));

    // Audio Controls
    const muteBtn = document.getElementById("btn-audio-mute");
    muteBtn?.addEventListener("click", () => {
      const isMuted = !this.audioAlarm.isMuted;
      this.audioAlarm.setMute(isMuted);
      muteBtn.innerHTML = isMuted 
        ? `<span class="text-slate-400">🔇 AUDIO MUTED</span>` 
        : `<span class="text-emerald-400">🔊 AUDIO ALARM ACTIVE</span>`;
    });

    const volSlider = document.getElementById("slider-volume");
    volSlider?.addEventListener("input", (e) => {
      this.audioAlarm.setVolume(parseFloat(e.target.value));
    });

    // Thermal Palette Switcher
    document.querySelectorAll(".btn-thermal-palette").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const pal = e.target.getAttribute("data-palette");
        document.querySelectorAll(".btn-thermal-palette").forEach(b => b.classList.remove("bg-cyan-600", "text-white"));
        e.target.classList.add("bg-cyan-600", "text-white");
        this.thermalRenderer.setPalette(pal);
      });
    });

    // Hazard Injection Quick Triggers
    document.querySelectorAll(".btn-hazard-trigger").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const hazardType = e.currentTarget.getAttribute("data-hazard");
        const dist = parseFloat(e.currentTarget.getAttribute("data-dist") || "7.0");
        this.injectHazard(hazardType, dist);
      });
    });

    // Hardware Mode Toggle
    document.getElementById("btn-toggle-mode")?.addEventListener("click", () => {
      this.toggleMode();
    });

    // Incident Export Buttons
    document.getElementById("btn-export-incidents")?.addEventListener("click", () => {
      this.exportIncidentsCSV();
    });
    document.getElementById("btn-clear-incidents")?.addEventListener("click", () => {
      this.clearIncidents();
    });

    // Notes Modal Handlers
    document.getElementById("btn-open-notes")?.addEventListener("click", () => {
      document.getElementById("notes-modal")?.classList.remove("hidden");
      this.fetchNotes();
    });
    document.getElementById("btn-close-notes-modal")?.addEventListener("click", () => {
      document.getElementById("notes-modal")?.classList.add("hidden");
    });
    document.getElementById("btn-submit-note")?.addEventListener("click", () => {
      this.submitNote();
    });
    document.getElementById("btn-export-notes-csv")?.addEventListener("click", () => {
      this.exportNotesCSV();
    });

    // Hardware Docs Modal
    document.getElementById("btn-hw-guide")?.addEventListener("click", () => {
      document.getElementById("hw-modal")?.classList.remove("hidden");
    });
    document.getElementById("btn-close-hw-modal")?.addEventListener("click", () => {
      document.getElementById("hw-modal")?.classList.add("hidden");
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    const hudContainer = document.getElementById("operator-hud-view");
    const dispatchContainer = document.getElementById("dispatch-twin-view");

    document.querySelectorAll(".btn-view-tab").forEach(b => {
      b.classList.remove("bg-cyan-600", "text-white", "border-cyan-400");
      b.classList.add("text-slate-300");
    });

    const activeBtn = document.getElementById(`btn-view-${viewName.toLowerCase()}`);
    if (activeBtn) {
      activeBtn.classList.add("bg-cyan-600", "text-white", "border-cyan-400");
      activeBtn.classList.remove("text-slate-300");
    }

    if (viewName === "HUD") {
      hudContainer?.classList.remove("hidden");
      dispatchContainer?.classList.add("hidden");
      hudContainer?.classList.remove("lg:w-1/2");
    } else if (viewName === "DISPATCH") {
      hudContainer?.classList.add("hidden");
      dispatchContainer?.classList.remove("hidden");
      dispatchContainer?.classList.remove("lg:w-1/2");
      if (this.dispatchMap && this.dispatchMap.map) {
        setTimeout(() => this.dispatchMap.map.invalidateSize(), 200);
      }
    } else if (viewName === "DUAL") {
      hudContainer?.classList.remove("hidden");
      dispatchContainer?.classList.remove("hidden");
      if (this.dispatchMap && this.dispatchMap.map) {
        setTimeout(() => this.dispatchMap.map.invalidateSize(), 200);
      }
    }

    // Trigger canvas resize
    setTimeout(() => {
      this.radarRenderer?.resize();
      this.thermalRenderer?.resize();
      this.arLaneRenderer?.resize();
    }, 150);
  }

  connectWebSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }

    const statusLed = document.getElementById("ws-status-led");
    const statusText = document.getElementById("ws-status-text");

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        if (statusLed) statusLed.className = "led-indicator led-green";
        if (statusText) statusText.innerText = "STREAM ONLINE (15 Hz)";
        console.log("WebSocket connected to HEMM Telemetry Stream.");
      };

      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.processTelemetryPacket(packet);
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      };

      this.ws.onclose = () => {
        if (statusLed) statusLed.className = "led-indicator led-red";
        if (statusText) statusText.innerText = "STREAM RECONNECTING...";
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn("WebSocket error:", err);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
  }

  processTelemetryPacket(packet) {
    this.lastPacket = packet;

    // Route telemetry for the actively selected vehicle
    const activePacket = (packet.all_vehicles_telemetry && packet.all_vehicles_telemetry[this.activeVehicleId]) 
      ? packet.all_vehicles_telemetry[this.activeVehicleId] 
      : packet;

    // 1. Update Collision Alert Banner
    this.updateCollisionBanner(activePacket);

    // 2. Update Web Audio Tone
    this.audioAlarm.updateState(activePacket.collision_state);

    // 3. Update mmWave Radar Canvas
    this.radarRenderer?.update(activePacket.radar, activePacket.collision_state);

    // 4. Update Thermal Infrared Canvas
    const hotspotInfo = {
      detected: activePacket.hotspot_detected,
      gx: activePacket.hotspot_grid_x,
      gy: activePacket.hotspot_grid_y,
      temp: activePacket.hotspot_temp_c,
      label: activePacket.hotspot_label,
    };
    this.thermalRenderer?.update(
      activePacket.thermal_matrix,
      activePacket.thermal_min_c,
      activePacket.thermal_max_c,
      hotspotInfo
    );

    // 5. Update Virtual Haul Lane AR Projection
    this.arLaneRenderer?.update(
      activePacket.berm_proximity,
      activePacket.fog_density,
      activePacket.visibility_m,
      activePacket.collision_state,
      activePacket.radar
    );

    // 6. Update Central Dispatch Map & Fleet Digital Twin (receives full fleet data)
    this.dispatchMap?.update(activePacket, packet.fleet_summary, activePacket.fog_density);

    // 7. Update Digital Instrument Cluster & Telemetry Gauges
    this.updateInstrumentCluster(activePacket);

    // 8. Throttle Dispatch Overview Cards & Table to 2 Hz (prevents browser DOM lag)
    const now = Date.now();
    if (!this.lastDispatchDomUpdate || now - this.lastDispatchDomUpdate > 500) {
      this.lastDispatchDomUpdate = now;
      this.updateDispatchCards(packet);
    }
  }

  updateCollisionBanner(packet) {
    const banner = document.getElementById("collision-alert-banner");
    const stateText = document.getElementById("collision-state-title");
    const subText = document.getElementById("collision-state-subtitle");
    const distText = document.getElementById("stat-obstacle-distance");
    const relSpeedText = document.getElementById("stat-rel-speed");
    const ttcText = document.getElementById("stat-ttc");
    const safeBrakeText = document.getElementById("stat-safe-braking");

    if (!banner) return;

    banner.classList.remove("state-clear", "state-advisory", "state-critical");

    const state = packet.collision_state;
    const targetDetected = packet.radar?.target_detected;
    const dist = packet.radar?.distance_m;
    const relSpeed = packet.radar?.relative_speed_kmh;

    if (state === "CRITICAL") {
      banner.classList.add("state-critical");
      if (stateText) stateText.innerHTML = `<span class="animate-flash-fast glow-red">🚨 CRITICAL BRAKE NOW — IMMEDIATE OBSTACLE</span>`;
      if (subText) subText.innerText = "EMERGENCY RETARDER BRAKING ENGAGED | COLLISION IMMINENT";
    } else if (state === "ADVISORY") {
      banner.classList.add("state-advisory");
      if (stateText) stateText.innerHTML = `<span class="glow-amber">⚠️ PROXIMITY ADVISORY — OBSTACLE DETECTED</span>`;
      if (subText) subText.innerText = "MAINTAIN BRAKING DISTANCE | REDUCE SPEED BELOW 15 KM/H";
    } else {
      banner.classList.add("state-clear");
      if (stateText) stateText.innerHTML = `<span class="glow-green">🛡️ HAUL ROAD CLEAR — ZERO-VISIBILITY ASSIST ACTIVE</span>`;
      if (subText) subText.innerText = "LIDAR / 77 GHz mmWAVE & THERMAL GUIDANCE ENGAGED";
    }

    if (distText) distText.innerText = targetDetected && dist < 900 ? `${dist.toFixed(1)} m` : "-- m";
    if (relSpeedText) relSpeedText.innerText = targetDetected ? `${relSpeed > 0 ? "+" : ""}${relSpeed.toFixed(1)} km/h` : "-- km/h";
    if (ttcText) ttcText.innerText = packet.time_to_collision_s ? `${packet.time_to_collision_s.toFixed(1)} s` : "-- s";
    
    // Calculate required safe stopping distance: d = v^2 / (2 * a) + reaction
    const vMps = (packet.speed_kmh * 1000) / 3600;
    const brakeDist = (vMps * vMps) / (2 * 2.8) + (vMps * 0.75);
    if (safeBrakeText) safeBrakeText.innerText = `${brakeDist.toFixed(1)} m`;
  }

  updateInstrumentCluster(packet) {
    const elSpeed = document.getElementById("hud-speed");
    const elHeading = document.getElementById("hud-heading");
    const elGear = document.getElementById("hud-gear");
    const elRpm = document.getElementById("hud-rpm");
    const elBrake = document.getElementById("hud-brake-psi");
    const elPitch = document.getElementById("hud-pitch");
    const elRoll = document.getElementById("hud-roll");
    const elPayload = document.getElementById("hud-payload");
    const elZone = document.getElementById("hud-zone");
    const elGps = document.getElementById("hud-gps");
    const elVisibility = document.getElementById("hud-visibility");
    const elModeTag = document.getElementById("hud-mode-tag");

    if (elSpeed) elSpeed.innerText = packet.speed_kmh.toFixed(1);
    if (elHeading) elHeading.innerText = `${Math.round(packet.heading_deg)}°`;
    if (elGear) elGear.innerText = packet.gear || "D3";
    if (elRpm) elRpm.innerText = packet.rpm || "1650";
    if (elBrake) elBrake.innerText = `${packet.brake_pressure_psi.toFixed(0)} PSI`;
    if (elPitch) elPitch.innerText = `${packet.pitch_deg > 0 ? "+" : ""}${packet.pitch_deg.toFixed(1)}°`;
    if (elRoll) elRoll.innerText = `${packet.roll_deg > 0 ? "+" : ""}${packet.roll_deg.toFixed(1)}°`;
    if (elPayload) elPayload.innerText = `${packet.payload_tons.toFixed(1)} T`;
    if (elZone) elZone.innerText = packet.zone_name || "Deposit 14 Haul Ramp";
    if (elGps) elGps.innerText = `${packet.gps.lat.toFixed(5)} N, ${packet.gps.lng.toFixed(5)} E (${packet.gps.altitude_m}m)`;
    if (elVisibility) elVisibility.innerText = `${packet.visibility_m.toFixed(1)}m`;
    if (elModeTag) elModeTag.innerText = packet.mode || "SIMULATION";
  }

  updateDispatchCards(packet) {
    const fleetList = packet.fleet_summary || [];
    const activeCount = fleetList.length;
    const criticalCount = fleetList.filter(f => f.collision_state === "CRITICAL").length;

    const elActiveFleet = document.getElementById("disp-active-fleet");
    const elSafetyIndex = document.getElementById("disp-safety-index");
    const elIncidentCount = document.getElementById("disp-incident-count");
    const elAvgCycle = document.getElementById("disp-avg-cycle");

    if (elActiveFleet) elActiveFleet.innerText = `${activeCount} Units`;
    
    // Road Safety Index Calculation
    const safetyIndex = Math.max(45, 100 - (criticalCount * 25) - (packet.active_hazard !== "NONE" ? 15 : 0));
    if (elSafetyIndex) {
      elSafetyIndex.innerText = `${safetyIndex}%`;
      elSafetyIndex.className = safetyIndex > 80 ? "text-emerald-400 font-bold" : (safetyIndex > 60 ? "text-amber-400 font-bold" : "text-rose-500 font-bold");
    }

    if (elIncidentCount) elIncidentCount.innerText = packet.incident_count || "0";
    if (elAvgCycle) elAvgCycle.innerText = "28.4 min";

    // Update Fleet Table
    const tbody = document.getElementById("fleet-table-body");
    if (tbody && fleetList.length > 0) {
      tbody.innerHTML = fleetList.map(v => {
        let statusBadge = `<span class="px-2 py-0.5 rounded text-xs bg-emerald-950 border border-emerald-500/50 text-emerald-300">${v.status}</span>`;
        if (v.collision_state === "CRITICAL") {
          statusBadge = `<span class="px-2 py-0.5 rounded text-xs bg-rose-950 border border-rose-500 text-rose-300 animate-pulse">EMERGENCY BRAKE</span>`;
        } else if (v.collision_state === "ADVISORY") {
          statusBadge = `<span class="px-2 py-0.5 rounded text-xs bg-amber-950 border border-amber-500 text-amber-300">ADVISORY</span>`;
        }

        return `
          <tr class="border-b border-slate-800 hover:bg-slate-800/40 text-xs font-mono">
            <td class="py-2 px-3 font-bold text-cyan-400">${v.vehicle_id}</td>
            <td class="py-2 px-3 text-slate-300">${v.vehicle_name}</td>
            <td class="py-2 px-3 text-slate-400">${v.current_zone}</td>
            <td class="py-2 px-3 text-slate-200">${v.speed_kmh} km/h</td>
            <td class="py-2 px-3 text-slate-300">${v.payload_tons} T</td>
            <td class="py-2 px-3">${statusBadge}</td>
          </tr>
        `;
      }).join("");
    }
  }

  async fetchIncidents() {
    try {
      const res = await fetch("/api/incidents");
      if (res.ok) {
        const incidents = await res.json();
        this.renderIncidentTable(incidents);
      }
    } catch (e) {}
    setTimeout(() => this.fetchIncidents(), 5000);
  }

  renderIncidentTable(incidents) {
    const container = document.getElementById("incident-log-body");
    if (!container) return;

    if (!incidents || incidents.length === 0) {
      container.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-500 text-xs font-mono">NO ZERO-VISIBILITY INCIDENTS LOGGED TODAY</td></tr>`;
      return;
    }

    container.innerHTML = incidents.slice(0, 8).map(inc => {
      const badge = inc.collision_state === "CRITICAL"
        ? `<span class="text-rose-400 font-bold">CRITICAL</span>`
        : `<span class="text-amber-400 font-bold">ADVISORY</span>`;

      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30 text-xs font-mono">
          <td class="py-2 px-2 text-slate-400">${inc.timestamp_str}</td>
          <td class="py-2 px-2 text-cyan-400 font-bold">${inc.vehicle_id}</td>
          <td class="py-2 px-2 text-slate-300">${inc.hazard_type}</td>
          <td class="py-2 px-2">${badge}</td>
          <td class="py-2 px-2 text-slate-200">${inc.distance_m} m</td>
          <td class="py-2 px-2 text-slate-400">${inc.action_taken}</td>
        </tr>
      `;
    }).join("");
  }

  async injectHazard(hazardType, distanceM) {
    try {
      const res = await fetch("/api/simulation/inject_hazard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hazard_type: hazardType, distance_m: distanceM }),
      });
      const data = await res.json();
      console.log("Hazard injected:", data);
      
      // Update UI active buttons
      document.querySelectorAll(".btn-hazard-trigger").forEach(b => {
        if (b.getAttribute("data-hazard") === hazardType) {
          b.classList.add("border-rose-500", "bg-rose-950/40");
        } else {
          b.classList.remove("border-rose-500", "bg-rose-950/40");
        }
      });
    } catch (e) {
      console.error("Failed to inject hazard:", e);
    }
  }

  async toggleMode() {
    try {
      const res = await fetch("/api/mode/toggle", { method: "POST" });
      const data = await res.json();
      const btn = document.getElementById("btn-toggle-mode");
      if (btn) {
        btn.innerText = `MODE: ${data.mode}`;
      }
    } catch (e) {}
  }

  async clearIncidents() {
    try {
      await fetch("/api/incidents/clear", { method: "POST" });
      this.fetchIncidents();
    } catch (e) {}
  }

  async fetchNotes() {
    try {
      const res = await fetch("/api/notes");
      if (res.ok) {
        const notes = await res.json();
        this.renderNotesList(notes);
      }
    } catch (e) {
      console.warn("Failed to fetch notes:", e);
    }
  }

  renderNotesList(notes) {
    const container = document.getElementById("notes-list-container");
    if (!container) return;

    if (!notes || notes.length === 0) {
      container.innerHTML = `<div class="text-center py-6 text-slate-500 text-xs font-mono">NO OPERATOR NOTES RECORDED YET</div>`;
      return;
    }

    container.innerHTML = notes.map(n => {
      let badgeColor = "bg-slate-800 text-slate-300 border-slate-700";
      if (n.category === "FOG_HAZARD") badgeColor = "bg-rose-950 text-rose-300 border-rose-500/50";
      else if (n.category === "BERM_CHECK") badgeColor = "bg-amber-950 text-amber-300 border-amber-500/50";
      else if (n.category === "INCIDENT") badgeColor = "bg-red-950 text-red-300 border-red-500";
      else if (n.category === "HANDOVER") badgeColor = "bg-cyan-950 text-cyan-300 border-cyan-500/50";

      return `
        <div class="p-3 bg-slate-950 rounded border border-slate-800 text-xs font-mono">
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded text-[10px] border ${badgeColor}">${n.category}</span>
              <span class="font-bold text-cyan-400">${n.vehicle_id}</span>
              <span class="text-slate-400">by ${n.author}</span>
            </div>
            <span class="text-slate-500 text-[11px]">${n.timestamp_str}</span>
          </div>
          <div class="text-slate-200 leading-relaxed">${n.content}</div>
        </div>
      `;
    }).join("");
  }

  async submitNote() {
    const author = document.getElementById("note-input-author")?.value || "Operator";
    const vehicle = document.getElementById("note-input-vehicle")?.value || "HEMM-DUMP-07";
    const category = document.getElementById("note-input-category")?.value || "GENERAL";
    const content = document.getElementById("note-input-content")?.value?.trim();

    if (!content) {
      alert("Please enter note content before saving.");
      return;
    }

    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, vehicle_id: vehicle, category, content }),
      });
      if (res.ok) {
        document.getElementById("note-input-content").value = "";
        this.fetchNotes();
      }
    } catch (e) {
      console.error("Failed to post note:", e);
    }
  }

  exportNotesCSV() {
    fetch("/api/notes")
      .then(res => res.json())
      .then(notes => {
        if (!notes || notes.length === 0) {
          alert("No notes to export.");
          return;
        }
        let csv = "ID,Timestamp,Author,VehicleID,Category,Content\n";
        notes.forEach(n => {
          csv += `"${n.id}","${n.timestamp_str}","${n.author}","${n.vehicle_id}","${n.category}","${n.content.replace(/"/g, '""')}"\n`;
        });
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `NMDC_Bailadila_Shift_Notes_${Date.now()}.csv`;
        a.click();
      });
  }

  exportIncidentsCSV() {
    fetch("/api/incidents")
      .then(res => res.json())
      .then(data => {
        if (!data || data.length === 0) {
          alert("No incident records to export.");
          return;
        }
        let csv = "ID,Timestamp,VehicleID,HazardType,CollisionState,DistanceM,SpeedKMH,VisibilityM,ActionTaken\n";
        data.forEach(d => {
          csv += `"${d.id}","${d.timestamp_str}","${d.vehicle_id}","${d.hazard_type}","${d.collision_state}",${d.distance_m},${d.speed_kmh},${d.visibility_m},"${d.action_taken}"\n`;
        });
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `NMDC_Bailadila_HEMM_Incidents_${Date.now()}.csv`;
        a.click();
      });
  }
}

// Instantiate on DOM load
window.addEventListener("DOMContentLoaded", () => {
  window.app = new HEMMSafetyApp();
});

