/**
 * Hardware Gauges Renderer (VL53L1X ToF Laser Ranging & MPU6050 6-Axis IMU)
 * Protected against canvas scale overflow with reset matrix
 */

class LaserToFRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.pulse = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 280;
    this.height = rect.height || 65;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  render(packet) {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    this.pulse = (this.pulse + 0.05) % 1;

    // Dark Background
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, w, h);

    // Center Vehicle Icon / Outline
    const cX = w / 2;
    const cY = h / 2;

    // Draw Truck Chassis footprint
    ctx.fillStyle = "#1e293b";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    ctx.fillRect(cX - 14, cY - 18, 28, 36);
    ctx.strokeRect(cX - 14, cY - 18, 28, 36);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText("HEMM", cX, cY + 3);

    // ToF Left & Right distances
    const isHardwareStandby = (window.app && window.app.appMode === "HARDWARE") && 
      (window.app.packetsIngestedCount === 0 || (packet && packet.mode === "HARDWARE_STANDBY"));

    if (isHardwareStandby) {
      // Standby dotted laser paths
      ctx.strokeStyle = "rgba(0, 210, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cX - 14, cY); ctx.lineTo(15, cY);
      ctx.moveTo(cX + 14, cY); ctx.lineTo(w - 15, cY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Standby text overlay
      ctx.font = "bold 9px monospace";
      ctx.fillStyle = "#38bdf8";
      ctx.textAlign = "left";
      ctx.fillText("L: -- m", 6, 14);

      ctx.textAlign = "right";
      ctx.fillText("R: -- m", w - 6, 14);

      ctx.textAlign = "center";
      ctx.fillStyle = "#94a3b8";
      ctx.font = "8px monospace";
      ctx.fillText("VL53L1X: STANDBY", cX, h - 6);
      return;
    }

    const tof = (packet && packet.tof_laser) || {};
    const leftDist = (tof.left_m !== undefined) ? tof.left_m : 4.2;
    const rightDist = (tof.right_m !== undefined) ? tof.right_m : 4.1;

    // Left Laser Beam (towards left berm)
    const maxLaserReach = 6.0; // 6 meters scale
    const leftPx = (leftDist / maxLaserReach) * (cX - 25);
    const leftColor = (leftDist < 1.5) ? "#ef4444" : ((leftDist < 2.5) ? "#f59e0b" : "#10b981");

    ctx.strokeStyle = leftColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cX - 14, cY);
    ctx.lineTo(cX - 14 - leftPx, cY);
    ctx.stroke();

    // Left Beam Pulse dot
    const lDotX = (cX - 14) - leftPx * this.pulse;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(lDotX, cY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Left Berm Boundary Wall
    ctx.fillStyle = leftColor;
    ctx.fillRect(cX - 16 - leftPx, cY - 20, 3, 40);

    // Right Laser Beam (towards right berm)
    const rightPx = (rightDist / maxLaserReach) * (w - cX - 25);
    const rightColor = (rightDist < 1.5) ? "#ef4444" : ((rightDist < 2.5) ? "#f59e0b" : "#10b981");

    ctx.strokeStyle = rightColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cX + 14, cY);
    ctx.lineTo(cX + 14 + rightPx, cY);
    ctx.stroke();

    // Right Beam Pulse dot
    const rDotX = (cX + 14) + rightPx * this.pulse;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(rDotX, cY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Right Berm Boundary Wall
    ctx.fillStyle = rightColor;
    ctx.fillRect(cX + 14 + rightPx, cY - 20, 3, 40);

    // Dynamic Distances Overlay Text
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = leftColor;
    ctx.textAlign = "left";
    ctx.fillText(`L: ${leftDist.toFixed(2)}m`, 6, 14);

    ctx.fillStyle = rightColor;
    ctx.textAlign = "right";
    ctx.fillText(`R: ${rightDist.toFixed(2)}m`, w - 6, 14);
  }
}

class InclinometerGaugeRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 280;
    this.height = rect.height || 65;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  render(packet) {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    const isHardwareStandby = (window.app && window.app.appMode === "HARDWARE") && 
      (window.app.packetsIngestedCount === 0 || (packet && packet.mode === "HARDWARE_STANDBY"));

    const pitch = isHardwareStandby ? 0.0 : ((packet && packet.pitch_deg !== undefined) ? packet.pitch_deg : -2.8);
    const roll = isHardwareStandby ? 0.0 : ((packet && packet.roll_deg !== undefined) ? packet.roll_deg : 0.5);

    // Dark Background
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, w, h);

    const cX = w / 2;
    const cY = h / 2;

    ctx.save();
    ctx.translate(cX, cY);

    // Roll rotation
    const rollRad = (roll * Math.PI) / 180;
    ctx.rotate(rollRad);

    // Pitch vertical offset (1 deg = 2.2px)
    const pitchPx = pitch * 2.2;

    // Artificial Horizon Line
    const horizonGrad = ctx.createLinearGradient(0, pitchPx - 25, 0, pitchPx + 25);
    horizonGrad.addColorStop(0, "rgba(56, 189, 248, 0.1)");
    horizonGrad.addColorStop(1, "rgba(180, 83, 9, 0.15)");
    ctx.fillStyle = horizonGrad;
    ctx.fillRect(-w, pitchPx, w * 2, h);

    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, pitchPx);
    ctx.lineTo(w * 0.42, pitchPx);
    ctx.stroke();

    // Pitch Ladder Lines (+10, +5, -5, -10 deg)
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 1;
    [-10, -5, 5, 10].forEach(deg => {
      const y = pitchPx - (deg * 2.2);
      ctx.beginPath();
      ctx.moveTo(-20, y);
      ctx.lineTo(20, y);
      ctx.stroke();
    });

    ctx.restore();

    // Fixed Aircraft / Chassis Reticle (Amber Cross / Wings)
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    // Left wing
    ctx.moveTo(cX - 28, cY);
    ctx.lineTo(cX - 8, cY);
    ctx.lineTo(cX - 8, cY + 4);
    // Right wing
    ctx.moveTo(cX + 28, cY);
    ctx.lineTo(cX + 8, cY);
    ctx.lineTo(cX + 8, cY + 4);
    // Center Pip
    ctx.arc(cX, cY, 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

window.LaserToFRenderer = LaserToFRenderer;
window.InclinometerGaugeRenderer = InclinometerGaugeRenderer;
