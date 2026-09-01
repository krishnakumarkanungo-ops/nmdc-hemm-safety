/**
 * 32x24 Thermal Infrared Vision Heatmap Stream Canvas
 * Smooth bilinear interpolation from 32x24 raw temperature matrix up to high-resolution canvas.
 * Implements professional Ironbow, Jet (Rainbow), and White-Hot palettes with target detection reticles.
 */

class ThermalVisionRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.palette = "IRONBOW"; // "IRONBOW", "JET", "WHITE_HOT"
    this.currentMatrix = null;
    this.minTemp = 20.0;
    this.maxTemp = 40.0;
    this.hotspotData = null;
    
    // Precomputed colormap lookup tables (256 entries each)
    this.lutIronbow = this._buildIronbowLUT();
    this.lutJet = this._buildJetLUT();
    this.lutWhiteHot = this._buildWhiteHotLUT();

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

  setPalette(paletteName) {
    this.palette = paletteName.toUpperCase();
    this.render();
  }

  _buildIronbowLUT() {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r = 0, g = 0, b = 0;
      if (t < 0.2) {
        // Black to Deep Purple
        r = Math.floor(t * 5 * 80);
        g = 0;
        b = Math.floor(t * 5 * 140);
      } else if (t < 0.45) {
        // Deep Purple to Crimson
        const f = (t - 0.2) / 0.25;
        r = Math.floor(80 + f * 140);
        g = Math.floor(f * 20);
        b = Math.floor(140 - f * 100);
      } else if (t < 0.7) {
        // Crimson to Bright Orange
        const f = (t - 0.45) / 0.25;
        r = Math.floor(220 + f * 35);
        g = Math.floor(20 + f * 130);
        b = 20;
      } else if (t < 0.9) {
        // Orange to Yellow
        const f = (t - 0.7) / 0.2;
        r = 255;
        g = Math.floor(150 + f * 95);
        b = Math.floor(f * 80);
      } else {
        // Yellow to White
        const f = (t - 0.9) / 0.1;
        r = 255;
        g = 245 + Math.floor(f * 10);
        b = Math.floor(80 + f * 175);
      }
      lut[i * 3 + 0] = Math.min(255, r);
      lut[i * 3 + 1] = Math.min(255, g);
      lut[i * 3 + 2] = Math.min(255, b);
    }
    return lut;
  }

  _buildJetLUT() {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const x = i / 255 * 4;
      const r = Math.max(0, Math.min(255, Math.floor(255 * (1.5 - Math.abs(x - 3)))));
      const g = Math.max(0, Math.min(255, Math.floor(255 * (1.5 - Math.abs(x - 2)))));
      const b = Math.max(0, Math.min(255, Math.floor(255 * (1.5 - Math.abs(x - 1)))));
      lut[i * 3 + 0] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    return lut;
  }

  _buildWhiteHotLUT() {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      lut[i * 3 + 0] = i;
      lut[i * 3 + 1] = i;
      lut[i * 3 + 2] = i;
    }
    return lut;
  }

  update(matrix, minT, maxT, hotspotInfo) {
    if (!matrix || matrix.length === 0) return;
    this.currentMatrix = matrix;
    this.minTemp = minT !== undefined ? minT : 20.0;
    this.maxTemp = maxT !== undefined ? Math.max(minT + 2.0, maxT) : 40.0;
    this.hotspotData = hotspotInfo;
    this.render();
  }

  render() {
    if (!this.ctx || !this.canvas || !this.currentMatrix) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const srcRows = this.currentMatrix.length;    // 24
    const srcCols = this.currentMatrix[0].length; // 32

    // 1. Create pixel buffer for high-res bilinear interpolation
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const lut = this.palette === "JET" ? this.lutJet : (this.palette === "WHITE_HOT" ? this.lutWhiteHot : this.lutIronbow);

    const tempRange = Math.max(1.0, this.maxTemp - this.minTemp);

    for (let y = 0; y < h; y++) {
      // Map canvas y to source row coordinates
      const srcY = (y / h) * (srcRows - 1);
      const y0 = Math.floor(srcY);
      const y1 = Math.min(srcRows - 1, y0 + 1);
      const dy = srcY - y0;

      for (let x = 0; x < w; x++) {
        // Map canvas x to source col coordinates
        const srcX = (x / w) * (srcCols - 1);
        const x0 = Math.floor(srcX);
        const x1 = Math.min(srcCols - 1, x0 + 1);
        const dx = srcX - x0;

        // Bilinear interpolation of temperature value
        const v00 = this.currentMatrix[y0][x0];
        const v10 = this.currentMatrix[y0][x1];
        const v01 = this.currentMatrix[y1][x0];
        const v11 = this.currentMatrix[y1][x1];

        const top = v00 + dx * (v10 - v00);
        const btm = v01 + dx * (v11 - v01);
        const temp = top + dy * (btm - top);

        // Normalize to 0 - 255 LUT index
        const norm = Math.max(0.0, Math.min(1.0, (temp - this.minTemp) / tempRange));
        const lutIdx = Math.floor(norm * 255);

        const pIdx = (y * w + x) * 4;
        data[pIdx + 0] = lut[lutIdx * 3 + 0];
        data[pIdx + 1] = lut[lutIdx * 3 + 1];
        data[pIdx + 2] = lut[lutIdx * 3 + 2];
        data[pIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // 2. Draw HUD Center Reticle
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;

    // Center Crosshair
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx, cy + 14);
    ctx.stroke();

    // Center Temp Tag
    const centerT = this.currentMatrix[12] ? this.currentMatrix[12][16] : 24.0;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(11 * (w / 420))}px 'JetBrains Mono', monospace`;
    ctx.fillText(`${centerT.toFixed(1)}°C [CTR]`, cx + 8, cy - 8);

    // 3. Draw Detected Thermal Hotspot / Target Bounding Box
    if (this.hotspotData && this.hotspotData.detected && this.hotspotData.gx !== null && this.hotspotData.gy !== null) {
      const hx = (this.hotspotData.gx / (srcCols - 1)) * w;
      const hy = (this.hotspotData.gy / (srcRows - 1)) * h;
      const boxW = Math.max(45, Math.round(50 * (w / 420)));
      const boxH = Math.max(45, Math.round(60 * (h / 280)));

      ctx.save();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 10;

      // Draw corner brackets
      const cs = 10;
      const bx = hx - boxW / 2;
      const by = hy - boxH / 2;

      ctx.strokeRect(bx, by, boxW, boxH);

      // Target Label
      ctx.fillStyle = "#ef4444";
      ctx.font = `bold ${Math.round(10 * (w / 420))}px 'JetBrains Mono', monospace`;
      const label = this.hotspotData.label || "HOTSPOT DETECTED";
      const tempStr = this.hotspotData.temp ? `${this.hotspotData.temp.toFixed(1)}°C` : "";
      ctx.fillText(`⚠️ ${label} ${tempStr}`, bx, by - 6);

      ctx.restore();
    }

    // 4. Draw Colormap Scale Bar (Right Edge)
    const barW = 12;
    const barH = h - 40;
    const barX = w - 24;
    const barY = 20;

    for (let i = 0; i < barH; i++) {
      const t = 1.0 - (i / barH);
      const lutIdx = Math.floor(t * 255);
      ctx.fillStyle = `rgb(${lut[lutIdx * 3 + 0]}, ${lut[lutIdx * 3 + 1]}, ${lut[lutIdx * 3 + 2]})`;
      ctx.fillRect(barX, barY + i, barW, 1);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.strokeRect(barX, barY, barW, barH);

    // Min / Max Text
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(9 * (w / 420))}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "right";
    ctx.fillText(`${this.maxTemp.toFixed(0)}°C`, barX - 4, barY + 10);
    ctx.fillText(`${this.minTemp.toFixed(0)}°C`, barX - 4, barY + barH);
    ctx.textAlign = "left";
  }
}

window.ThermalVisionRenderer = ThermalVisionRenderer;
