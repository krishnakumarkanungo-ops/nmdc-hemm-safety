/**
 * Raspberry Pi Camera Module 3 Wide (120° FOV) AI Vision Stream Renderer
 * Renders optical camera perspective with YOLOv8-Nano AI bounding box overlays
 * Safe against canvas matrix scaling overflow (no black screen crashes)
 */

class CameraVisionRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.frame = 0;
    this.roadOffset = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 420;
    this.height = rect.height || 280;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Always reset matrix before scaling
    this.ctx.scale(dpr, dpr);
  }

  render(packet) {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    this.frame++;

    const speed = (packet && packet.speed_kmh !== undefined) ? packet.speed_kmh : 16.0;
    this.roadOffset = (this.roadOffset + Math.max(0.8, speed * 0.35)) % 40;

    // 1. Pit Sky Gradient
    const gradSky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    gradSky.addColorStop(0, "#080e1a");
    gradSky.addColorStop(1, "#142236");
    ctx.fillStyle = gradSky;
    ctx.fillRect(0, 0, w, h * 0.45);

    // Pit Mountain Terraces (Bailadila Deposit 14 Open-Cast Benches)
    ctx.fillStyle = "#1b2330";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.43);
    ctx.lineTo(w * 0.22, h * 0.36);
    ctx.lineTo(w * 0.50, h * 0.39);
    ctx.lineTo(w * 0.78, h * 0.33);
    ctx.lineTo(w, h * 0.41);
    ctx.lineTo(w, h * 0.45);
    ctx.lineTo(0, h * 0.45);
    ctx.closePath();
    ctx.fill();

    // Haul Road Ground Gradient (Iron Ore Terracotta / Pit Brown)
    const gradRoad = ctx.createLinearGradient(0, h * 0.45, 0, h);
    gradRoad.addColorStop(0, "#221c1a");
    gradRoad.addColorStop(0.5, "#2b221d");
    gradRoad.addColorStop(1, "#181412");
    ctx.fillStyle = gradRoad;
    ctx.fillRect(0, h * 0.45, w, h * 0.55);

    // Vanishing Point
    const vpX = w * 0.5;
    const vpY = h * 0.44;

    // Safety Berm Edges (Left & Right Berm Guidelines)
    ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -this.roadOffset;

    // Left Berm Line
    ctx.beginPath();
    ctx.moveTo(vpX - 22, vpY);
    ctx.lineTo(w * 0.06, h);
    ctx.stroke();

    // Right Berm Line
    ctx.beginPath();
    ctx.moveTo(vpX + 22, vpY);
    ctx.lineTo(w * 0.94, h);
    ctx.stroke();

    // Centerline (Emerald dashed moving forward)
    ctx.strokeStyle = "rgba(16, 185, 129, 0.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 14]);
    ctx.lineDashOffset = -this.roadOffset * 1.5;
    ctx.beginPath();
    ctx.moveTo(vpX, vpY);
    ctx.lineTo(vpX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Simulated Fog Density Layer
    const fogDensity = (packet && packet.fog_density !== undefined) ? packet.fog_density : 0.6;
    if (fogDensity > 0.15) {
      ctx.fillStyle = `rgba(180, 195, 210, ${Math.min(0.58, fogDensity * 0.65)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 3. Optical AI Bounding Boxes (YOLOv8-Nano)
    const collisionState = (packet && packet.collision_state) || "CLEAR";
    const primaryHazard = (packet && packet.active_hazard) || "NONE";

    // Target calculation
    let nearestDist = 24.0;
    if (packet && packet.radar && packet.radar.distance_m < 90) {
      nearestDist = packet.radar.distance_m;
    } else if (primaryHazard !== "NONE") {
      nearestDist = (packet && packet.radar && packet.radar.distance_m) || 8.0;
    } else {
      // In normal demo hauling mode, show a lead truck ahead
      nearestDist = 22.0 + Math.sin(this.frame * 0.02) * 4.0;
    }

    const boxScale = Math.max(0.35, Math.min(1.3, 38 / (nearestDist + 6)));
    const targetW = 145 * boxScale;
    const targetH = 112 * boxScale;
    const targetX = vpX - targetW / 2 + Math.sin(this.frame * 0.035) * 8;
    const targetY = vpY + (h - vpY) * (1 - Math.min(1, nearestDist / 55)) - targetH;

    let boxColor = "#10b981"; // Emerald for clear
    let stateLabel = "HEMM DEMO TRUCK";
    if (collisionState === "CRITICAL") {
      boxColor = "#ef4444";
      stateLabel = "🚨 CRITICAL COLLISION HAZARD";
    } else if (collisionState === "ADVISORY") {
      boxColor = "#f59e0b";
      stateLabel = "⚠️ PROXIMITY ADVISORY";
    }

    // Hazard-specific labels
    if (primaryHazard === "MINER_IN_FOG") {
      stateLabel = "👷 MINE WORKER (PPE)";
      boxColor = "#ef4444";
    } else if (primaryHazard === "LV_BLINDSPOT") {
      stateLabel = "🚙 LIGHT VEHICLE (BOLERO)";
      boxColor = "#f59e0b";
    } else if (primaryHazard.includes("BERM")) {
      stateLabel = "⚠️ BERM EMBANKMENT";
      boxColor = "#ef4444";
    }

    // Draw Main Bounding Box
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(targetX, targetY, targetW, targetH);

    // Corner Accents (High-tech bracket style)
    const cornerLen = Math.min(18, targetW * 0.22);
    ctx.lineWidth = 3.5;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(targetX, targetY + cornerLen);
    ctx.lineTo(targetX, targetY);
    ctx.lineTo(targetX + cornerLen, targetY);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(targetX + targetW - cornerLen, targetY);
    ctx.lineTo(targetX + targetW, targetY);
    ctx.lineTo(targetX + targetW, targetY + cornerLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(targetX, targetY + targetH - cornerLen);
    ctx.lineTo(targetX, targetY + targetH);
    ctx.lineTo(targetX + cornerLen, targetY + targetH);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(targetX + targetW - cornerLen, targetY + targetH);
    ctx.lineTo(targetX + targetW, targetY + targetH);
    ctx.lineTo(targetX + targetW, targetY + targetH - cornerLen);
    ctx.stroke();

    // AI Classification Tag Header
    ctx.fillStyle = boxColor;
    const tagText = `${stateLabel} [${Math.round(nearestDist)}m]`;
    ctx.font = "bold 10px monospace";
    const tagW = ctx.measureText(tagText).width + 8;
    ctx.fillRect(targetX, Math.max(0, targetY - 18), tagW, 18);
    ctx.fillStyle = "#090d16";
    ctx.fillText(tagText, targetX + 4, Math.max(12, targetY - 5));

    // Distance & AI Confidence Footnote
    ctx.fillStyle = "rgba(9, 13, 22, 0.88)";
    ctx.fillRect(targetX, targetY + targetH, targetW, 14);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "9px monospace";
    const conf = (96.5 + Math.sin(this.frame * 0.05) * 2.5).toFixed(1);
    ctx.fillText(`CONF: ${conf}% | ${nearestDist.toFixed(1)}m`, targetX + 4, targetY + targetH + 10);

    // 4. Center Targeting Crosshairs
    ctx.strokeStyle = "rgba(6, 182, 212, 0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.58, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 22, h * 0.58);
    ctx.lineTo(w / 2 - 6, h * 0.58);
    ctx.moveTo(w / 2 + 6, h * 0.58);
    ctx.lineTo(w / 2 + 22, h * 0.58);
    ctx.moveTo(w / 2, h * 0.58 - 22);
    ctx.lineTo(w / 2, h * 0.58 - 6);
    ctx.moveTo(w / 2, h * 0.58 + 6);
    ctx.lineTo(w / 2, h * 0.58 + 22);
    ctx.stroke();

    // 5. Optical Lens Telemetry Overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(6, 6, 175, 18);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 9px monospace";
    ctx.fillText(`📷 PI CAM 3 WIDE | 30 FPS`, 10, 19);

    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(w - 145, 6, 140, 18);
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 9px monospace";
    ctx.fillText(`YOLOv8-NANO: 11ms`, w - 138, 19);
  }
}

window.CameraVisionRenderer = CameraVisionRenderer;
