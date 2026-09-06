/**
 * Theme T-03: Glacier Cyan Speedometer & Oscilloscope Wave Renderer
 * Recreates the exact dual-arc cyan gauge and suspension dynamics curve from Theme T-03
 */

class GlacierSpeedometerRenderer {
  constructor(gaugeCanvasId, waveCanvasId) {
    this.gaugeCanvas = document.getElementById(gaugeCanvasId);
    this.waveCanvas = document.getElementById(waveCanvasId);
    this.gaugeCtx = this.gaugeCanvas ? this.gaugeCanvas.getContext("2d") : null;
    this.waveCtx = this.waveCanvas ? this.waveCanvas.getContext("2d") : null;

    this.currentSpeed = 38.0;
    this.targetSpeed = 38.0;
    this.currentRpm = 1750;
    this.fuelPercent = 82;
    this.wavePhase = 0;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    if (this.gaugeCanvas) {
      const rect = this.gaugeCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width || 260;
      const h = rect.height || 180;
      this.gaugeCanvas.width = w * dpr;
      this.gaugeCanvas.height = h * dpr;
      if (this.gaugeCtx) {
        this.gaugeCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.gaugeCtx.scale(dpr, dpr);
      }
      this.gw = w;
      this.gh = h;
    }

    if (this.waveCanvas) {
      const rect = this.waveCanvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width || 260;
      const h = rect.height || 45;
      this.waveCanvas.width = w * dpr;
      this.waveCanvas.height = h * dpr;
      if (this.waveCtx) {
        this.waveCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.waveCtx.scale(dpr, dpr);
      }
      this.ww = w;
      this.wh = h;
    }
  }

  update(packet) {
    const isHardwareStandby = (window.app && window.app.appMode === "HARDWARE") && 
      ((packet && packet.mode === "HARDWARE_STANDBY") || window.app.packetsIngestedCount === 0);

    if (isHardwareStandby) {
      this.targetSpeed = 0.0;
      this.currentSpeed = 0.0;
      this.currentRpm = 0;
      this.fuelPercent = 100;
    } else if (packet) {
      const spd = packet.speed_kmh !== undefined ? packet.speed_kmh : 38.0;
      this.targetSpeed = spd;
      this.currentRpm = (packet.rpm !== undefined ? packet.rpm : packet.engine_rpm) || 1750;
      this.fuelPercent = 82;
    }
  }

  render() {
    const isHardwareStandby = (window.app && window.app.appMode === "HARDWARE") && 
      (window.app.packetsIngestedCount === 0 || (window.app.latestPacket && window.app.latestPacket.mode === "HARDWARE_STANDBY"));

    if (isHardwareStandby) {
      this.targetSpeed = 0.0;
      this.currentSpeed = 0.0;
      this.currentRpm = 0;
    } else {
      // Smooth speed interpolation
      this.currentSpeed += (this.targetSpeed - this.currentSpeed) * 0.15;
    }

    this.wavePhase = (this.wavePhase + 0.08) % (Math.PI * 2);

    this.renderGauge();
    this.renderWave();
  }

  renderGauge() {
    if (!this.gaugeCtx || !this.gaugeCanvas) return;
    const ctx = this.gaugeCtx;
    const w = this.gw;
    const h = this.gh;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.62;
    const radius = Math.min(w * 0.42, h * 0.52);

    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const totalAngle = endAngle - startAngle;

    const maxSpeed = 60.0;
    const speedFraction = Math.min(1.0, Math.max(0.0, this.currentSpeed / maxSpeed));
    const currentAngle = startAngle + speedFraction * totalAngle;

    // 1. Outer Track Background Arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = "rgba(0, 210, 255, 0.15)";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.stroke();

    // 2. Outer Glowing Active Arc
    ctx.save();
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, currentAngle);
    ctx.strokeStyle = "#00d2ff";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();

    // 3. Inner Concentric Cyan Track Arc
    const innerRadius = radius - 16;
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, startAngle, endAngle);
    ctx.strokeStyle = "rgba(6, 182, 212, 0.18)";
    ctx.lineWidth = 4;
    ctx.stroke();

    // 4. Inner Active Arc
    ctx.save();
    ctx.shadowColor = "#38bdf8";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, startAngle, currentAngle);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    // 5. Large Center Speed Digital Number
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 18;
    ctx.font = "bold 38px 'Rajdhani', sans-serif";
    ctx.fillText(Math.round(this.currentSpeed).toString(), cx, cy - 8);

    // km/h label below
    ctx.fillStyle = "#7dd3fc";
    ctx.shadowBlur = 6;
    ctx.font = "600 13px 'Rajdhani', sans-serif";
    ctx.fillText("km/h", cx, cy + 18);
    ctx.restore();

    // 6. Side Metric Callouts: "45" and "1850"
    ctx.font = "bold 12px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#38bdf8";
    ctx.textAlign = "left";
    ctx.fillText(Math.round(this.currentSpeed).toString(), cx - radius - 6, cy + 18);

    ctx.textAlign = "right";
    ctx.fillText(this.currentRpm.toString(), cx + radius + 6, cy + 18);

    // 7. Fuel Arc & Percentage
    const isStandby = this.currentSpeed < 0.5 && 
      (window.app && window.app.appMode === "HARDWARE") && 
      (window.app.packetsIngestedCount === 0 || (window.app.latestPacket && window.app.latestPacket.mode === "HARDWARE_STANDBY"));
    const fuelY = cy + 34;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(isStandby ? "⛽ STANDBY" : "⛽ " + this.fuelPercent + "%", cx, fuelY);

    // 8. RPM mini bar
    const barW = 80;
    const barH = 3;
    const barX = cx - barW / 2;
    const barY = fuelY + 7;
    ctx.fillStyle = "rgba(0, 210, 255, 0.2)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = "#00d2ff";
    ctx.fillRect(barX, barY, (this.currentRpm / 2400) * barW, barH);
  }

  renderWave() {
    if (!this.waveCtx || !this.waveCanvas) return;
    const ctx = this.waveCtx;
    const w = this.ww;
    const h = this.wh;

    ctx.clearRect(0, 0, w, h);

    // Baseline axis line
    ctx.strokeStyle = "rgba(0, 210, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const isStandby = this.currentSpeed < 0.5 && 
      (window.app && window.app.appMode === "HARDWARE") && 
      (window.app.packetsIngestedCount === 0 || (window.app.latestPacket && window.app.latestPacket.mode === "HARDWARE_STANDBY"));

    ctx.save();
    ctx.shadowColor = "#00d2ff";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#00d2ff";
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (isStandby) {
      // Quiet sensor standby baseline: flatline with subtle heartbeat blip
      const pulseY = h / 2 + Math.sin(this.wavePhase) * 1.5;
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w * 0.44, h / 2);
      ctx.lineTo(w * 0.47, pulseY - 5);
      ctx.lineTo(w * 0.53, pulseY + 5);
      ctx.lineTo(w * 0.56, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Oscilloscope Cyan Sine Wave with Harmonics
    const freq = 0.04;
    const amp = (h / 2) * 0.65;
    for (let x = 0; x < w; x++) {
      // Modulated sine wave with localized pulse peak near 60% width
      const centerFactor = Math.exp(-Math.pow((x - w * 0.65) / 35, 2));
      const y = h / 2 + Math.sin(x * freq + this.wavePhase) * amp * (0.3 + centerFactor * 0.8)
              + Math.sin(x * 0.08 - this.wavePhase * 1.5) * (amp * 0.2);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

window.GlacierSpeedometerRenderer = GlacierSpeedometerRenderer;
