/**
 * 3D Virtual Haul Lane & Berm AR Projection HUD Canvas (Smooth 60 FPS Lerped)
 * Synthetic perspective corridor rendering for zero-visibility mining haul roads.
 */

class ARLaneHUDRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    
    // Smooth Lerped States
    this.currentBermLeft = 4.2;
    this.currentBermRight = 4.1;
    this.currentFogDensity = 0.65;
    this.currentVisibility = 12.0;
    this.currentLaneOffset = 0.0;
    
    this.targetBermLeft = 4.2;
    this.targetBermRight = 4.1;
    this.targetFogDensity = 0.65;
    this.targetVisibility = 12.0;
    this.targetLaneOffset = 0.0;
    
    this.collisionState = "CLEAR";
    this.radarData = null;
    this.roadTextureOffset = 0.0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 420;
    const h = rect.height > 200 ? rect.height : 280;
    this.canvas.width = Math.floor(w * (window.devicePixelRatio > 1 ? 1.5 : 1));
    this.canvas.height = Math.floor(h * (window.devicePixelRatio > 1 ? 1.5 : 1));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  update(bermData, fogDensity, visibilityM, collisionState, radarData) {
    if (bermData) {
      this.targetBermLeft = bermData.left_dist_m || 4.2;
      this.targetBermRight = bermData.right_dist_m || 4.1;
      this.targetLaneOffset = bermData.lane_offset_m || 0.0;
    }
    this.targetFogDensity = fogDensity !== undefined ? fogDensity : 0.65;
    this.targetVisibility = visibilityM !== undefined ? visibilityM : 12.0;
    this.collisionState = collisionState || "CLEAR";
    this.radarData = radarData;
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Smooth Lerp transitions (15% per frame)
    this.currentBermLeft += (this.targetBermLeft - this.currentBermLeft) * 0.15;
    this.currentBermRight += (this.targetBermRight - this.currentBermRight) * 0.15;
    this.currentFogDensity += (this.targetFogDensity - this.currentFogDensity) * 0.1;
    this.currentVisibility += (this.targetVisibility - this.currentVisibility) * 0.1;
    this.currentLaneOffset += (this.targetLaneOffset - this.currentLaneOffset) * 0.15;

    // Road animation motion
    this.roadTextureOffset = (this.roadTextureOffset + 0.02) % 1.0;

    // 1. Clear background & draw dark fog gradient
    ctx.clearRect(0, 0, w, h);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, "#080d1a");
    bgGrad.addColorStop(0.5, "#0d1527");
    bgGrad.addColorStop(1, "#070b14");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Synthetic 3D Perspective Road Geometry
    const vpX = w / 2 + this.currentLaneOffset * (w * 0.04);
    const vpY = h * 0.38;

    const btmLeftX = w * 0.12 - (4.0 - this.currentBermLeft) * (w * 0.05);
    const btmRightX = w * 0.88 + (4.0 - this.currentBermRight) * (w * 0.05);
    const btmY = h;

    const topWidth = w * 0.18;
    const topLeftX = vpX - topWidth / 2;
    const topRightX = vpX + topWidth / 2;

    // Haul Road Surface Polygon
    ctx.beginPath();
    ctx.moveTo(topLeftX, vpY);
    ctx.lineTo(topRightX, vpY);
    ctx.lineTo(btmRightX, btmY);
    ctx.lineTo(btmLeftX, btmY);
    ctx.closePath();

    const roadGrad = ctx.createLinearGradient(0, vpY, 0, btmY);
    roadGrad.addColorStop(0, "rgba(15, 23, 42, 0.95)");
    roadGrad.addColorStop(1, "rgba(30, 41, 59, 0.98)");
    ctx.fillStyle = roadGrad;
    ctx.fill();

    // 3. Virtual AR Center Trajectory Dashed Line
    ctx.save();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = -this.roadTextureOffset * 22;
    ctx.beginPath();
    ctx.moveTo(vpX, vpY);
    ctx.lineTo(w / 2, btmY);
    ctx.stroke();
    ctx.restore();

    // 4. Berm Safety Walls (Left & Right AR Guide Rails)
    const leftBermCritical = this.currentBermLeft < 1.2;
    const rightBermCritical = this.currentBermRight < 1.2;

    // Left Berm Line
    ctx.beginPath();
    ctx.moveTo(topLeftX, vpY);
    ctx.lineTo(btmLeftX, btmY);
    ctx.strokeStyle = leftBermCritical ? "#ef4444" : "#10b981";
    ctx.lineWidth = leftBermCritical ? 4 : 2.5;
    ctx.shadowColor = leftBermCritical ? "#ef4444" : "#10b981";
    ctx.shadowBlur = leftBermCritical ? 15 : 6;
    ctx.stroke();

    // Right Berm Line
    ctx.beginPath();
    ctx.moveTo(topRightX, vpY);
    ctx.lineTo(btmRightX, btmY);
    ctx.strokeStyle = rightBermCritical ? "#ef4444" : "#10b981";
    ctx.lineWidth = rightBermCritical ? 4 : 2.5;
    ctx.shadowColor = rightBermCritical ? "#ef4444" : "#10b981";
    ctx.shadowBlur = rightBermCritical ? 15 : 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 5. Dynamic AR Obstacle Box in Fog (if target in front)
    if (this.radarData && this.radarData.target_detected && this.radarData.distance_m < 35.0) {
      const d = Math.max(2.0, Math.min(35.0, this.radarData.distance_m));
      const depthFactor = 1.0 - (d / 35.0); // 0 (far) to 1 (near)

      const boxY = vpY + (btmY - vpY) * (depthFactor * 0.85);
      const boxW = Math.max(30, 110 * depthFactor);
      const boxH = Math.max(25, 80 * depthFactor);
      const boxX = vpX - boxW / 2;

      ctx.save();
      const boxColor = d < 8.0 ? "#ef4444" : "#f59e0b";
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(boxX, boxY - boxH, boxW, boxH);

      ctx.fillStyle = `${boxColor}33`;
      ctx.fillRect(boxX, boxY - boxH, boxW, boxH);

      ctx.fillStyle = boxColor;
      ctx.font = `bold ${Math.round(11 * (w / 420))}px 'JetBrains Mono', monospace`;
      ctx.fillText(`⚠️ OBSTACLE ${d.toFixed(1)}m`, boxX, boxY - boxH - 6);
      ctx.restore();
    }

    // 6. Synthetic Fog Overlay Layer
    const fogAlpha = Math.min(0.75, Math.max(0.2, this.currentFogDensity * 0.65));
    ctx.fillStyle = `rgba(15, 23, 42, ${fogAlpha})`;
    ctx.fillRect(0, 0, w, h);

    // 7. HUD Telemetry Overlay Text
    ctx.fillStyle = "#38bdf8";
    ctx.font = `bold ${Math.round(10 * (w / 420))}px 'JetBrains Mono', monospace`;
    ctx.fillText(`BERM L: ${this.currentBermLeft.toFixed(1)}m`, 14, h - 14);
    ctx.fillText(`BERM R: ${this.currentBermRight.toFixed(1)}m`, w - 105, h - 14);
    ctx.fillText(`AR VISIBILITY: ${this.currentVisibility.toFixed(1)}m`, 14, 22);
  }
}

window.ARLaneHUDRenderer = ARLaneHUDRenderer;
