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
    this.appMode = "HARDWARE"; // "HARDWARE" (default, production) or "DEMO_TRAINING" (training sandbox)
    this.latestPacket = null;
    this.hasNewPacket = false;
    this.activeVehicleId = "HEMM-DUMP-07";
    this.pairedVehicleName = null; // Custom hardware machine name added by user

    // Web Serial & Hardware Ingress State
    this.serialPort = null;
    this.serialReader = null;
    this.isSerialConnected = false;
    this.packetsIngestedCount = 0;

    // Shift Notes Unseen Tracking & Toast State
    this.seenNoteIds = new Set(["NOTE-001", "NOTE-002"]);
    this.toastDismissTimer = null;

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

    this.updateCabUnitOptions();

    // Initialize Renderers Safely
    try { this.radarRenderer = new RadarScopeRenderer("radar-canvas"); } catch (e) { console.error("Radar init error:", e); }
    try { this.thermalRenderer = new ThermalVisionRenderer("thermal-canvas"); } catch (e) { console.error("Thermal init error:", e); }
    try { this.arLaneRenderer = new ARLaneHUDRenderer("ar-lane-canvas"); } catch (e) { console.error("AR Lane init error:", e); }
    try {
      this.dispatchMap = new DispatchMapRenderer("dispatch-map");
      if (this.dispatchMap) this.dispatchMap.selectedVehicle = this.activeVehicleId;
    } catch (e) { console.error("Map init error:", e); }

    // Draw Instant Baseline Visuals (Never Blank on load)
    this.renderInitialState();

    // Bind UI Event Listeners
    this.bindEvents();

    // Instant HTTP fetch on start (0ms load)
    this.fetchTelemetryHttp();

    // Connect Real-Time WebSocket + HTTP Polling Backup (guarantees data flow)
    this.connectWebSocket();
    setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.fetchTelemetryHttp();
      }
    }, 200);

    // Start Decoupled Animation Loop
    this.startRenderLoop();

    // Background Polling (Incidents & Unseen Notes / Advisories)
    this.fetchIncidents();
    setInterval(() => this.fetchIncidents(), 10000);

    this.fetchNotesBackground();
    setInterval(() => this.fetchNotesBackground(), 4000);
  }

  async fetchTelemetryHttp() {
    try {
      const res = await fetch(`/api/telemetry?vehicle=${this.activeVehicleId}`);
      if (res.ok) {
        const packet = await res.json();
        this.latestPacket = packet;
        this.consumePacket(packet);
        const statusLed = document.getElementById("ws-status-led");
        const statusText = document.getElementById("ws-status-text");
        if (statusLed && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
          statusLed.className = "led-indicator led-green";
          if (statusText) statusText.innerText = "STREAM ONLINE (HTTP 10 Hz)";
        }
      }
    } catch (e) {}
  }

  renderInitialState() {
    try {
      const baselineMatrix = [];
      for (let r = 0; r < 24; r++) {
        const row = [];
        for (let c = 0; c < 32; c++) {
          row.push(22.0 + (r / 24) * 4.0);
        }
        baselineMatrix.push(row);
      }
      this.thermalRenderer?.update(baselineMatrix, 22.0, 26.0, { detected: false });
      this.radarRenderer?.update({ target_detected: false, distance_m: 999.0, targets: [] }, "CLEAR");
      this.arLaneRenderer?.update({ left_dist_m: 4.2, right_dist_m: 4.1, lane_offset_m: 0.0 }, 0.65, 8.5, "CLEAR", null);

      this.radarRenderer?.render();
      this.thermalRenderer?.render();
      this.arLaneRenderer?.render();
    } catch (e) {}
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

    // Operator Training & Demo Sandbox Mode Switchers
    document.getElementById("btn-enter-training")?.addEventListener("click", () => this.setAppMode("DEMO_TRAINING"));
    document.getElementById("btn-exit-training")?.addEventListener("click", () => this.setAppMode("HARDWARE"));
    document.getElementById("btn-banner-exit-demo")?.addEventListener("click", () => this.setAppMode("HARDWARE"));

    // Hardware Sensor Pairing Hub Modal Handlers
    document.getElementById("btn-open-hw-pairing")?.addEventListener("click", () => this.openHardwareModal());
    document.getElementById("btn-quick-pair")?.addEventListener("click", () => this.openHardwareModal());
    document.getElementById("btn-close-hw-pairing")?.addEventListener("click", () => this.closeHardwareModal());
    document.getElementById("btn-close-hw-pairing-bottom")?.addEventListener("click", () => this.closeHardwareModal());
    document.getElementById("btn-serial-connect")?.addEventListener("click", () => this.toggleWebSerial());
    document.getElementById("btn-send-test-packet")?.addEventListener("click", () => this.sendTestHardwarePacket());
    document.getElementById("btn-test-ingress-packet")?.addEventListener("click", () => this.sendTestHardwarePacket());
    document.getElementById("btn-copy-ingress-curl")?.addEventListener("click", () => this.copyIngressCurl());
    document.getElementById("btn-clear-terminal")?.addEventListener("click", () => this.clearTerminal());

    // Custom Physical Machine Name Setup
    document.getElementById("btn-save-machine-name")?.addEventListener("click", () => {
      const input = document.getElementById("input-custom-machine-name");
      const name = input?.value.trim();
      if (!name) {
        alert("Please enter a Machine Name or ID (e.g. HEMM-MINE-TRUCK-01)");
        return;
      }
      this.pairedVehicleName = name;
      this.activeVehicleId = name;
      this.updateCabUnitOptions();
      this.logHardwareTerminal(`Physical machine name set to '${name}'. Ready to receive sensor frames.`);
      alert(`✅ Machine '${name}' configured & paired! In-Cab HUD is now linked.`);
      this.closeHardwareModal();
    });

    // Hazard Injection Triggers (Operator Training Mode)
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

    // Unseen Note Toast Notification Handlers
    document.getElementById("btn-dismiss-toast")?.addEventListener("click", () => this.dismissNoteToast());
    document.getElementById("btn-toast-view")?.addEventListener("click", () => {
      this.dismissNoteToast();
      const modal = document.getElementById("notes-modal");
      if (modal) {
        modal.style.display = "flex";
        modal.classList.remove("hidden");
      }
      this.fetchNotes();
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    const hudContainer = document.getElementById("operator-hud-view");
    const dispatchContainer = document.getElementById("dispatch-twin-view");

    // Reset all role nav buttons
    document.querySelectorAll(".btn-role-nav").forEach(b => {
      b.classList.remove("bg-cyan-600/20", "text-white", "border-cyan-500/60", "shadow-md", "shadow-cyan-500/10");
      b.classList.add("border-slate-800/80", "bg-slate-900/40", "text-slate-300");
    });

    const activeBtn = document.getElementById(`btn-view-${viewName.toLowerCase()}`);
    if (activeBtn) {
      activeBtn.classList.remove("border-slate-800/80", "bg-slate-900/40", "text-slate-300");
      activeBtn.classList.add("bg-cyan-600/20", "text-white", "border-cyan-500/60", "shadow-md", "shadow-cyan-500/10");
    }

    if (viewName === "HUD") {
      hudContainer?.classList.remove("hidden");
      dispatchContainer?.classList.add("hidden");
      dispatchContainer?.classList.remove("grid-cols-1", "lg:grid-cols-2");
    } else if (viewName === "DISPATCH") {
      hudContainer?.classList.add("hidden");
      dispatchContainer?.classList.remove("hidden");
      setTimeout(() => {
        if (!this.dispatchMap || !this.dispatchMap.map) {
          this.dispatchMap = new DispatchMapRenderer("dispatch-map");
        } else {
          this.dispatchMap.map.invalidateSize();
        }
      }, 100);
    } else if (viewName === "DUAL") {
      hudContainer?.classList.remove("hidden");
      dispatchContainer?.classList.remove("hidden");
      setTimeout(() => {
        if (!this.dispatchMap || !this.dispatchMap.map) {
          this.dispatchMap = new DispatchMapRenderer("dispatch-map");
        } else {
          this.dispatchMap.map.invalidateSize();
        }
      }, 100);
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

  // Continuous Avionics Animation Loop
  startRenderLoop() {
    const frame = () => {
      if (this.hasNewPacket && this.latestPacket) {
        this.consumePacket(this.latestPacket);
        this.hasNewPacket = false;
      }

      // Continuous Canvas Drawing (Never Blank)
      if (this.currentView === "HUD" || this.currentView === "DUAL") {
        this.radarRenderer?.render();
        this.thermalRenderer?.render();
        this.arLaneRenderer?.render();
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
      const isHw = (this.appMode === "HARDWARE");
      const hasHwData = (this.packetsIngestedCount > 0);
      this.dispatchMap?.update(activePacket, packet.fleet_summary, activePacket.fog_density, isHw, hasHwData);
    }

    // 4. Update Collision Alert Banner
    this.updateCollisionBanner(activePacket);

    // 5. Throttled DOM Text & Gauges Update (80ms)
    const now = Date.now();
    if (now - this.lastDomUpdate > 80) {
      this.lastDomUpdate = now;
      this.updateInstrumentCluster(activePacket);
    }

    // 6. Fleet Table & Dispatch Cards Update
    this.updateDispatchCards(packet);
  }

  updateCabUnitOptions() {
    const selectVehicle = document.getElementById("select-active-vehicle");
    if (!selectVehicle) return;

    const isHardwareMode = (this.appMode === "HARDWARE");

    if (isHardwareMode) {
      if (this.pairedVehicleName) {
        selectVehicle.innerHTML = `
          <option value="${this.pairedVehicleName}" selected>🟢 PAIRED MACHINE: ${this.pairedVehicleName}</option>
        `;
      } else {
        selectVehicle.innerHTML = `
          <option value="UNPAIRED" selected>🔌 WAITING TO PAIR... (Add Hardware Device)</option>
        `;
      }
    } else {
      // Training / Demo Simulation Mode: Show full 5-vehicle fleet
      selectVehicle.innerHTML = `
        <option value="HEMM-DUMP-07" ${this.activeVehicleId === "HEMM-DUMP-07" ? "selected" : ""}>🚛 Truck #1: HEMM-DUMP-07 (CAT 777D)</option>
        <option value="HEMM-DUMP-02" ${this.activeVehicleId === "HEMM-DUMP-02" ? "selected" : ""}>🚛 Truck #2: HEMM-DUMP-02 (Komatsu HD785)</option>
        <option value="MINE-LV-03" ${this.activeVehicleId === "MINE-LV-03" ? "selected" : ""}>🚙 Patrol #3: MINE-LV-03 (Bolero Escort)</option>
        <option value="HEMM-SHOV-04" ${this.activeVehicleId === "HEMM-SHOV-04" ? "selected" : ""}>⛏️ Shovel #4: HEMM-SHOV-04 (P&H 1900AL)</option>
        <option value="HEMM-DOZ-01" ${this.activeVehicleId === "HEMM-DOZ-01" ? "selected" : ""}>🚜 Dozer #1: HEMM-DOZ-01 (CAT D11T)</option>
      `;
    }
  }

  updateCollisionBanner(packet) {
    const banner = document.getElementById("collision-alert-banner");
    const stateText = document.getElementById("collision-state-title");
    const subText = document.getElementById("collision-state-subtitle");

    if (!banner) return;

    const isHardwareStandby = (this.appMode === "HARDWARE" && this.packetsIngestedCount === 0);

    if (isHardwareStandby) {
      banner.setAttribute("data-state", "STANDBY");
      banner.classList.remove("state-advisory", "state-critical");
      banner.classList.add("state-clear");
      if (stateText) stateText.innerHTML = `<span class="glow-cyan">🔌 READY TO PAIR — SENSOR INGRESS STANDBY</span>`;
      if (subText) subText.innerText = "AWAITING TELEMETRY VIA WEB SERIAL OR /api/telemetry/ingress";
      
      fastSetText("stat-obstacle-distance", "-- m");
      fastSetText("stat-rel-speed", "-- km/h");
      fastSetText("stat-ttc", "-- s");
      fastSetText("stat-safe-braking", "READY");
      return;
    }

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
    const isHardwareStandby = (this.appMode === "HARDWARE" && this.packetsIngestedCount === 0);

    if (isHardwareStandby) {
      fastSetText("hud-speed", "0.0");
      fastSetText("hud-heading", "180°");
      fastSetText("hud-gear", "P");
      fastSetText("hud-rpm", "STANDBY");
      fastSetText("hud-brake-psi", "0 PSI");
      fastSetText("hud-pitch", "0.0°");
      fastSetText("hud-roll", "0.0°");
      fastSetText("hud-payload", "0.0 T");
      fastSetText("hud-zone", "Deposit 14 (Pairing Standby)");
      fastSetText("hud-gps", "18.7145 N, 81.2525 E (1220m)");
      fastSetText("hud-visibility", "STANDBY");
      fastSetText("hud-mode-tag", "HARDWARE_STANDBY");
      return;
    }

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
    const isHardwareMode = (this.appMode === "HARDWARE");
    const hasIngestedHardware = (this.packetsIngestedCount > 0);

    let fleetList = [];
    if (!isHardwareMode) {
      // Operator Training / Demo Mode: Show complete 5-unit NMDC mining fleet
      fleetList = packet.fleet_summary || [];
    } else if (hasIngestedHardware || this.pairedVehicleName) {
      // In Hardware Mode with paired unit: Show the custom physical machine
      const vName = this.pairedVehicleName || this.activeVehicleId;
      fleetList = [{
        vehicle_id: vName,
        vehicle_name: `${vName} (Live Hardware Unit)`,
        current_zone: packet.zone_name || "Deposit 14 Haul Ramp",
        speed_kmh: packet.speed_kmh || 0.0,
        payload_tons: packet.payload_tons || 95.0,
        status: "LIVE_STREAM",
        collision_state: packet.collision_state || "CLEAR"
      }];
    }

    const activeCount = fleetList.length;
    const criticalCount = fleetList.filter(f => f.collision_state === "CRITICAL").length;

    const elActiveFleet = document.getElementById("disp-active-fleet");
    if (elActiveFleet) {
      if (!isHardwareMode) {
        elActiveFleet.innerText = `${activeCount} Units (Demo Fleet)`;
        elActiveFleet.className = "text-2xl font-bold font-mono text-amber-400";
      } else if (hasIngestedHardware || this.pairedVehicleName) {
        elActiveFleet.innerText = `1 Unit (Paired: ${this.pairedVehicleName || this.activeVehicleId})`;
        elActiveFleet.className = "text-2xl font-bold font-mono text-emerald-400";
      } else {
        elActiveFleet.innerText = `0 Units (Waiting to Pair)`;
        elActiveFleet.className = "text-2xl font-bold font-mono text-cyan-400";
      }
    }

    const safetyIndex = (isHardwareMode && !hasIngestedHardware) ? 100 : Math.max(45, 100 - (criticalCount * 25) - (packet.active_hazard !== "NONE" ? 15 : 0));
    const elSafetyIndex = document.getElementById("disp-safety-index");
    if (elSafetyIndex) {
      elSafetyIndex.innerText = `${safetyIndex}%`;
      elSafetyIndex.className = safetyIndex > 80 ? "text-emerald-400 font-bold" : (safetyIndex > 60 ? "text-amber-400 font-bold" : "text-rose-500 font-bold");
    }

    fastSetText("disp-incident-count", String(packet.incident_count || "0"));
    fastSetText("disp-avg-cycle", (isHardwareMode && !hasIngestedHardware) ? "-- min" : "28.4 min");

    // Update Fleet Table
    const tbody = document.getElementById("fleet-table-body");
    if (tbody) {
      if (fleetList.length > 0) {
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
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-8">
              <div class="flex flex-col items-center justify-center gap-2">
                <span class="text-3xl">🔌</span>
                <span class="text-xs font-mono font-bold text-cyan-400">READY TO PAIR — NO PHYSICAL FLEET ASSETS CONNECTED</span>
                <span class="text-[11px] font-mono text-slate-400 max-w-md">Connect real hardware units via Web Serial or REST Ingress API (/api/telemetry/ingress) to stream live telemetry.</span>
                <div class="flex gap-2 mt-2">
                  <button onclick="window.app.openHardwareModal()" class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold rounded shadow transition-all">
                    🔌 Open Hardware Pairing Hub
                  </button>
                  <button onclick="window.app.setAppMode('DEMO_TRAINING')" class="px-3 py-1.5 bg-amber-950 hover:bg-amber-900 border border-amber-500 text-amber-300 text-xs font-mono font-bold rounded shadow transition-all">
                    🚀 View Simulated Fleet (Demo)
                  </button>
                </div>
              </div>
            </td>
          </tr>
        `;
      }
    }
  }

  async injectHazard(hazardType, distanceMeters) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: "inject_hazard", hazard_type: hazardType, distance_m: distanceMeters }));
      }
      await fetch("/api/hazard/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hazard_type: hazardType, distance_m: distanceMeters, duration_s: 0.0 }),
      });
      await this.fetchTelemetryHttp();
      this.fetchIncidents();
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

  setAppMode(mode) {
    this.appMode = mode; // "HARDWARE" or "DEMO_TRAINING"

    const bannerTraining = document.getElementById("training-mode-banner");
    const btnEnter = document.getElementById("btn-enter-training");
    const btnExit = document.getElementById("btn-exit-training");
    const deckHw = document.getElementById("deck-hardware-status");
    const deckDemo = document.getElementById("deck-demo-harness");

    if (mode === "DEMO_TRAINING") {
      bannerTraining?.classList.remove("hidden");
      btnEnter?.classList.add("hidden");
      btnExit?.classList.remove("hidden");
      deckHw?.classList.add("hidden");
      deckDemo?.classList.remove("hidden");

      fetch("/api/mode/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "SIMULATION" })
      }).catch(() => {});
    } else {
      // HARDWARE MODE (Default Production View)
      bannerTraining?.classList.add("hidden");
      btnEnter?.classList.remove("hidden");
      btnExit?.classList.add("hidden");
      deckHw?.classList.remove("hidden");
      deckDemo?.classList.add("hidden");

      // Reset any active simulated hazard
      this.injectHazard("NONE", 999.0);

      fetch("/api/mode/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "HARDWARE" })
      }).catch(() => {});
    }

    this.updateCabUnitOptions();
  }

  openHardwareModal() {
    const modal = document.getElementById("hw-pairing-modal");
    if (modal) {
      modal.style.display = "flex";
      modal.classList.remove("hidden");
    }
    const fullIngressUrl = `${window.location.origin}/api/telemetry/ingress`;
    const urlDisplay = document.getElementById("ingress-url-display");
    if (urlDisplay) urlDisplay.innerText = fullIngressUrl;
  }

  closeHardwareModal() {
    const modal = document.getElementById("hw-pairing-modal");
    if (modal) {
      modal.style.display = "none";
      modal.classList.add("hidden");
    }
  }

  logHardwareTerminal(message, isData = false) {
    const logBox = document.getElementById("hw-terminal-log");
    if (!logBox) return;
    const timeStr = new Date().toLocaleTimeString();
    const entry = document.createElement("div");
    entry.className = isData ? "text-cyan-300 font-bold" : "text-emerald-400";
    entry.textContent = `[${timeStr}] ${message}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
  }

  clearTerminal() {
    const logBox = document.getElementById("hw-terminal-log");
    if (logBox) logBox.innerHTML = `<div class="text-slate-500">[STANDBY] Terminal cleared. Ready for sensor packets...</div>`;
  }

  copyIngressCurl() {
    const fullIngressUrl = `${window.location.origin}/api/telemetry/ingress`;
    const script = `import requests, time

payload = {
  "vehicle_id": "${this.activeVehicleId}",
  "speed_kmh": 16.5,
  "heading_deg": 182.0,
  "gps": {"lat": 18.7145, "lng": 81.2525, "altitude_m": 1220.0},
  "radar": {
    "target_detected": True,
    "distance_m": 6.8,
    "relative_speed_kmh": -16.5,
    "targets": [{
      "target_id": "RAD-HAZARD-01",
      "distance_m": 6.8,
      "relative_speed_kmh": -16.5,
      "azimuth_deg": 0.0,
      "target_type": "PERSON"
    }]
  },
  "collision_state": "CRITICAL",
  "berm_left_m": 4.1,
  "berm_right_m": 4.0
}

response = requests.post("${fullIngressUrl}", json=payload)
print("Ingress status:", response.status_code, response.json())`;

    navigator.clipboard.writeText(script).then(() => {
      alert("✅ Python & cURL Ingress snippet copied to clipboard!");
    }).catch(() => {
      prompt("Copy Python hardware ingress script:", script);
    });
  }

  async sendTestHardwarePacket() {
    const payload = {
      vehicle_id: this.activeVehicleId,
      speed_kmh: 15.2,
      heading_deg: 180.0,
      gps: { lat: 18.7148, lng: 81.2530, altitude_m: 1220.0 },
      radar: {
        target_detected: true,
        distance_m: 7.2,
        relative_speed_kmh: -15.2,
        targets: [{
          target_id: "RAD-TEST-01",
          distance_m: 7.2,
          relative_speed_kmh: -15.2,
          azimuth_deg: 0.0,
          target_type: "PERSON",
          ttc_seconds: 1.7
        }]
      },
      collision_state: "CRITICAL",
      berm_left_m: 3.9,
      berm_right_m: 4.0
    };

    try {
      const res = await fetch("/api/telemetry/ingress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        this.packetsIngestedCount++;
        this.logHardwareTerminal(`INGRESS POST [200 OK] -> Frame #${this.packetsIngestedCount}: RADAR 7.2m | CRITICAL`, true);
        this.updateCabUnitOptions();
        
        const hwLabel = document.getElementById("hw-status-label");
        const hwPort = document.getElementById("hw-port-badge");
        if (hwLabel) {
          hwLabel.innerText = "HARDWARE STREAMING ACTIVE (FRAME INGESTED)";
          hwLabel.className = "px-2.5 py-1 rounded bg-emerald-950 border border-emerald-500 text-emerald-300 text-xs font-mono font-bold";
        }
        if (hwPort) hwPort.innerText = "REST INGRESS";

        await this.fetchTelemetryHttp();
      }
    } catch (e) {
      this.logHardwareTerminal(`INGRESS ERROR: ${e.message}`);
    }
  }

  async toggleWebSerial() {
    if (!("serial" in navigator)) {
      alert("⚠️ Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera on Desktop, or use Method 2 (Network REST Ingress).");
      return;
    }

    const badge = document.getElementById("serial-status-badge");
    const btn = document.getElementById("btn-serial-connect");

    if (this.isSerialConnected && this.serialPort) {
      try {
        if (this.serialReader) {
          await this.serialReader.cancel();
        }
        await this.serialPort.close();
        this.isSerialConnected = false;
        if (badge) {
          badge.innerText = "DISCONNECTED";
          badge.className = "text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400";
        }
        if (btn) btn.innerText = "🔌 Connect USB Serial Device";
        this.logHardwareTerminal("Serial port disconnected cleanly.");
      } catch (e) {
        console.error(e);
      }
      return;
    }

    try {
      const baudSelect = document.getElementById("serial-baud-select");
      const baudRate = parseInt(baudSelect?.value || "115200");
      this.serialPort = await navigator.serial.requestPort();
      await this.serialPort.open({ baudRate });
      this.isSerialConnected = true;

      if (badge) {
        badge.innerText = `CONNECTED (${baudRate} bps)`;
        badge.className = "text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40";
      }
      if (btn) btn.innerText = "🔌 Disconnect Serial Port";

      const hwPort = document.getElementById("hw-port-badge");
      if (hwPort) hwPort.innerText = `USB SERIAL (${baudRate})`;

      this.logHardwareTerminal(`Web Serial port opened at ${baudRate} baud. Listening for JSON packets...`);
      this.readSerialLoop();
    } catch (e) {
      this.logHardwareTerminal(`Serial Connection Cancelled: ${e.message}`);
    }
  }

  async readSerialLoop() {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = this.serialPort.readable.pipeTo(textDecoder.writable);
    this.serialReader = textDecoder.readable.getReader();

    let buffer = "";
    try {
      while (true) {
        const { value, done } = await this.serialReader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
              try {
                const packet = JSON.parse(trimmed);
                this.packetsIngestedCount++;
                this.logHardwareTerminal(`RAW SERIAL JSON: Dist=${packet.radar?.distance_m || '--'}m State=${packet.collision_state || 'OK'}`, true);
                
                this.consumePacket(packet);
                fetch("/api/telemetry/ingress", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(packet)
                }).catch(() => {});
              } catch (parseErr) {}
            }
          }
        }
      }
    } catch (err) {
      this.logHardwareTerminal(`Serial Read Error: ${err.message}`);
    } finally {
      this.serialReader.releaseLock();
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

  async fetchNotesBackground() {
    try {
      const res = await fetch("/api/notes");
      if (res.ok) {
        const notes = await res.json();
        const unreadNotes = notes.filter(n => !this.seenNoteIds.has(n.id));
        const badge = document.getElementById("notes-unread-badge");

        if (unreadNotes.length > 0) {
          if (badge) {
            badge.innerText = String(unreadNotes.length);
            badge.classList.remove("hidden");
          }

          // Show Toast popup for the latest unseen note if modal is closed
          const modal = document.getElementById("notes-modal");
          const isModalOpen = (modal && modal.style.display === "flex");
          if (!isModalOpen && !this.toastDismissTimer) {
            const latest = unreadNotes[0];
            this.showNoteToast(latest);
          }
        } else {
          if (badge) badge.classList.add("hidden");
        }
      }
    } catch (e) {}
  }

  showNoteToast(note) {
    const toast = document.getElementById("note-toast-notification");
    const authorEl = document.getElementById("note-toast-author");
    const contentEl = document.getElementById("note-toast-content");

    if (!toast || !note) return;

    if (authorEl) authorEl.innerText = `${note.author} (${note.vehicle_id})`;
    if (contentEl) contentEl.innerText = note.content;

    toast.classList.remove("hidden");
    toast.classList.add("animate-pulse");

    if (this.toastDismissTimer) clearTimeout(this.toastDismissTimer);
    this.toastDismissTimer = setTimeout(() => {
      this.dismissNoteToast();
    }, 8000);
  }

  dismissNoteToast() {
    const toast = document.getElementById("note-toast-notification");
    if (toast) {
      toast.classList.add("hidden");
      toast.classList.remove("animate-pulse");
    }
    if (this.toastDismissTimer) {
      clearTimeout(this.toastDismissTimer);
      this.toastDismissTimer = null;
    }
  }

  async fetchNotes() {
    try {
      const res = await fetch("/api/notes");
      if (res.ok) {
        const notes = await res.json();
        // Mark all notes as seen
        notes.forEach(n => this.seenNoteIds.add(n.id));
        const badge = document.getElementById("notes-unread-badge");
        if (badge) badge.classList.add("hidden");
        this.dismissNoteToast();
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
