// audio.js — every sound in Port Marisol is synthesized with WebAudio at
// runtime: engine hum, police siren, gunshots, punches, cash blips, mission
// jingles and a lazy beach-bar music loop. No audio files are shipped.
// The context is created lazily on the first user gesture (browser policy);
// every call is safe before that and simply stays silent.
window.PM = window.PM || {};

PM.Audio = {
  ctx: null,
  master: null,
  engineNodes: null,
  sirenNodes: null,
  musicTimer: null,
  musicStep: 0,

  /** Create the context on first gesture; returns false while unavailable. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startMusic();
      return true;
    } catch (err) {
      return false;
    }
  },

  /** One oscillator blip with an envelope — the atom of most effects. */
  blip(freqFrom, freqTo, seconds, type, volume) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + seconds);
    gain.gain.setValueAtTime(volume || 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  },

  /** A filtered noise burst (gunshot, splash, crash). */
  noise(seconds, volume, filterFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  },

  shoot() { this.noise(0.14, 0.5, 2600); this.blip(160, 40, 0.1, 'sawtooth', 0.2); },
  punch() { this.noise(0.08, 0.35, 500); this.blip(110, 50, 0.09, 'sine', 0.3); },
  crash() { this.noise(0.3, 0.45, 700); },
  cash() { this.blip(880, 880, 0.07, 'square', 0.12); setTimeout(() => this.blip(1320, 1320, 0.12, 'square', 0.12), 70); },
  door() { this.blip(220, 140, 0.09, 'triangle', 0.2); },
  splash() { this.noise(0.4, 0.25, 900); },

  /** Short rising arpeggio when a mission is completed. */
  missionJingle() {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => setTimeout(() => this.blip(freq, freq, 0.22, 'triangle', 0.18), i * 110));
  },

  /** Sad two-note fall for busted / wasted. */
  failJingle() {
    if (!this.ctx) return;
    this.blip(392, 392, 0.3, 'triangle', 0.18);
    setTimeout(() => this.blip(262, 196, 0.55, 'triangle', 0.18), 260);
  },

  /** Start the car engine loop; call setEngine(rpm01, load01) per frame. */
  startEngine() {
    if (!this.ctx || this.engineNodes) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.engineNodes = { osc, filter, gain };
  },

  setEngine(rpm01, load01) {
    if (!this.engineNodes) return;
    const t = this.ctx.currentTime;
    this.engineNodes.osc.frequency.setTargetAtTime(50 + rpm01 * 130, t, 0.06);
    this.engineNodes.filter.frequency.setTargetAtTime(280 + load01 * 700, t, 0.08);
    this.engineNodes.gain.gain.setTargetAtTime(0.05 + load01 * 0.06, t, 0.09);
  },

  stopEngine() {
    if (!this.engineNodes) return;
    try { this.engineNodes.osc.stop(); } catch (err) { /* already stopped */ }
    this.engineNodes = null;
  },

  /** Two-tone police siren loop, on while any police car is near & active. */
  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 700;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.7;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 160;
      lfo.connect(lfoGain).connect(osc.frequency);
      const gain = this.ctx.createGain();
      gain.gain.value = 0.035;
      osc.connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.sirenNodes = { osc, lfo, gain };
    } else if (!on && this.sirenNodes) {
      try { this.sirenNodes.osc.stop(); this.sirenNodes.lfo.stop(); } catch (err) { /* noop */ }
      this.sirenNodes = null;
    }
  },

  /** A slow I–vi–IV–V beach-bar loop: soft bass + pad chords, very quiet. */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bassLine = [65.4, 65.4, 55, 55, 49, 49, 58.3, 58.3]; // C2 C2 A1 A1 G1 G1 Bb1 Bb1
    this.musicTimer = setInterval(() => {
      if (!this.ctx) return;
      const step = this.musicStep % bassLine.length;
      this.musicStep += 1;
      const freq = bassLine[step];
      this.blip(freq, freq, 0.9, 'sine', 0.05);
      if (step % 2 === 0) {
        this.blip(freq * 4, freq * 4, 1.6, 'triangle', 0.016);
        this.blip(freq * 5, freq * 5, 1.6, 'triangle', 0.012);
      }
    }, 920);
  },
};
