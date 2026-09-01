/**
 * Main Application Controller (NMDC Bailadila HEMM Safety System)
 * Ultra-Responsive Decoupled 60 FPS Render Loop with Zero-Lag Input Handling
 */

function fastSetText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

class HEMMSafetyApp {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.currentView = "HUD"; // "HUD", "DISPATCH", "DUAL"
    this.latestPacket = null;
    this.hasNewPacket = false;
    this.activeVehicleId = "HEMM-DUMP-07";

    // Component Renderers
    this.radarRenderer = null;
    this.thermalRenderer = null;
    this.arLaneRenderer = null;
    this.dispatchMap = null;
    this.audioAlarm = window.cabAudio || null;

    // Throttle trackers
    this.lastDomUpdate = 0;
    this.lastDispatchTableUpdate = 0;

    this.init();
  }

  init() {
    // Parse URL parameter ?vehicle=HEMM-DUMP-07
    const urlParams = new URLSearchParams(window.location.search);
    const vehicleParam = urlParams.get("vehicle");
    if (vehicleParam) {
      this.activeVehicleId = vehicleParam.toUpperCase();
    }

    const selectVehicle = document.getElementById("select-active-vehicle");
    if (selectVehicle) {
      selectVehicle.value = this.activeVehicleId;
      selectVehicle.addEventListener("change", (e) => {
        this.activeVehicleId = e.target.value;
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("vehicle", this.activeVehicleId);
        window.history.replaceState({}, "", newUrl);
        if (this.dispatchMap) {
          this.dispatchMap.selectedVehicle = this.activeVehicleId;
        }
      });
    }

    // Initialize Renderers
    this.radarRenderer = new RadarScopeRenderer("radar-canvas");
    this.thermalRenderer = new ThermalVisionRenderer("thermal-canvas");
    this.arLaneRenderer = new ARLaneHUDRenderer("ar-lane-canvas");
    this.dispatchMap = new DispatchMapRenderer("dispatch-map");
    if (this.dispatchMap) {
      this.dispatchMap.selectedVehicle = this.activeVehicleId;
    }

    // Bind UI Event Listeners
    this.bindEvents();

    // Connect Real-Time Stream
    this.connectWebSocket();

    // Start 60 FPS Decoupled Animation Loop
    this.startRenderLoop();

    // Background Polling (Clean 10-second interval)
    this.fetchIncidents();
    setInterval(() => this.fetchIncidents(), 10000);
  }

  bindEvents() {
    // Unlock Audio Context on first interaction
    const unlockAudio = () => {
      if (this.audioAlarm) {
        this.audioAlarm.initContext();
      }
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
    window.addEventListener("click", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });

    // View Switcher Buttons
    document.getElementById("btn-view-hud")?.addEventListener("click", () => this.switchView("HUD"));
    document.getElementById("btn-view-dispatch")?.addEventListener("click", () => this.switchView("DISPATCH"));
    document.getElementById("btn-view-dual")?.addEventListener("click", () => this.switchView("DUAL"));

    // Audio Mute Toggle
    const btnMute = document.getElementById("btn-audio-mute");
    btnMute?.addEventListener("click", () => {
      if (!this.audioAlarm) return;
      const willMute = !this.audioAlarm.isMuted;
      this.audioAlarm.setMute(willMute);
      if (btnMute) {
        btnMute.innerHTML = willMute
          ? `<span class="text-rose-400">🔇 CAB AUDIO MUTED</span>`
          : `<span class="text-emerald-400">🔊 CAB AUDIO ACTIVE</span>`;
      }
    });

    // Thermal Palette Selectors
    document.querySelectorAll(".btn-thermal-palette").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const pal = e.target.getAttribute("data-palette");
        document.querySelectorAll(".btn-thermal-palette").forEach(b => b.classList.remove("bg-cyan-600", "text-white"));
        e.target.classList.add("bg-cyan-600", "text-white");
        this.thermalRenderer?.setPalette(pal);
      });
    });

    // Hazard Injection Triggers
    document.querySelectorAll(".btn-hazard-trigger").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const hazardType = e.currentTarget.getAttribute("data-hazard");
        const dist = parseFloat(e.currentTarget.getAttribute("data-dist") || "7.0");
        this.injectHazard(hazardType, dist);
      });
    });

    // Mode, Pause & Manual Driver Controls
    document.getElementById("btn-toggle-pause")?.addEventListener("click", () => this.togglePause());
    document.getElementById("btn-manual-accel")?.addEventListener("click", () => this.manualControl(5.0, false));
    document.getElementById("btn-manual-brake")?.addEventListener("click", () => this.manualControl(-10.0, true));
    document.getElementById("btn-toggle-mode")?.addEventListener("click", () => this.toggleMode());
    document.getElementById("btn-export-incidents")?.addEventListener("click", () => this.exportIncidentsCSV());
    document.getElementById("btn-clear-incidents")?.addEventListener("click", () => this.clearIncidents());

    // Keyboard Shortcuts (W = Accel, S = Brake, P = Pause, Space = Emergency Brake)
    window.addEventListener("keydown", (e) => {
      // Don't intercept when typing in notes textarea/inputs
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

      if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") {
        this.manualControl(4.0, false);
      } else if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") {
        this.manualControl(-6.0, false);
      } else if (e.key === " " || e.key === "Spacebar") {
        this.manualControl(0.0, true);
      } else if (e.key === "p" || e.key === "P") {
        this.togglePause();
      }
    });

    // Notes Modal Handlers
    document.getElementById("btn-open-notes")?.addEventListener("click", () => {
      const modal = document.getElementById("notes-modal");
      if (modal) {
        modal.style.display = "flex";
        modal.classList.remove("hidden");
      }
      this.fetchNotes();
    });
    document.getElementById("btn-close-notes-modal")?.addEventListener("click", () => {
      const modal = document.getElementById("notes-modal");
      if (modal) {
        modal.style.display = "none";
        modal.classList.add("hidden");
      }
    });
    document.getElementById("btn-submit-note")?.addEventListener("click", () => this.submitNote());
    document.getElementById("btn-export-notes-csv")?.addEventListener("click", () => this.exportNotesCSV());

    // Hardware Docs Modal
    document.getElementById("btn-hw-guide")?.addEventListener("click", () => {
      const modal = document.getElementById("hw-modal");
      if (modal) {
        modal.style.display = "flex";
        modal.classList.remove("hidden");
      }
    });
    document.getElementById("btn-close-hw-modal")?.addEventListener("click", () => {
      const modal = document.getElementById("hw-modal");
      if (modal) {
        modal.style.display = "none";
        modal.classList.add("hidden");
      }
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
      activeBtn.classList.remove("text-slate-300");
      activeBtn.classList.add("bg-cyan-600", "text-white", "border-cyan-400");
    }

    if (viewName === "HUD") {
      hudContainer?.classList.remove("hidden");
      dispatchContainer?.classList.add("hidden");
      dispatchContainer?.classList.remove("grid-cols-1", "lg:grid-cols-2");
    } else if (viewName === "DISPATCH") {
      hudContainer?.classList.add("hidden");
      dispatchContainer?.classList.remove("hidden");
      setTimeout(() => this.dispatchMap?.map?.invalidateSize(), 50);
    } else if (viewName === "DUAL") {
      hudContainer?.classList.remove("hidden");
      dispatchContainer?.classList.remove("hidden");
      setTimeout(() => this.dispatchMap?.map?.invalidateSize(), 50);
    }

    // Trigger canvas resize
    setTimeout(() => {
      this.radarRenderer?.resize();
      this.thermalRenderer?.resize();
      this.arLaneRenderer?.resize();
    }, 100);
  }

  connectWebSocket() {
    // 1. Cleanly disconnect any previous socket
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/telemetry`;

    const statusLed = document.getElementById("ws-status-led");
    const statusText = document.getElementById("ws-status-text");

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (statusLed) statusLed.className = "led-indicator led-green";
        if (statusText) statusText.innerText = "STREAM ONLINE (10 Hz)";
      };

      this.ws.onmessage = (event) => {
        try {
          this.latestPacket = JSON.parse(event.data);
          this.hasNewPacket = true;
        } catch (e) {}
      };

      this.ws.onclose = () => {
        if (statusLed) statusLed.className = "led-indicator led-red";
        if (statusText) statusText.innerText = "STREAM RECONNECTING...";
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 3000);
  }

  // Event-Driven Low-Latency Render Loop (Ultra-Low CPU Usage)
  startRenderLoop() {
    const frame = () => {
      if (this.hasNewPacket && this.latestPacket) {
        this.consumePacket(this.latestPacket);
        this.hasNewPacket = false;

        // Render Canvases on new packet arrival (10 Hz stream)
        if (this.currentView === "HUD" || this.currentView === "DUAL") {
          this.radarRenderer?.render();
          this.thermalRenderer?.render();
          this.arLaneRenderer?.render();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  consumePacket(packet) {
    const activePacket = (packet.all_vehicles_telemetry && packet.all_vehicles_telemetry[this.activeVehicleId]) 
      ? packet.all_vehicles_telemetry[this.activeVehicleId] 
      : packet;

    // 1. Audio Alarm update
    this.audioAlarm?.updateState(activePacket.collision_state);

    // 2. HUD Canvases data update
    if (this.currentView === "HUD" || this.currentView === "DUAL") {
      this.radarRenderer?.update(activePacket.radar, activePacket.collision_state);

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

      this.arLaneRenderer?.update(
        activePacket.berm_proximity,
        activePacket.fog_density,
        activePacket.visibility_m,
        activePacket.collision_state,
        activePacket.radar
      );
    }

    // 3. Dispatch Map update
    if (this.currentView === "DISPATCH" || this.currentView === "DUAL") {
      this.dispatchMap?.update(activePacket, packet.fleet_summary, activePacket.fog_density);
    }

    // 4. Update Collision Alert Banner
    this.updateCollisionBanner(activePacket);

    // 5. Throttled DOM Text & Gauges Update (100ms)
    const now = Date.now();
    if (now - this.lastDomUpdate > 100) {
      this.lastDomUpdate = now;
      this.updateInstrumentCluster(activePacket);
    }

    // 6. Throttled Fleet Table & Dispatch Cards Update (500ms)
    if (now - this.lastDispatchTableUpdate > 500) {
      this.lastDispatchTableUpdate = now;
      this.updateDispatchCards(packet);
    }
  }

  updateCollisionBanner(packet) {
    const banner = document.getElementById("collision-alert-banner");
    const stateText = document.getElementById("collision-state-title");
    const subText = document.getElementById("collision-state-subtitle");

    if (!banner) return;

    const state = packet.collision_state;
    const targetDetected = packet.radar?.target_detected;
    const dist = packet.radar?.distance_m;
    const relSpeed = packet.radar?.relative_speed_kmh;

    const currentClass = banner.getAttribute("data-state");
    if (currentClass !== state) {
      banner.setAttribute("data-state", state);
      banner.classList.remove("state-clear", "state-advisory", "state-critical");

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
    }

    fastSetText("stat-obstacle-distance", targetDetected && dist < 900 ? `${dist.toFixed(1)} m` : "-- m");
    fastSetText("stat-rel-speed", targetDetected ? `${relSpeed > 0 ? "+" : ""}${relSpeed.toFixed(1)} km/h` : "-- km/h");
    fastSetText("stat-ttc", packet.time_to_collision_s ? `${packet.time_to_collision_s.toFixed(1)} s` : "-- s");

    const vMps = (packet.speed_kmh * 1000) / 3600;
    const brakeDist = (vMps * vMps) / (2 * 2.8) + (vMps * 0.75);
    fastSetText("stat-safe-braking", `${brakeDist.toFixed(1)} m`);
  }

  updateInstrumentCluster(packet) {
    fastSetText("hud-speed", packet.speed_kmh.toFixed(1));
    fastSetText("hud-heading", `${Math.round(packet.heading_deg)}°`);
    fastSetText("hud-gear", packet.gear || "D3");
    fastSetText("hud-rpm", String(packet.rpm || "1650"));
    fastSetText("hud-brake-psi", `${packet.brake_pressure_psi.toFixed(0)} PSI`);
    fastSetText("hud-pitch", `${packet.pitch_deg > 0 ? "+" : ""}${packet.pitch_deg.toFixed(1)}°`);
    fastSetText("hud-roll", `${packet.roll_deg > 0 ? "+" : ""}${packet.roll_deg.toFixed(1)}°`);
    fastSetText("hud-payload", `${packet.payload_tons.toFixed(1)} T`);
    fastSetText("hud-zone", packet.zone_name || "Deposit 14 Haul Ramp");
    fastSetText("hud-gps", `${packet.gps.lat.toFixed(5)} N, ${packet.gps.lng.toFixed(5)} E (${packet.gps.altitude_m}m)`);
    fastSetText("hud-visibility", `${packet.visibility_m.toFixed(1)}m`);
    fastSetText("hud-mode-tag", packet.mode || "SIMULATION");
  }

  updateDispatchCards(packet) {
    const fleetList = packet.fleet_summary || [];
    const activeCount = fleetList.length;
    const criticalCount = fleetList.filter(f => f.collision_state === "CRITICAL").length;

    fastSetText("disp-active-fleet", `${activeCount} Units`);
    
    const safetyIndex = Math.max(45, 100 - (criticalCount * 25) - (packet.active_hazard !== "NONE" ? 15 : 0));
    const elSafetyIndex = document.getElementById("disp-safety-index");
    if (elSafetyIndex) {
      elSafetyIndex.innerText = `${safetyIndex}%`;
      elSafetyIndex.className = safetyIndex > 80 ? "text-emerald-400 font-bold" : (safetyIndex > 60 ? "text-amber-400 font-bold" : "text-rose-500 font-bold");
    }

    fastSetText("disp-incident-count", String(packet.incident_count || "0"));
    fastSetText("disp-avg-cycle", "28.4 min");

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

  async injectHazard(hazardType, distanceMeters) {
    try {
      const res = await fetch("/api/hazard/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hazard_type: hazardType, distance_m: distanceMeters, duration_s: 8.0 }),
      });
      if (res.ok) {
        this.fetchIncidents();
      }
    } catch (e) {}
  }

  async togglePause() {
    try {
      const res = await fetch("/api/simulation/pause", { method: "POST" });
      const data = await res.json();
      const btn = document.getElementById("btn-toggle-pause");
      if (btn) {
        btn.innerText = data.is_paused ? "▶️ RESUME" : "⏸️ PAUSE";
        btn.className = data.is_paused 
          ? "px-2.5 py-1.5 rounded bg-emerald-900 border border-emerald-500 text-xs font-mono text-emerald-200 font-bold animate-pulse" 
          : "px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-mono text-amber-300 font-semibold transition-all";
      }
    } catch (e) {}
  }

  async manualControl(speedDelta, brake = false, steerDelta = 0.0) {
    try {
      await fetch("/api/simulation/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed_delta: speedDelta, brake: brake, steer_delta: steerDelta }),
      });
    } catch (e) {}
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

  async fetchIncidents() {
    try {
      const res = await fetch("/api/incidents");
      if (res.ok) {
        const incidents = await res.json();
        this.renderIncidentTable(incidents);
      }
    } catch (e) {}
  }

  renderIncidentTable(incidents) {
    const container = document.getElementById("incident-log-body");
    if (!container) return;

    if (!incidents || incidents.length === 0) {
      container.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-500 text-xs font-mono">NO ZERO-VISIBILITY INCIDENTS LOGGED TODAY</td></tr>`;
      return;
    }

    container.innerHTML = incidents.slice(0, 10).map(inc => {
      let badgeClass = "bg-rose-950 text-rose-300 border-rose-500";
      if (inc.collision_state === "ADVISORY") badgeClass = "bg-amber-950 text-amber-300 border-amber-500";

      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/40 text-xs font-mono">
          <td class="py-2 px-3 text-slate-400">${inc.timestamp_str}</td>
          <td class="py-2 px-3 font-bold text-cyan-400">${inc.vehicle_id}</td>
          <td class="py-2 px-3 text-slate-200">${inc.hazard_type.replace('_', ' ')}</td>
          <td class="py-2 px-3 text-rose-400 font-bold">${inc.distance_m} m</td>
          <td class="py-2 px-3"><span class="px-2 py-0.5 rounded text-[10px] border ${badgeClass}">${inc.collision_state}</span></td>
          <td class="py-2 px-3 text-slate-300">${inc.action_taken}</td>
        </tr>
      `;
    }).join("");
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
    } catch (e) {}
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
    } catch (e) {}
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

// Robust instantiation for all page load states
function initHEMMSafetyApp() {
  if (!window.app) {
    window.app = new HEMMSafetyApp();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHEMMSafetyApp);
} else {
  initHEMMSafetyApp();
}
