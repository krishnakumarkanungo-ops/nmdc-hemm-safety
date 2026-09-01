/**
 * Virtual Haul Lane Projection (AR Guide Canvas)
 * Renders 3D perspective haul road lane boundaries, safety berm clearances,
 * centerline drift warnings, and atmospheric fog occlusion for in-cab HUD.
 */

class ARLaneHUDRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.bermData = { left_dist_m: 4.2, right_dist_m: 4.0, lane_center_offset_m: 0.0, lane_departure_warning: false };
    this.fogDensity = 0.65;
    this.visibilityMeters = 6.5;
    this.collisionState = "CLEAR";
    this.targetDist = 999.0;
    this.targetType = "NONE";
    this.roadCurve = 0.0;
    this.animTime = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 420;
    const h = rect.height > 200 ? rect.height : 280;
    this.canvas.width = Math.floor(w * window.devicePixelRatio || 420);
    this.canvas.height = Math.floor(h * window.devicePixelRatio || 280);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  update(bermProximity, fogDensity, visibilityM, collisionState, radarData) {
    if (bermProximity) this.bermData = bermProximity;
    if (fogDensity !== undefined) this.fogDensity = fogDensity;
    if (visibilityM !== undefined) this.visibilityMeters = visibilityM;
    if (collisionState) this.collisionState = collisionState;

    if (radarData && radarData.target_detected) {
      this.targetDist = radarData.distance_m;
      this.targetType = (radarData.targets && radarData.targets[0]) ? radarData.targets[0].target_type : "OBSTACLE";
    } else {
      this.targetDist = 999.0;
      this.targetType = "NONE";
    }

    this.animTime += 0.05;
    this.render();
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Horizon and Perspective parameters
    const horizonY = h * 0.42;
    const vpX = w / 2 + this.roadCurve * 40; // Vanishing point
    const vpY = horizonY;

    // 1. Draw Haul Road Floor Gradient
    const roadGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    roadGrad.addColorStop(0, "#0e1726");
    roadGrad.addColorStop(1, "#182235");
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // 2. Perspective Road Boundaries & Berm Walls
    const roadHalfWidthBottom = w * 0.42;
    const roadHalfWidthTop = w * 0.04;
    const offsetPx = (this.bermData.lane_center_offset_m || 0) * (w * 0.08);

    const leftBottom = vpX - roadHalfWidthBottom + offsetPx;
    const rightBottom = vpX + roadHalfWidthBottom + offsetPx;
    const leftTop = vpX - roadHalfWidthTop;
    const rightTop = vpX + roadHalfWidthTop;

    // Draw Left Safety Berm Guideline
    const leftColor = this.bermData.berm_warning_side === "LEFT" || this.bermData.left_dist_m < 1.5 ? "#ef4444" : (this.bermData.left_dist_m < 2.5 ? "#f59e0b" : "#06b6d4");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftTop, vpY);
    ctx.lineTo(leftBottom, h);
    ctx.strokeStyle = leftColor;
    ctx.lineWidth = 4;
    ctx.shadowColor = leftColor;
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Berm neon distance markers (Left)
    for (let i = 1; i <= 4; i++) {
      const t = i / 4.0;
      const py = vpY + (h - vpY) * t;
      const px = leftTop + (leftBottom - leftTop) * t;
      ctx.beginPath();
      ctx.moveTo(px - 15 * t, py);
      ctx.lineTo(px, py);
      ctx.strokeStyle = leftColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // Draw Right Safety Berm Guideline
    const rightColor = this.bermData.berm_warning_side === "RIGHT" || this.bermData.right_dist_m < 1.5 ? "#ef4444" : (this.bermData.right_dist_m < 2.5 ? "#f59e0b" : "#06b6d4");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rightTop, vpY);
    ctx.lineTo(rightBottom, h);
    ctx.strokeStyle = rightColor;
    ctx.lineWidth = 4;
    ctx.shadowColor = rightColor;
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Berm neon distance markers (Right)
    for (let i = 1; i <= 4; i++) {
      const t = i / 4.0;
      const py = vpY + (h - vpY) * t;
      const px = rightTop + (rightBottom - rightTop) * t;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 15 * t, py);
      ctx.strokeStyle = rightColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // 3. Centerline Haul Road Guidance (Animated Dashed Green/Yellow Line)
    const centerBottom = (leftBottom + rightBottom) / 2;
    const centerTop = (leftTop + rightTop) / 2;
    const centerColor = this.bermData.lane_departure_warning ? "#f59e0b" : "#10b981";

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(centerTop, vpY);
    ctx.lineTo(centerBottom, h);
    ctx.strokeStyle = centerColor;
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 12]);
    ctx.lineDashOffset = -this.animTime * 40;
    ctx.shadowColor = centerColor;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 4. AR Obstacle 3D Holographic Bracket (if target detected ahead)
    if (this.targetDist < 40.0) {
      // Perspective distance mapping (0m is bottom, 40m is near horizon)
      const normD = Math.max(0.05, Math.min(1.0, this.targetDist / 40.0));
      const objY = h - (h - vpY) * (1.0 - normD);
      const scale = Math.max(0.2, (1.0 - normD * 0.8));
      const objW = 90 * scale * (w / 420);
      const objH = 90 * scale * (h / 280);
      const objX = centerTop + (centerBottom - centerTop) * (1.0 - normD);

      const obColor = this.collisionState === "CRITICAL" ? "#ef4444" : "#f59e0b";

      ctx.save();
      ctx.strokeStyle = obColor;
      ctx.lineWidth = 3;
      ctx.shadowColor = obColor;
      ctx.shadowBlur = 14;

      // 3D Bracket Reticle
      ctx.strokeRect(objX - objW / 2, objY - objH, objW, objH);

      // Warning Header
      ctx.fillStyle = obColor;
      ctx.font = `bold ${Math.round(11 * (w / 420))}px 'JetBrains Mono', monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`⚠️ ${this.targetDist.toFixed(1)}m | ${this.targetType}`, objX, objY - objH - 8);

      if (this.collisionState === "CRITICAL") {
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(13 * (w / 420))}px 'Chakra Petch', sans-serif`;
        ctx.fillText("CRITICAL BRAKE NOW", objX, objY - objH / 2);
      }
      ctx.restore();
    }

    // 5. Heavy Fog Atmospheric Occlusion Layer
    const fogGrad = ctx.createLinearGradient(0, 0, 0, h);
    const fogAlpha = Math.min(0.92, this.fogDensity * 0.85);
    fogGrad.addColorStop(0, `rgba(15, 23, 42, ${fogAlpha + 0.1})`);
    fogGrad.addColorStop(0.45, `rgba(15, 23, 42, ${fogAlpha})`);
    fogGrad.addColorStop(1, `rgba(15, 23, 42, ${fogAlpha * 0.3})`);
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, w, h);

    // 6. HUD Tactical Berm Clearance Readouts
    ctx.font = `bold ${Math.round(12 * (w / 420))}px 'JetBrains Mono', monospace`;
    
    // Left Berm Tag
    ctx.fillStyle = leftColor;
    ctx.textAlign = "left";
    ctx.fillText(`BERM-L: ${this.bermData.left_dist_m.toFixed(1)}m`, 14, h - 16);

    // Right Berm Tag
    ctx.fillStyle = rightColor;
    ctx.textAlign = "right";
    ctx.fillText(`BERM-R: ${this.bermData.right_dist_m.toFixed(1)}m`, w - 14, h - 16);

    // Fog Visibility Header
    ctx.textAlign = "center";
    ctx.fillStyle = this.visibilityMeters < 5.0 ? "#ef4444" : (this.visibilityMeters < 10.0 ? "#f59e0b" : "#38bdf8");
    ctx.fillText(`👁️ VISIBILITY: ${this.visibilityMeters.toFixed(1)}m [${this.visibilityMeters < 4 ? "ZERO-VIS CODE BLACK" : "HEAVY MINE FOG"}]`, w / 2, 22);
  }
}

window.ARLaneHUDRenderer = ARLaneHUDRenderer;
