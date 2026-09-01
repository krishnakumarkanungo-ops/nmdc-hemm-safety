/**
 * Web Audio API In-Cab Alarm Synthesizer (Rock-Solid & Non-Blocking)
 * Generates authentic industrial buzzer & sonar collision warning tones in real-time.
 */

class CabAudioAlarm {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.volume = 0.65;
    this.currentState = "CLEAR";
    this.pulseInterval = null;
    this.isUnlocked = false;
  }

  initContext() {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          this.isUnlocked = true;
        }
      } else if (this.ctx.state === "suspended") {
        this.ctx.resume();
        this.isUnlocked = true;
      }
    } catch (e) {}
  }

  setMute(mute) {
    this.isMuted = mute;
    this.stopAllTones();
    if (!this.isMuted && this.currentState !== "CLEAR") {
      this.updateState(this.currentState, true);
    }
  }

  stopAllTones() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
  }

  playBeep(freq, durationMs, type = "square") {
    if (this.isMuted || !this.ctx || this.ctx.state !== "running") return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      const durSec = durationMs / 1000.0;
      gain.gain.setValueAtTime(this.volume * 0.35, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + durSec);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + durSec);
    } catch (e) {}
  }

  startCriticalAlarm() {
    this.stopAllTones();
    if (this.isMuted || !this.ctx || this.ctx.state !== "running") return;

    let alt = false;
    this.playBeep(1250, 100, "square");
    this.pulseInterval = setInterval(() => {
      const freq = alt ? 1350 : 950;
      this.playBeep(freq, 100, "square");
      alt = !alt;
    }, 180);
  }

  startAdvisoryAlarm() {
    this.stopAllTones();
    if (this.isMuted || !this.ctx || this.ctx.state !== "running") return;

    this.playBeep(650, 140, "sine");
    this.pulseInterval = setInterval(() => {
      this.playBeep(650, 140, "sine");
    }, 900);
  }

  updateState(state, force = false) {
    if (state === this.currentState && !force) return;
    this.currentState = state;

    this.stopAllTones();

    if (this.isMuted || !this.isUnlocked || !this.ctx) return;

    if (state === "CRITICAL") {
      this.startCriticalAlarm();
    } else if (state === "ADVISORY") {
      this.startAdvisoryAlarm();
    }
  }
}

window.cabAudio = new CabAudioAlarm();
