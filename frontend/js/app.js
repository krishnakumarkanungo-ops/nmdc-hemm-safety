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
    this.appMode = "DEMO_TRAINING"; // Default to DEMO_TRAINING for full simulated telemetry demonstration on load
    this.latestPacket = null;
    this.hasNewPacket = false;
    this.activeVehicleId = "HEMM-DUMP-07";
    this.pairedVehicleName = null; // Custom hardware machine name added by user

    // Auto-Remember Machine Preference State (Persistent Kiosk Memory)
    const savedRemember = localStorage.getItem("nmdc_remember_vehicle");
    this.rememberVehicle = (savedRemember === null || savedRemember === "true");

    // Restore saved vehicle if memory is enabled
    if (this.rememberVehicle) {
      const savedVehicleId = localStorage.getItem("nmdc_saved_vehicle_id");
      const savedVehicleName = localStorage.getItem("nmdc_saved_vehicle_name");
      if (savedVehicleId) this.activeVehicleId = savedVehicleId;
      if (savedVehicleName) this.pairedVehicleName = savedVehicleName;
    }

    // Web Serial & Hardware Ingress State
    this.serialPort = null;
    this.serialReader = null;
    this.isSerialConnected = false;
    this.packetsIngestedCount = 0;

    // Shift Notes Unseen Tracking & Toast State
    this.seenNoteIds = new Set(["NOTE-001", "NOTE-002"]);
    this.toastDismissTimer = null;

    // Component Renderers
    this.cameraRenderer = null;
    this.tofRenderer = null;
    this.inclinometerRenderer = null;
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
    // Parse URL parameter ?vehicle=HEMM-DUMP-07 (takes precedence if provided)
    const urlParams = new URLSearchParams(window.location.search);
    const vehicleParam = urlParams.get("vehicle");
    if (vehicleParam) {
      this.activeVehicleId = vehicleParam.toUpperCase();
    }

    // Sync Toggle UI State
    const toggleRemember = document.getElementById("toggle-remember-vehicle");
    const toggleSubtext = document.getElementById("toggle-remember-subtext");
    if (toggleRemember) {
      toggleRemember.checked = this.rememberVehicle;
      if (toggleSubtext) {
        toggleSubtext.innerText = this.rememberVehicle ? "AUTO-LOCK ON RECONNECT" : "DON'T REMEMBER (FRESH START)";
        toggleSubtext.className = this.rememberVehicle ? "text-[9px] font-mono text-emerald-400 leading-tight" : "text-[9px] font-mono text-slate-400 leading-tight";
      }
    }

    const selectVehicle = document.getElementById("select-active-vehicle");
    if (selectVehicle) {
      selectVehicle.addEventListener("change", (e) => {
        this.activeVehicleId = e.target.value;
        if (this.rememberVehicle) {
          localStorage.setItem("nmdc_saved_vehicle_id", this.activeVehicleId);
        }
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("vehicle", this.activeVehicleId);
        window.history.replaceState({}, "", newUrl);
        if (this.dispatchMap) {
          this.dispatchMap.selectedVehicle = this.activeVehicleId;
        }
      });
    }

    this.updateCabUnitOptions();

    // Initialize Sensor Suite Renderers Safely
    try { this.cameraRenderer = new CameraVisionRenderer("camera-canvas"); } catch (e) { console.error("Camera init error:", e); }
    try { this.tofRenderer = new LaserToFRenderer("tof-canvas"); } catch (e) { console.error("ToF init error:", e); }
    try { this.inclinometerRenderer = new InclinometerGaugeRenderer("inclinometer-canvas"); } catch (e) { console.error("IMU init error:", e); }
    try { this.radarRenderer = new RadarScopeRenderer("radar-canvas"); } catch (e) {}
    try { this.thermalRenderer = new ThermalVisionRenderer("thermal-canvas"); } catch (e) {}
    try { this.arLaneRenderer = new ARLaneHUDRenderer("ar-lane-canvas"); } catch (e) {}
    try { this.speedometerRenderer = new GlacierSpeedometerRenderer("speedometer-gauge-canvas", "speedometer-wave-canvas"); } catch (e) {}
    try {
      this.dispatchMap = new DispatchMapRenderer("dispatch-map");
      if (this.dispatchMap) this.dispatchMap.selectedVehicle = this.activeVehicleId;
    } catch (e) { console.error("Map init error:", e); }

    // Draw Instant Baseline Visuals (Never Blank on load)
    this.renderInitialState();

    // Bind UI Event Listeners
    this.bindEvents();

    // Set Default UI Mode (Demo Simulator active on start)
    this.setAppMode(this.appMode);

    // Instant HTTP fetch on start (0ms load)
    this.fetchTelemetryHttp();

    // Connect Real-Time WebSocket + HTTP Polling Backup (guarantees data flow)
    this.connectWebSocket();
    setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.fetchTelemetryHttp();
      }
    }, 1000);

    // Start Decoupled Animation Loop
    this.startRenderLoop();

    // Background Polling (Incidents & Unseen Notes / Advisories)
    this.fetchIncidents();
    setInterval(() => this.fetchIncidents(), 10000);

    this.fetchNotesBackground();
    setInterval(() => this.fetchNotesBackground(), 12000);
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
      const sample = { fog_density: 0.6, collision_state: "CLEAR", active_hazard: "NONE", radar: { distance_m: 18.5, targets: [] }, tof_laser: { left_m: 4.2, right_m: 4.1 }, pitch_deg: -2.8, roll_deg: 0.5 };
      this.cameraRenderer?.render(sample);
      this.tofRenderer?.render(sample);
      this.inclinometerRenderer?.render(sample);

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

    // View Switcher Buttons (Sidebar & Dock)
    document.querySelectorAll(".btn-role-nav").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view") || (btn.id.includes("hud") ? "HUD" : (btn.id.includes("dispatch") ? "DISPATCH" : "DUAL"));
        this.switchView(view);
      });
    });
    document.getElementById("btn-view-hud")?.addEventListener("click", () => this.switchView("HUD"));
    document.getElementById("btn-view-dispatch")?.addEventListener("click", () => this.switchView("DISPATCH"));
    document.getElementById("btn-view-dual")?.addEventListener("click", () => this.switchView("DUAL"));

    // ESP32 Emergency Stop Test Trigger Button
    document.getElementById("btn-trigger-v2v-estop")?.addEventListener("click", () => this.triggerV2VEStop());

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

    // Segmented Mode Switcher (Demo Simulator vs Hardware Mode)
    document.getElementById("btn-mode-demo")?.addEventListener("click", () => this.setAppMode("DEMO_TRAINING"));
    document.getElementById("btn-mode-hardware")?.addEventListener("click", () => this.setAppMode("HARDWARE"));
    document.getElementById("btn-enter-training")?.addEventListener("click", () => this.setAppMode("DEMO_TRAINING"));
    document.getElementById("btn-exit-training")?.addEventListener("click", () => this.setAppMode("HARDWARE"));
    document.getElementById("btn-banner-exit-demo")?.addEventListener("click", () => this.setAppMode("HARDWARE"));
    document.getElementById("btn-quick-pulse-test")?.addEventListener("click", () => this.sendTestHardwarePacket());
    document.getElementById("btn-header-hw-modal")?.addEventListener("click", () => this.openHardwareModal());

    // Optical Camera AI vs Thermal LWIR Viewport Toggles
    document.getElementById("btn-toggle-cam")?.addEventListener("click", () => this.setCameraView("OPTICAL"));
    document.getElementById("btn-toggle-thermal")?.addEventListener("click", () => this.setCameraView("THERMAL"));

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
      if (this.rememberVehicle) {
        localStorage.setItem("nmdc_saved_vehicle_id", name);
        localStorage.setItem("nmdc_saved_vehicle_name", name);
      }
      this.updateCabUnitOptions();
      this.logHardwareTerminal(`Physical machine name set to '${name}'. Ready to receive sensor frames.`);
      alert(`✅ Machine '${name}' configured & paired! In-Cab HUD is now linked.`);
      this.closeHardwareModal();
    });

    // Auto-Remember Machine Toggle Switch Listener
    const toggleRemember = document.getElementById("toggle-remember-vehicle");
    const toggleSubtext = document.getElementById("toggle-remember-subtext");
    toggleRemember?.addEventListener("change", (e) => {
      this.rememberVehicle = e.target.checked;
      localStorage.setItem("nmdc_remember_vehicle", String(this.rememberVehicle));
      if (this.rememberVehicle) {
        if (this.activeVehicleId) localStorage.setItem("nmdc_saved_vehicle_id", this.activeVehicleId);
        if (this.pairedVehicleName) localStorage.setItem("nmdc_saved_vehicle_name", this.pairedVehicleName);
        if (toggleSubtext) {
          toggleSubtext.innerText = "AUTO-LOCK ON RECONNECT";
          toggleSubtext.className = "text-[9px] font-mono text-emerald-400 leading-tight";
        }
      } else {
        localStorage.removeItem("nmdc_saved_vehicle_id");
        localStorage.removeItem("nmdc_saved_vehicle_name");
        if (toggleSubtext) {
          toggleSubtext.innerText = "DON'T REMEMBER (FRESH START)";
          toggleSubtext.className = "text-[9px] font-mono text-slate-400 leading-tight";
        }
      }
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
    document.getElementById("btn-manual-brake")?.addEventListener("click", () => this.manualControl(0.0, true));
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

    // Reset and highlight role nav buttons with Glacier Cyan styling
    document.querySelectorAll(".btn-role-nav").forEach(b => {
      const v = b.getAttribute("data-view") || (b.id.includes("hud") ? "HUD" : (b.id.includes("dispatch") ? "DISPATCH" : "DUAL"));
      if (v === viewName) {
        b.className = "btn-role-nav w-full text-left p-2.5 rounded-lg border transition-all flex items-start gap-2.5 bg-cyan-600/25 text-white border-cyan-400 shadow-lg shadow-cyan-500/20 cursor-pointer";
      } else {
        b.className = "btn-role-nav w-full text-left p-2.5 rounded-lg border transition-all flex items-start gap-2.5 border-cyan-950 hover:border-cyan-500/50 bg-[#051020]/60 hover:bg-[#07162c] text-slate-300 shadow-sm cursor-pointer";
      }
    });

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

    // Trigger canvas resize across all perception renderers
    setTimeout(() => {
      this.cameraRenderer?.resize();
      this.tofRenderer?.resize();
      this.inclinometerRenderer?.resize();
      this.radarRenderer?.resize();
      this.thermalRenderer?.resize();
      this.arLaneRenderer?.resize();
      this.speedometerRenderer?.resize();
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
          const packet = JSON.parse(event.data);
          this.latestPacket = packet;
          this.hasNewPacket = true;
          this.consumePacket(packet);
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

  // Optimized Avionics Animation Loop (GPU Smooth & 0 CPU Lag)
  startRenderLoop() {
    let lastRenderTime = 0;
    const frame = (timestamp) => {
      const activeP = (this.latestPacket && this.latestPacket.all_vehicles_telemetry && this.latestPacket.all_vehicles_telemetry[this.activeVehicleId]) 
        ? this.latestPacket.all_vehicles_telemetry[this.activeVehicleId] 
        : this.latestPacket;

      if (this.hasNewPacket && this.latestPacket) {
        this.consumePacket(this.latestPacket);
        this.hasNewPacket = false;

        if (this.currentView === "HUD" || this.currentView === "DUAL") {
          try { this.cameraRenderer?.render(activeP); } catch (e) { console.error("Cam render err:", e); }
          try { this.tofRenderer?.render(activeP); } catch (e) { console.error("ToF render err:", e); }
          try { this.inclinometerRenderer?.render(activeP); } catch (e) { console.error("IMU render err:", e); }
          try { this.radarRenderer?.render(); } catch (e) {}
          try { this.thermalRenderer?.render(); } catch (e) {}
          try { this.arLaneRenderer?.render(); } catch (e) {}
          try { this.speedometerRenderer?.render(); } catch (e) {}
        }
      } else if (timestamp - lastRenderTime > 100) {
        // Idle heartbeat refresh (10 FPS)
        lastRenderTime = timestamp;
        if (this.currentView === "HUD" || this.currentView === "DUAL") {
          try { this.cameraRenderer?.render(activeP); } catch (e) { console.error("Cam render err:", e); }
          try { this.tofRenderer?.render(activeP); } catch (e) { console.error("ToF render err:", e); }
          try { this.inclinometerRenderer?.render(activeP); } catch (e) { console.error("IMU render err:", e); }
          try { this.radarRenderer?.render(); } catch (e) {}
          try { this.thermalRenderer?.render(); } catch (e) {}
          try { this.arLaneRenderer?.render(); } catch (e) {}
          try { this.speedometerRenderer?.render(); } catch (e) {}
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

      this.speedometerRenderer?.update(activePacket);
    }

    // 3. Dispatch Map update (Google Maps Satellite Live Fleet & Demo Vehicle)
    const isHw = (this.appMode === "HARDWARE");
    const hasHwData = (this.packetsIngestedCount > 0);
    this.dispatchMap?.update(activePacket, packet.fleet_summary, activePacket.fog_density, isHw, hasHwData);

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
      // Hardware Mode: User requested ONLY 1 single active hardware device (no 2 vehicle names)
      if (this.pairedVehicleName) {
        selectVehicle.innerHTML = `
          <option value="${this.pairedVehicleName}" selected>📡 PAIRED MACHINE: ${this.pairedVehicleName}</option>
        `;
      } else {
        selectVehicle.innerHTML = `
          <option value="HEMM-DUMP-07" selected>📡 ACTIVE HEMM HARDWARE UNIT (Pi 4B + ESP32 Node)</option>
        `;
      }
    } else {
      // Demo Mode: Single unified Demo Vehicle as primary, plus fleet units
      selectVehicle.innerHTML = `
        <option value="HEMM-DUMP-07" ${this.activeVehicleId === "HEMM-DUMP-07" ? "selected" : ""}>🚛 DEMO VEHICLE: CAT 777D (Active Demo Truck)</option>
        <option value="HEMM-DUMP-02" ${this.activeVehicleId === "HEMM-DUMP-02" ? "selected" : ""}>🚛 FLEET UNIT: Komatsu HD785</option>
        <option value="MINE-LV-03" ${this.activeVehicleId === "MINE-LV-03" ? "selected" : ""}>🚙 PATROL ESCORT: Bolero LV-03</option>
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
    const isHardwareStandby = (this.appMode === "HARDWARE") && 
      (this.packetsIngestedCount === 0 || (packet && packet.mode === "HARDWARE_STANDBY"));

    if (isHardwareStandby) {
      fastSetText("hud-speed", "0.0");
      fastSetText("hud-heading", "180°");
      fastSetText("hud-gear", "P");
      fastSetText("hud-rpm", "0");
      fastSetText("hud-brake-psi", "0 PSI");
      fastSetText("hud-pitch", "0.0°");
      fastSetText("hud-roll", "0.0°");
      fastSetText("hud-payload", "-- T");
      fastSetText("hud-zone", "Deposit 14 (Pairing Standby)");
      fastSetText("hud-gps", "18.7145 N, 81.2525 E (1220m)");
      fastSetText("hud-visibility", "-- m");
      fastSetText("hud-mode-tag", "HARDWARE_STANDBY");
      fastSetText("hud-tof-left", "-- m");
      fastSetText("hud-tof-right", "-- m");
      const tofBadge = document.getElementById("hud-tof-badge");
      if (tofBadge) {
        tofBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40";
        tofBadge.innerText = "STANDBY";
      }
      fastSetText("hud-berm-offset-status", "STANDBY (0.0m)");
      fastSetText("hud-radar-dist", "-- m");
      fastSetText("hud-radar-relspeed", "-- km/h");
      fastSetText("hud-radar-azimuth", "0.0°");
      fastSetText("hud-bmp-pressure", "985.0 hPa");
      fastSetText("hud-bmp-alt", "1220 m");
      fastSetText("hud-bmp-temp", "24.0 °C");
      fastSetText("hud-imu-pitch", "0.0°");
      fastSetText("hud-imu-roll", "0.0°");
      fastSetText("hud-imu-grade", "SLOPE: 0.0%");
      fastSetText("hud-imu-grade-val", "0.0% (LEVEL)");
      fastSetText("hud-imu-gforce", "1.00 G");
      const imuBadge = document.getElementById("hud-imu-status-badge");
      if (imuBadge) {
        imuBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40";
        imuBadge.innerText = "STANDBY";
      }
      fastSetText("hud-encoder-rpm", "0");
      fastSetText("hud-encoder-pulses", "0 p/s");
      fastSetText("hud-encoder-rpm-val", "0 RPM");
      fastSetText("hud-encoder-pulses-val", "0 p/s");
      fastSetText("hud-encoder-speed-val", "0.0 km/h");
      fastSetText("hud-encoder-trip", "0 m");
      fastSetText("hud-gps-sats", "STANDBY");
      fastSetText("hud-gps-hdop", "-- m");
      fastSetText("hud-gps-coords", "18.7145, 81.2525");
      fastSetText("hud-v2v-peer", "STANDBY");
      fastSetText("hud-v2v-dist", "-- m");
      fastSetText("hud-v2v-rel-speed", "-- km/h");
      fastSetText("hud-v2v-rssi", "-- dBm");
      const v2vTag = document.getElementById("hud-v2v-alert-tag");
      if (v2vTag) {
        v2vTag.className = "text-cyan-400 font-bold";
        v2vTag.innerText = "STANDBY";
      }
      fastSetText("camera-detections-badge", "0 TARGETS");
      const camHazardEl = document.getElementById("camera-hazard-type");
      if (camHazardEl) {
        camHazardEl.className = "text-cyan-400 font-bold";
        camHazardEl.innerText = "STANDBY (READY TO PAIR)";
      }

      // Chassis & Payload
      fastSetText("hud-payload-tons", "-- T");
      const payloadBar = document.getElementById("hud-payload-bar");
      if (payloadBar) payloadBar.style.width = "0%";
      
      // Dual Laser ToF Graphic Card
      fastSetText("tof-l-dist", "-- m");
      fastSetText("tof-r-dist", "-- m");
      fastSetText("tof-l-foot", "--");
      fastSetText("tof-r-foot", "--");
      const tofGraphicBadge = document.getElementById("tof-status-badge");
      if (tofGraphicBadge) {
        tofGraphicBadge.className = "px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[9px] font-bold";
        tofGraphicBadge.innerText = "STANDBY";
      }

      // AR Canvas overlays
      fastSetText("ar-vis-dist", "-- m");
      fastSetText("road-berm-left", "-- m");
      fastSetText("road-berm-right", "-- m");

      // Inclinometer / Slope Gauge card
      fastSetText("imu-grade-val", "0.0% (LEVEL)");
      fastSetText("imu-pitch-val", "0.0°");
      fastSetText("imu-roll-val", "0.0°");

      // Environmental Info
      fastSetText("env-temp", "STANDBY");
      fastSetText("env-dust", "--");
      fastSetText("env-visibility", "-- m");

      // Systems Status
      const setSys = (id, val, cls) => {
        const el = document.getElementById(id);
        if (el) { el.innerText = val; el.className = cls; }
      };
      setSys("sys-engine", "STANDBY", "text-cyan-400 font-bold");
      setSys("sys-hydraulics", "STANDBY", "text-cyan-400 font-bold");
      setSys("sys-tires", "STANDBY", "text-cyan-400 font-bold");
      setSys("sys-drive", "STANDBY", "text-cyan-400 font-bold");

      // Tire Pressures
      fastSetText("tire-fl", "-- psi");
      fastSetText("tire-fr", "-- psi");
      fastSetText("tire-rl", "-- psi");
      fastSetText("tire-rr", "-- psi");

      // Radar Bearing & Active Tag
      fastSetText("radar-active-status", "STANDBY");
      fastSetText("radar-bearing-val", "--°");

      // AI Perception Status
      fastSetText("ai-perception-status", "STANDBY (OFFLINE)");
      fastSetText("ai-haul-road-status", "AWAITING SENSORS");
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

    // 1. Pi Camera Module 3 Wide AI Status
    const camHazardEl = document.getElementById("camera-hazard-type");
    if (camHazardEl) {
      if (packet.collision_state === "CRITICAL") {
        camHazardEl.className = "text-rose-400 font-bold animate-pulse";
        camHazardEl.innerText = packet.active_hazard === "MINER_IN_FOG" ? "👷 MINE WORKER IN PATH" : "🚨 IMMEDIATE COLLISION HAZARD";
      } else if (packet.collision_state === "ADVISORY") {
        camHazardEl.className = "text-amber-300 font-bold";
        camHazardEl.innerText = "⚠️ PROXIMITY ADVISORY (SLOW DOWN)";
      } else {
        camHazardEl.className = "text-emerald-400 font-bold";
        camHazardEl.innerText = "HAUL ROAD CLEAR";
      }
    }
    const detCount = (packet.radar && packet.radar.targets ? packet.radar.targets.length : 0) + (packet.radar && packet.radar.distance_m < 80 ? 1 : 0);
    fastSetText("camera-detections-badge", `${Math.max(1, detCount)} TARGET${detCount > 1 ? "S" : ""} DETECTED`);

    // 2. Dual VL53L1X Laser ToF Sensors
    if (packet.tof_laser) {
      fastSetText("hud-tof-left", packet.tof_laser.left_m.toFixed(2));
      fastSetText("hud-tof-right", packet.tof_laser.right_m.toFixed(2));
      const tofBadge = document.getElementById("hud-tof-badge");
      if (tofBadge) {
        if (packet.tof_laser.berm_warning) {
          tofBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-500 font-bold animate-pulse";
          tofBadge.innerText = `⚠️ BERM DRIFT (${packet.tof_laser.warning_side || "ALERT"})`;
        } else {
          tofBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40";
          tofBadge.innerText = "BERM CLEAR";
        }
      }
      const offset = packet.berm_proximity ? packet.berm_proximity.lane_offset_m : 0.0;
      fastSetText("hud-berm-offset-status", offset !== 0.0 ? `DRIFT ${offset > 0 ? "+" : ""}${offset.toFixed(1)}m` : "CENTERED (0.0m)");

      // Graphic card updates
      fastSetText("tof-l-dist", `${packet.tof_laser.left_m.toFixed(2)}m`);
      fastSetText("tof-r-dist", `${packet.tof_laser.right_m.toFixed(2)}m`);
      fastSetText("tof-l-foot", packet.tof_laser.left_m.toFixed(2));
      fastSetText("tof-r-foot", packet.tof_laser.right_m.toFixed(2));
      const tofGraphicBadge = document.getElementById("tof-status-badge");
      if (tofGraphicBadge) {
        if (packet.tof_laser.berm_warning) {
          tofGraphicBadge.className = "px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-500 text-[9px] font-bold animate-pulse";
          tofGraphicBadge.innerText = `⚠️ BERM DRIFT (${packet.tof_laser.warning_side || "ALERT"})`;
        } else {
          tofGraphicBadge.className = "px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold";
          tofGraphicBadge.innerText = "BERM CLEAR";
        }
      }
      fastSetText("road-berm-left", `${packet.tof_laser.left_m.toFixed(1)}m`);
      fastSetText("road-berm-right", `${packet.tof_laser.right_m.toFixed(1)}m`);
    }

    // 3. 77 GHz mmWave Radar Telemetry
    if (packet.radar) {
      fastSetText("hud-radar-dist", packet.radar.distance_m < 900 ? `${packet.radar.distance_m.toFixed(1)} m` : "CLEAR (>50m)");
      fastSetText("hud-radar-relspeed", `${packet.radar.relative_speed_kmh > 0 ? "+" : ""}${packet.radar.relative_speed_kmh.toFixed(1)} km/h`);
      fastSetText("hud-radar-azimuth", `${packet.radar.azimuth_deg > 0 ? "+" : ""}${packet.radar.azimuth_deg.toFixed(1)}°`);
    }

    // 4. BMP280 Atmospheric Sensor
    if (packet.atmosphere) {
      fastSetText("hud-bmp-pressure", `${packet.atmosphere.pressure_hpa.toFixed(1)} hPa`);
      fastSetText("hud-bmp-alt", `${Math.round(packet.atmosphere.altitude_m)} m`);
      fastSetText("hud-bmp-temp", `${packet.atmosphere.temp_celsius.toFixed(1)} °C`);
    } else {
      fastSetText("hud-bmp-pressure", "1013.2 hPa");
      fastSetText("hud-bmp-alt", `${Math.round(packet.gps ? packet.gps.altitude_m : 1220)} m`);
      fastSetText("hud-bmp-temp", "28.4 °C");
    }

    // 5. MPU6050 6-Axis IMU (Inclinometer & Rollover)
    fastSetText("hud-imu-pitch", `${packet.pitch_deg > 0 ? "+" : ""}${packet.pitch_deg.toFixed(1)}°`);
    fastSetText("hud-imu-roll", `${packet.roll_deg > 0 ? "+" : ""}${packet.roll_deg.toFixed(1)}°`);
    if (packet.imu) {
      fastSetText("hud-imu-grade", `SLOPE: ${packet.imu.grade_percent > 0 ? "+" : ""}${packet.imu.grade_percent.toFixed(1)}%`);
      fastSetText("hud-imu-grade-val", `${packet.imu.grade_percent > 0 ? "+" : ""}${packet.imu.grade_percent.toFixed(1)}%`);
      fastSetText("hud-imu-gforce", `${packet.imu.g_force_z.toFixed(2)} G`);
      const imuBadge = document.getElementById("hud-imu-status-badge");
      if (imuBadge) {
        if (packet.imu.impact_detected || Math.abs(packet.roll_deg) > 12) {
          imuBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-500 font-bold animate-pulse";
          imuBadge.innerText = "ROLLOVER RISK";
        } else {
          imuBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40";
          imuBadge.innerText = "STABLE";
        }
      }
    }

    // 6. Optical Wheel Encoder (Ground Odometry)
    if (packet.encoder) {
      fastSetText("hud-encoder-rpm", String(packet.encoder.rpm));
      fastSetText("hud-encoder-pulses", `${packet.encoder.pulses_per_sec} p/s`);
      fastSetText("hud-encoder-rpm-val", `${packet.encoder.rpm} RPM`);
      fastSetText("hud-encoder-pulses-val", `${packet.encoder.pulses_per_sec} p/s`);
      fastSetText("hud-encoder-speed-val", `${packet.encoder.speed_kmh.toFixed(1)} km/h`);
      fastSetText("hud-encoder-trip", `${Math.round(packet.encoder.trip_meters)} m`);
    } else {
      fastSetText("hud-encoder-rpm", String(packet.rpm || 1650));
      fastSetText("hud-encoder-pulses", `${Math.round((packet.rpm || 1650) / 3)} p/s`);
      fastSetText("hud-encoder-rpm-val", `${packet.rpm || 1650} RPM`);
      fastSetText("hud-encoder-pulses-val", `${Math.round((packet.rpm || 1650) / 3)} p/s`);
      fastSetText("hud-encoder-speed-val", `${packet.speed_kmh.toFixed(1)} km/h`);
      fastSetText("hud-encoder-trip", "1428 m");
    }

    // 7. NEO-M8N GPS Module
    if (packet.gps) {
      fastSetText("hud-gps-sats", `${packet.gps.satellites || 14} / 18`);
      fastSetText("hud-gps-hdop", `${(packet.gps.hdop || 0.82).toFixed(2)} m`);
      fastSetText("hud-gps-coords", `${packet.gps.lat.toFixed(4)}, ${packet.gps.lng.toFixed(4)}`);
    }

    // 8. V2V Communication Link (Wi-Fi / LoRa)
    if (packet.v2v) {
      fastSetText("hud-v2v-peer", packet.v2v.peer_car_id ? packet.v2v.peer_car_id.split(" ")[0] : "HEMM-DUMP-02");
      fastSetText("hud-v2v-dist", `${packet.v2v.distance_to_peer_m.toFixed(1)} m`);
      fastSetText("hud-v2v-rel-speed", `${packet.v2v.relative_speed_kmh > 0 ? "+" : ""}${packet.v2v.relative_speed_kmh.toFixed(1)} km/h`);
      fastSetText("hud-v2v-rssi", `${packet.v2v.rssi_dbm} dBm`);

      const v2vTag = document.getElementById("hud-v2v-alert-tag");
      if (v2vTag) {
        if (packet.v2v.auto_stop_actuated) {
          v2vTag.className = "text-rose-400 font-bold animate-pulse";
          v2vTag.innerText = "🛑 AUTO-STOP ENGAGED";
        } else if (packet.v2v.v2v_alert) {
          v2vTag.className = "text-amber-300 font-bold";
          v2vTag.innerText = "⚠️ PROXIMITY WARN";
        } else {
          v2vTag.className = "text-emerald-400 font-bold";
          v2vTag.innerText = "LINK SAFE";
        }
      }
    }

    // 9. Raspberry Pi 4B Edge Data Fusion
    if (packet.rpi_edge) {
      fastSetText("hud-fusion-lat", `${packet.rpi_edge.fusion_latency_ms.toFixed(1)} ms`);
    }

    // 10. ESP32 Motor Control & Safety Actuation Node
    if (packet.motor_control) {
      const espBadge = document.getElementById("hud-esp32-status");
      if (espBadge) {
        if (packet.motor_control.emergency_stop_actuated) {
          espBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-500 font-bold animate-pulse";
          espBadge.innerText = "MOTOR: E-STOPPED";
        } else if (packet.motor_control.status === "THROTTLE_CUT") {
          espBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-500 font-bold";
          espBadge.innerText = "MOTOR: THROTTLE CUT";
        } else {
          espBadge.className = "text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-bold";
          espBadge.innerText = "MOTOR: NORMAL";
        }
      }
      fastSetText("hud-pwm-duty", `PWM ${packet.motor_control.motor_pwm_duty}/255`);
      fastSetText("hud-buzzer-state", packet.motor_control.buzzer_active ? "ALARM" : "OFF");
    }

    // 11. Mirror to Central Dispatch Active Demo Telemetry Ribbon
    if (packet.collision_state === "CRITICAL") {
      fastSetText("disp-cam-status", packet.active_hazard === "MINER_IN_FOG" ? "👷 WORKER DETECTED" : "🚨 HAZARD IN PATH");
    } else if (packet.collision_state === "ADVISORY") {
      fastSetText("disp-cam-status", "⚠️ PROXIMITY WARN");
    } else {
      fastSetText("disp-cam-status", "HAUL ROAD CLEAR");
    }

    if (packet.tof_laser) {
      fastSetText("disp-tof-status", `L: ${packet.tof_laser.left_m.toFixed(1)}m / R: ${packet.tof_laser.right_m.toFixed(1)}m`);
    }
    fastSetText("disp-imu-status", `${packet.pitch_deg > 0 ? "+" : ""}${packet.pitch_deg.toFixed(1)}° P / ${packet.roll_deg > 0 ? "+" : ""}${packet.roll_deg.toFixed(1)}° R`);

    // 12. Active Payload & Chassis Indicators
    fastSetText("hud-payload-tons", `${(packet.payload_tons || 96.4).toFixed(1)} T`);
    const payloadBar = document.getElementById("hud-payload-bar");
    if (payloadBar) payloadBar.style.width = `${Math.min(100, Math.round(((packet.payload_tons || 96.4) / 120) * 100))}%`;

    // 13. AR Lane Visibility & Pitch/Roll Overlays
    fastSetText("ar-vis-dist", `${(packet.visibility_m || 11.3).toFixed(1)}m`);
    fastSetText("imu-pitch-val", `${packet.pitch_deg > 0 ? "+" : ""}${packet.pitch_deg.toFixed(1)}°`);
    fastSetText("imu-roll-val", `${packet.roll_deg > 0 ? "+" : ""}${packet.roll_deg.toFixed(1)}°`);
    if (packet.imu) {
      fastSetText("imu-grade-val", `${packet.imu.grade_percent > 0 ? "+" : ""}${packet.imu.grade_percent.toFixed(1)}% GRADE`);
    } else {
      fastSetText("imu-grade-val", "-2.8% GRADE");
    }

    // 14. Environmental Info Cards
    if (packet.atmosphere) {
      fastSetText("env-temp", `${Math.round(packet.atmosphere.temp_celsius)}°C`);
    } else {
      fastSetText("env-temp", "24°C");
    }
    fastSetText("env-dust", (packet.fog_density || 0) > 0.6 ? "HIGH" : ((packet.fog_density || 0) > 0.3 ? "MODERATE" : "LOW"));
    fastSetText("env-visibility", `${(packet.visibility_m || 8.5).toFixed(1)}m`);

    // 15. Systems Status
    const setSys = (id, val, cls) => {
      const el = document.getElementById(id);
      if (el) { el.innerText = val; el.className = cls; }
    };
    setSys("sys-engine", "OK", "text-emerald-400 font-bold");
    setSys("sys-hydraulics", "OK", "text-emerald-400 font-bold");
    setSys("sys-tires", "OK", "text-emerald-400 font-bold");
    setSys("sys-drive", "OK", "text-emerald-400 font-bold");

    // 16. Tire Pressures (Standard Operational PSI for Mining Dump Truck)
    fastSetText("tire-fl", "102 psi");
    fastSetText("tire-fr", "104 psi");
    fastSetText("tire-rl", "108 psi");
    fastSetText("tire-rr", "110 psi");

    // 17. Radar Scope Bearing & Active Tag
    fastSetText("radar-active-status", "RADAR ACTIVE");
    fastSetText("radar-bearing-val", `${Math.round(packet.heading_deg || 280)}°`);

    // 18. AI Perception Status Tag
    fastSetText("ai-perception-status", "AI PERCEPTION ACTIVE");
    fastSetText("ai-haul-road-status", packet.collision_state === "CLEAR" ? "HAUL ROAD CLEAR" : (packet.collision_state === "CRITICAL" ? "CRITICAL HAZARD" : "ADVISORY"));
  }

  async triggerV2VEStop() {
    try {
      const res = await fetch("/api/v2v/motor_stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: this.activeVehicleId || "HEMM-DUMP-07" })
      });
      if (res.ok) {
        const btn = document.getElementById("btn-trigger-v2v-estop");
        if (btn) {
          btn.innerText = "🛑 E-STOP ACTIVATED!";
          btn.className = "px-2 py-0.5 rounded bg-rose-600 text-white text-[9px] font-mono font-bold animate-pulse shadow-md";
          setTimeout(() => {
            btn.innerText = "⚡ TEST E-STOP";
            btn.className = "px-2 py-0.5 rounded bg-rose-900/90 hover:bg-rose-800 border border-rose-400 text-rose-100 text-[9px] font-mono font-bold transition-all shadow-sm";
          }, 3500);
        }
        await this.fetchTelemetryHttp();
      }
    } catch (e) {
      console.error("E-Stop trigger error:", e);
    }
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

  setCameraView(view) {
    const camCanvas = document.getElementById("camera-canvas");
    const thermalCanvas = document.getElementById("thermal-canvas");
    const btnCam = document.getElementById("btn-toggle-cam");
    const btnThermal = document.getElementById("btn-toggle-thermal");
    const viewTitle = document.getElementById("cam-view-title");
    const viewIcon = document.getElementById("cam-view-icon");
    const overlayTag = document.getElementById("cam-overlay-tag");

    if (view === "THERMAL") {
      camCanvas?.classList.add("hidden");
      thermalCanvas?.classList.remove("hidden");
      btnCam?.classList.remove("bg-cyan-600", "text-white");
      btnCam?.classList.add("bg-cyan-950", "text-cyan-300", "border", "border-cyan-500/40");
      btnThermal?.classList.remove("bg-cyan-950", "text-cyan-300", "border", "border-cyan-500/40");
      btnThermal?.classList.add("bg-cyan-600", "text-white");
      if (viewTitle) viewTitle.innerText = "THERMAL LWIR VIEWPORT";
      if (viewIcon) viewIcon.innerText = "🔥";
      if (overlayTag) overlayTag.innerText = "LWIR FLIR Lepton 3.5 | 160x120";
      this.thermalRenderer?.resize();
    } else {
      thermalCanvas?.classList.add("hidden");
      camCanvas?.classList.remove("hidden");
      btnThermal?.classList.remove("bg-cyan-600", "text-white");
      btnThermal?.classList.add("bg-cyan-950", "text-cyan-300", "border", "border-cyan-500/40");
      btnCam?.classList.remove("bg-cyan-950", "text-cyan-300", "border", "border-cyan-500/40");
      btnCam?.classList.add("bg-cyan-600", "text-white");
      if (viewTitle) viewTitle.innerText = "CAMERA AI VISION";
      if (viewIcon) viewIcon.innerText = "📹";
      if (overlayTag) overlayTag.innerText = "1080p AI VISION | YOLOv8-Nano";
      this.cameraRenderer?.resize();
    }
  }

  setAppMode(mode) {
    this.appMode = mode; // "DEMO_TRAINING" or "HARDWARE"

    const btnEnter = document.getElementById("btn-enter-training");
    const btnExit = document.getElementById("btn-exit-training");
    const bottomDemo = document.getElementById("bottom-demo-harness");
    const bottomHw = document.getElementById("bottom-hardware-blank");

    if (mode === "DEMO_TRAINING") {
      // Highlight Demo in sidebar
      if (btnEnter) {
        btnEnter.className = "flex-1 px-2 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 rounded-lg text-[11px] font-mono font-bold flex items-center justify-center gap-1 shadow-md shadow-amber-500/20 transition-all cursor-pointer";
      }
      if (btnExit) {
        btnExit.className = "flex-1 px-2 py-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 rounded-lg text-[11px] font-mono text-cyan-300 font-bold flex items-center justify-center gap-1 shadow-sm transition-all cursor-pointer";
      }

      // Bottom line: Show demo simulation hazard test bar
      bottomDemo?.classList.remove("hidden");
      bottomHw?.classList.add("hidden");

      this.activeVehicleId = "HEMM-DUMP-07";
      if (this.dispatchMap) {
        this.dispatchMap.hasAutoCentered = false;
        this.dispatchMap.selectedVehicle = "HEMM-DUMP-07";
      }

      // Guaranteed instant simulated telemetry packet: 0ms lag, no vanishing!
      const demoPacket = {
        vehicle_id: "HEMM-DUMP-07",
        vehicle_name: "CAT 777D Dump Truck (Unit 07)",
        vehicle_type: "DUMP_TRUCK",
        car_role: "DUMP_TRUCK",
        timestamp: Date.now() / 1000,
        speed_kmh: 38.0,
        heading_deg: 182.0,
        gear: "D3",
        rpm: 1750,
        pitch_deg: -2.8,
        roll_deg: 0.5,
        brake_pressure_psi: 60.0,
        payload_tons: 96.4,
        fog_density: 0.65,
        visibility_m: 8.5,
        zone_name: "Mid-Pit Berm Zone",
        gps: { lat: 18.7155, lng: 81.2538, altitude_m: 1220.0 },
        radar: {
          target_detected: true,
          distance_m: 22.5,
          relative_speed_kmh: -1.2,
          azimuth_deg: 1.5,
          snr_db: 32.0,
          targets: [
            {
              target_id: "RAD-HAUL-02",
              distance_m: 22.5,
              relative_speed_kmh: -1.2,
              azimuth_deg: 1.5,
              snr_db: 32.0,
              target_type: "DUMP_TRUCK",
              ttc_seconds: 45.0
            }
          ],
          sweep_angle_deg: 45.0
        },
        tof_laser: {
          left_cm: 420.0,
          right_cm: 410.0,
          left_m: 4.20,
          right_m: 4.10,
          berm_warning: false
        },
        imu: {
          pitch_deg: -2.8,
          roll_deg: 0.5,
          yaw_deg: 182.0,
          grade_percent: -4.9,
          g_force_z: 1.02,
          impact_detected: false
        },
        encoder: {
          speed_kmh: 38.0,
          rpm: 3990,
          trip_meters: 1176.0,
          pulses_per_sec: 1330
        },
        atmosphere: {
          temp_celsius: 23.7,
          pressure_hpa: 985.0,
          altitude_m: 1220.0
        },
        v2v: {
          connected: true,
          peer_car_id: "HEMM-DUMP-02",
          distance_to_peer_m: 18.5,
          relative_speed_kmh: -2.0,
          rssi_dbm: -62,
          v2v_alert: false,
          auto_stop_actuated: false
        },
        camera_stream_active: true,
        camera_detections_count: 1,
        collision_state: "CLEAR",
        time_to_collision_s: 45.0,
        berm_proximity: {
          left_dist_m: 4.2,
          right_dist_m: 4.1,
          lane_offset_m: 0.0,
          departure_warning: false
        },
        mode: "SIMULATION",
        active_hazard: "NONE"
      };
      this.latestPacket = demoPacket;
      this.lastDomUpdate = 0;
      this.updateInstrumentCluster(demoPacket);
      this.consumePacket(demoPacket);

      // Trigger redraws immediately
      if (this.currentView === "HUD" || this.currentView === "DUAL") {
        try { this.cameraRenderer?.render(demoPacket); } catch (e) {}
        try { this.speedometerRenderer?.render(); } catch (e) {}
        try { this.tofRenderer?.render(demoPacket); } catch (e) {}
        try { this.inclinometerRenderer?.render(demoPacket); } catch (e) {}
        try { this.radarRenderer?.render(); } catch (e) {}
        try { this.arLaneRenderer?.render(); } catch (e) {}
      }

      fetch("/api/mode/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "SIMULATION" })
      }).then(() => this.fetchTelemetryHttp()).catch(() => {});
    } else {
      // HARDWARE MODE: Highlight Hardware in sidebar
      if (btnEnter) {
        btnEnter.className = "flex-1 px-2 py-2 bg-amber-950 hover:bg-amber-900 border border-amber-500/50 text-amber-300 rounded-lg text-[11px] font-mono font-bold flex items-center justify-center gap-1 shadow-sm transition-all cursor-pointer";
      }
      if (btnExit) {
        btnExit.className = "flex-1 px-2 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[11px] font-mono font-bold flex items-center justify-center gap-1 shadow-md shadow-cyan-500/30 transition-all cursor-pointer";
      }

      // Bottom line: Khali / empty in hardware mode
      bottomDemo?.classList.add("hidden");
      bottomHw?.classList.remove("hidden");

      if (this.packetsIngestedCount === 0) {
        // Clean authentic hardware standby packet: 0.0 km/h, no fake trucks or pseudo blips!
        const hwStandbyPacket = {
          vehicle_id: this.pairedVehicleName || "HEMM-DUMP-07",
          vehicle_name: "ACTIVE HARDWARE NODE (Pairing Standby)",
          vehicle_type: "DUMP_TRUCK",
          car_role: "DUMP_TRUCK",
          timestamp: Date.now() / 1000,
          speed_kmh: 0.0,
          heading_deg: 180.0,
          gear: "P",
          rpm: 0,
          pitch_deg: 0.0,
          roll_deg: 0.0,
          brake_pressure_psi: 0.0,
          payload_tons: 0.0,
          fog_density: 0.0,
          visibility_m: 100.0,
          zone_name: "Deposit 14 (Pairing Standby)",
          gps: { lat: 18.7145, lng: 81.2525, altitude_m: 1220.0 },
          radar: {
            target_detected: false,
            distance_m: 999.0,
            relative_speed_kmh: 0.0,
            azimuth_deg: 0.0,
            targets: [],
            sweep_angle_deg: 0.0
          },
          tof_laser: {
            left_cm: 0.0,
            right_cm: 0.0,
            left_m: 0.0,
            right_m: 0.0,
            berm_warning: false
          },
          imu: {
            pitch_deg: 0.0,
            roll_deg: 0.0,
            grade_percent: 0.0,
            g_force_z: 1.0,
            impact_detected: false
          },
          encoder: {
            speed_kmh: 0.0,
            rpm: 0,
            trip_meters: 0.0,
            pulses_per_sec: 0
          },
          atmosphere: {
            temp_celsius: 24.0,
            pressure_hpa: 985.0,
            altitude_m: 1220.0
          },
          v2v: {
            connected: false,
            peer_car_id: "None",
            distance_to_peer_m: 0.0,
            relative_speed_kmh: 0.0,
            rssi_dbm: 0,
            v2v_alert: false,
            auto_stop_actuated: false
          },
          camera_stream_active: false,
          camera_detections_count: 0,
          collision_state: "CLEAR",
          time_to_collision_s: null,
          berm_proximity: {
            left_dist_m: 0.0,
            right_dist_m: 0.0,
            lane_offset_m: 0.0,
            departure_warning: false
          },
          mode: "HARDWARE_STANDBY",
          active_hazard: "NONE"
        };
        this.latestPacket = hwStandbyPacket;
        this.consumePacket(hwStandbyPacket);

        if (this.currentView === "HUD" || this.currentView === "DUAL") {
          try { this.cameraRenderer?.render(hwStandbyPacket); } catch (e) {}
          try { this.speedometerRenderer?.render(); } catch (e) {}
          try { this.tofRenderer?.render(hwStandbyPacket); } catch (e) {}
          try { this.inclinometerRenderer?.render(hwStandbyPacket); } catch (e) {}
          try { this.radarRenderer?.render(); } catch (e) {}
          try { this.arLaneRenderer?.render(); } catch (e) {}
        }
      }

      fetch("/api/mode/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "HARDWARE" })
      }).then(() => this.fetchTelemetryHttp()).catch(() => {});
    }

    this.updateCabUnitOptions();
  }

  openNotesModal() {
    const modal = document.getElementById("notes-modal");
    if (modal) {
      modal.style.display = "flex";
      modal.classList.remove("hidden");
    }
    this.fetchNotes();
  }

  closeNotesModal() {
    const modal = document.getElementById("notes-modal");
    if (modal) {
      modal.style.display = "none";
      modal.classList.add("hidden");
    }
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
