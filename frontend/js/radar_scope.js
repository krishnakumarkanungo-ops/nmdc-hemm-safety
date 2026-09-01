/**
 * 24 GHz / 77 GHz mmWave Polar Radar Scope Renderer
 * High-performance 2D Canvas polar sweep displaying detected obstacle points,
 * range rings (5m, 10m, 20m, 50m), angular grid, velocity vectors, and danger cones.
 */

class RadarScopeRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.maxRangeMeters = 50.0;
    this.currentData = null;
    this.sweepAngle = 0.0;
    this.pingAnimations = new Map(); // targetId -> { radius, opacity }
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height > 200 ? rect.height : 360);
    this.canvas.width = size * window.devicePixelRatio || 360;
    this.canvas.height = size * window.devicePixelRatio || 360;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
  }

  update(radarTelemetry, collisionState) {
    this.currentData = radarTelemetry;
    this.collisionState = collisionState || "CLEAR";
    if (radarTelemetry && radarTelemetry.sweep_angle_deg !== undefined) {
      this.sweepAngle = (radarTelemetry.sweep_angle_deg * Math.PI) / 180.0;
    }
    this.render();
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 16 * (w / 360);

    // Clear background
    ctx.clearRect(0, 0, w, h);

    // Outer tactical ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#09101c";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1e3a5f";
    ctx.stroke();

    // 1. Draw Range Rings (5m, 10m, 20m, 50m)
    const ranges = [
      { m: 5, label: "5m", color: "rgba(239, 68, 68, 0.4)", stroke: [3, 3] },
      { m: 10, label: "10m", color: "rgba(245, 158, 11, 0.4)", stroke: [4, 4] },
      { m: 20, label: "20m", color: "rgba(6, 182, 212, 0.35)", stroke: [] },
      { m: 50, label: "50m", color: "rgba(6, 182, 212, 0.2)", stroke: [] },
    ];

    ranges.forEach(r => {
      const rPx = (r.m / this.maxRangeMeters) * radius;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(r.stroke);
      ctx.stroke();
      ctx.setLineDash([]);

      // Range text label
      ctx.fillStyle = "rgba(148, 163, 184, 0.75)";
      ctx.font = `${Math.round(9 * (w / 360))}px 'JetBrains Mono', monospace`;
      ctx.fillText(r.label, cx + 4, cy - rPx + 11);
    });

    // 2. Draw Polar Spokes (30°, 60°, 90°, 120°, 150°, etc.)
    ctx.strokeStyle = "rgba(30, 58, 95, 0.6)";
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
      ctx.stroke();
    }

    // 3. Draw 120° Forward Hazard Cone
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const fovStart = -Math.PI / 2 - (60 * Math.PI) / 180;
    const fovEnd = -Math.PI / 2 + (60 * Math.PI) / 180;
    ctx.arc(cx, cy, radius, fovStart, fovEnd);
    ctx.closePath();
    ctx.fillStyle = "rgba(6, 182, 212, 0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(6, 182, 212, 0.35)";
    ctx.stroke();

    // 4. Draw Sweeping Phosphor Beam
    const trailAngle = Math.PI / 3; // 60 deg trail
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, "rgba(6, 182, 212, 0.25)");
    grad.addColorStop(1, "rgba(6, 182, 212, 0.0)");

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, this.sweepAngle - trailAngle, this.sweepAngle);
    ctx.closePath();
    ctx.fillStyle = "rgba(6, 182, 212, 0.12)";
    ctx.fill();

    // Main sweep lead line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.sweepAngle) * radius, cy + Math.sin(this.sweepAngle) * radius);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#38bdf8";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();

    // 5. Draw Host Dumper (Center icon)
    ctx.save();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.lineTo(cx - 6, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 6. Draw Detected Targets & Bounding Boxes
    if (this.currentData && this.currentData.targets) {
      this.currentData.targets.forEach(tgt => {
        // Map target azimuth (deg: 0 = straight up in front, positive = right) & distance
        const azRad = ((tgt.azimuth_deg - 90) * Math.PI) / 180.0;
        const distPx = (Math.min(tgt.distance_m, this.maxRangeMeters) / this.maxRangeMeters) * radius;
        const tx = cx + Math.cos(azRad) * distPx;
        const ty = cy + Math.sin(azRad) * distPx;

        // Determine target color based on distance and severity
        let tgtColor = "#10b981";
        let glowColor = "rgba(16, 185, 129, 0.8)";
        if (tgt.distance_m < 8.0) {
          tgtColor = "#ef4444";
          glowColor = "rgba(239, 68, 68, 0.9)";
        } else if (tgt.distance_m < 18.0) {
          tgtColor = "#f59e0b";
          glowColor = "rgba(245, 158, 11, 0.8)";
        }

        // Ripple Ping Animation
        ctx.save();
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.5;
        const rippleR = 8 + (Date.now() % 1000) * 0.015;
        ctx.beginPath();
        ctx.arc(tx, ty, rippleR, 0, Math.PI * 2);
        ctx.stroke();

        // Target Bounding Box / Diamond
        ctx.fillStyle = tgtColor;
        ctx.shadowColor = tgtColor;
        ctx.shadowBlur = 12;
        ctx.fillRect(tx - 4, ty - 4, 8, 8);

        // Velocity vector line
        if (tgt.relative_speed_kmh !== 0) {
          const vLen = Math.min(25, Math.abs(tgt.relative_speed_kmh) * 1.5);
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx, ty + (tgt.relative_speed_kmh < 0 ? vLen : -vLen));
          ctx.strokeStyle = tgtColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Tactical HUD Tag
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(9 * (w / 360))}px 'JetBrains Mono', monospace`;
        const tagText = `${tgt.distance_m.toFixed(1)}m | ${tgt.target_type}`;
        ctx.fillText(tagText, tx + 8, ty - 2);

        if (tgt.ttc_seconds) {
          ctx.fillStyle = tgtColor;
          ctx.fillText(`TTC: ${tgt.ttc_seconds.toFixed(1)}s`, tx + 8, ty + 10);
        }

        ctx.restore();
      });
    }

    // Outer Compass Bearings
    ctx.fillStyle = "#38bdf8";
    ctx.font = `bold ${Math.round(10 * (w / 360))}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "center";
    ctx.fillText("000° FWD", cx, 14);
    ctx.fillText("180° REV", cx, h - 4);
    ctx.textAlign = "left";
    ctx.fillText("090° R", w - 42, cy + 4);
    ctx.textAlign = "right";
    ctx.fillText("270° L", 42, cy + 4);
  }
}

window.RadarScopeRenderer = RadarScopeRenderer;
