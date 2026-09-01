/**
 * 32x24 Thermal Infrared Vision Heatmap Stream Canvas (Guaranteed Visuals)
 * GPU-upscaled infrared colormap rendering with instant baseline display.
 */

class ThermalVisionRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.palette = "IRONBOW";
    this.currentMatrix = null;
    this.minTemp = 20.0;
    this.maxTemp = 40.0;
    this.hotspotData = null;
    
    // Offscreen 32x24 buffer
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = 32;
    this.offscreenCanvas.height = 24;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    this.offscreenImgData = this.offscreenCtx.createImageData(32, 24);

    // Precomputed colormaps
    this.lutIronbow = this._buildIronbowLUT();
    this.lutJet = this._buildJetLUT();
    this.lutWhiteHot = this._buildWhiteHotLUT();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    const w = Math.max(280, Math.floor((rect && rect.width > 50) ? rect.width : (parent ? parent.clientWidth : 380) || 380));
    const h = Math.max(220, Math.floor((rect && rect.height > 50) ? rect.height : (parent ? parent.clientHeight : 270) || 270));
    this.canvas.width = w;
    this.canvas.height = h;
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
        r = Math.floor(t * 5 * 80); g = 0; b = Math.floor(t * 5 * 140);
      } else if (t < 0.45) {
        const f = (t - 0.2) / 0.25;
        r = Math.floor(80 + f * 140); g = Math.floor(f * 20); b = Math.floor(140 - f * 100);
      } else if (t < 0.7) {
        const f = (t - 0.45) / 0.25;
        r = Math.floor(220 + f * 35); g = Math.floor(20 + f * 130); b = 20;
      } else if (t < 0.9) {
        const f = (t - 0.7) / 0.2;
        r = 255; g = Math.floor(150 + f * 90); b = Math.floor(20 + f * 80);
      } else {
        const f = (t - 0.9) / 0.1;
        r = 255; g = Math.floor(240 + f * 15); b = Math.floor(100 + f * 155);
      }
      lut[i * 3 + 0] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    return lut;
  }

  _buildJetLUT() {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r = Math.max(0, Math.min(1, 1.5 - Math.abs(t * 4 - 3))) * 255;
      let g = Math.max(0, Math.min(1, 1.5 - Math.abs(t * 4 - 2))) * 255;
      let b = Math.max(0, Math.min(1, 1.5 - Math.abs(t * 4 - 1))) * 255;
      lut[i * 3 + 0] = Math.floor(r);
      lut[i * 3 + 1] = Math.floor(g);
      lut[i * 3 + 2] = Math.floor(b);
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
    this.currentMatrix = matrix;
    if (minT !== undefined) this.minTemp = minT;
    if (maxT !== undefined) this.maxTemp = maxT;
    this.hotspotData = hotspotInfo || null;
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    if (this.canvas.width < 10) this.resize();

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Generate fallback baseline matrix if none exists
    let matrix = this.currentMatrix;
    if (!matrix || matrix.length === 0) {
      matrix = [];
      for (let r = 0; r < 24; r++) {
        const row = [];
        for (let c = 0; c < 32; c++) {
          row.push(22.0 + (r / 24.0) * 4.0);
        }
        matrix.push(row);
      }
    }

    const srcRows = matrix.length;
    const srcCols = matrix[0] ? matrix[0].length : 32;
    const tempRange = Math.max(1.0, this.maxTemp - this.minTemp);

    let lut = this.lutIronbow;
    if (this.palette === "JET") lut = this.lutJet;
    else if (this.palette === "WHITE_HOT") lut = this.lutWhiteHot;

    const data = this.offscreenImgData.data;
    let idx = 0;

    for (let y = 0; y < srcRows; y++) {
      const row = matrix[y] || [];
      for (let x = 0; x < srcCols; x++) {
        const val = row[x] !== undefined ? row[x] : 22.0;
        const norm = Math.max(0.0, Math.min(1.0, (val - this.minTemp) / tempRange));
        const lutIdx = Math.floor(norm * 255) * 3;

        data[idx + 0] = lut[lutIdx + 0];
        data[idx + 1] = lut[lutIdx + 1];
        data[idx + 2] = lut[lutIdx + 2];
        data[idx + 3] = 255;
        idx += 4;
      }
    }

    this.offscreenCtx.putImageData(this.offscreenImgData, 0, 0);

    // Hardware Bilinear Scaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.offscreenCanvas, 0, 0, w, h);

    // Reticle
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
    ctx.stroke();

    const centerT = (matrix[12] && matrix[12][16] !== undefined) ? matrix[12][16] : 24.0;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(11 * (w / 380))}px 'JetBrains Mono', monospace`;
    ctx.fillText(`${centerT.toFixed(1)}°C [CTR]`, cx + 8, cy - 8);

    // Hotspot bounding box
    if (this.hotspotData && this.hotspotData.detected && this.hotspotData.gx !== null && this.hotspotData.gy !== null) {
      const hx = (this.hotspotData.gx / (srcCols - 1)) * w;
      const hy = (this.hotspotData.gy / (srcRows - 1)) * h;
      const boxW = Math.max(45, Math.round(50 * (w / 380)));
      const boxH = Math.max(45, Math.round(60 * (h / 270)));

      ctx.save();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.strokeRect(hx - boxW / 2, hy - boxH / 2, boxW, boxH);

      ctx.fillStyle = "#ef4444";
      ctx.font = `bold ${Math.round(10 * (w / 380))}px 'JetBrains Mono', monospace`;
      const label = this.hotspotData.label || "HOTSPOT";
      const tempStr = this.hotspotData.temp ? `${this.hotspotData.temp.toFixed(1)}°C` : "";
      ctx.fillText(`⚠️ ${label} ${tempStr}`, hx - boxW / 2, hy - boxH / 2 - 6);
      ctx.restore();
    }

    // Colormap Bar
    const barW = 10;
    const barH = h - 40;
    const barX = w - 20;
    const barY = 20;

    for (let i = 0; i < barH; i += 2) {
      const t = 1.0 - (i / barH);
      const lutIdx = Math.floor(t * 255) * 3;
      ctx.fillStyle = `rgb(${lut[lutIdx + 0]}, ${lut[lutIdx + 1]}, ${lut[lutIdx + 2]})`;
      ctx.fillRect(barX, barY + i, barW, 2);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.strokeRect(barX, barY, barW, barH);
  }
}

window.ThermalVisionRenderer = ThermalVisionRenderer;
