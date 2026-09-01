/**
 * Web Audio API In-Cab Alarm Synthesizer
 * Generates authentic industrial buzzer & sonar collision warning tones in real-time.
 */

class CabAudioAlarm {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.volume = 0.75;
    this.currentState = "CLEAR";
    this.activeOscillators = [];
    this.pulseInterval = null;
    this.isUnlocked = false;
  }

  initContext() {
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
  }

  setMute(mute) {
    this.isMuted = mute;
    if (this.isMuted) {
      this.stopAllTones();
    } else {
      this.updateState(this.currentState, true);
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(1.0, vol));
  }

  stopAllTones() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    this.activeOscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
    this.activeOscillators = [];
  }

  playBeep(freq, durationMs, type = "sawtooth") {
    if (this.isMuted || !this.ctx || this.ctx.state !== "running") return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(this.volume * 0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (durationMs / 1000));

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + (durationMs / 1000));
    } catch (e) {
      console.warn("Audio playback error:", e);
    }
  }

  startCriticalAlarm() {
    this.stopAllTones();
    if (this.isMuted || !this.ctx) return;

    // Rapid pulsing dual-tone warble (1100Hz / 1650Hz at 7 Hz pulse rate)
    let alt = false;
    this.pulseInterval = setInterval(() => {
      const freq = alt ? 1400 : 950;
      this.playBeep(freq, 110, "square");
      alt = !alt;
    }, 130);
  }

  startAdvisoryAlarm() {
    this.stopAllTones();
    if (this.isMuted || !this.ctx) return;

    // Sonar caution ping (650 Hz every 750ms)
    this.playBeep(650, 160, "sine");
    this.pulseInterval = setInterval(() => {
      this.playBeep(650, 160, "sine");
    }, 750);
  }

  updateState(state, force = false) {
    if (state === this.currentState && !force) return;
    this.currentState = state;

    if (this.isMuted || !this.isUnlocked) return;

    if (state === "CRITICAL") {
      this.startCriticalAlarm();
    } else if (state === "ADVISORY") {
      this.startAdvisoryAlarm();
    } else {
      this.stopAllTones();
    }
  }
}

window.cabAudio = new CabAudioAlarm();
