// Synthesised sound: everything is generated with WebAudio, no audio files.
// The pickup blip is also the Sun Stash collect cue — one sound, two uses.
export function createAudio() {
  let ctx = null, master = null, muted = false;
  let engineOsc = null, engineGain = null, engineFilter = null;
  let sirenOsc = null, sirenGain = null, sirenLfo = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch { return false; }
    return true;
  }
  function resume() { if (ensure() && ctx.state === 'suspended') ctx.resume(); }
  function now() { return ctx ? ctx.currentTime : 0; }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ensure() || muted) return;
    const t = now();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, filterFreq) {
    if (!ensure() || muted) return;
    const t = now();
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }

  return {
    unlock() { resume(); },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
    get muted() { return muted; },
    click() { blip(660, 0.07, 'square', 0.08); },
    punch() { noise(0.12, 0.35, 500); blip(120, 0.1, 'sine', 0.25, 60); },
    gunshot() { noise(0.16, 0.5, 2600); blip(180, 0.08, 'square', 0.2, 50); },
    reload() { blip(500, 0.05, 'square', 0.1); setTimeout(() => blip(700, 0.05, 'square', 0.1), 90); },
    pickup() { blip(880, 0.09, 'sine', 0.18); setTimeout(() => blip(1320, 0.14, 'sine', 0.18), 90); },
    cash() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.2), i * 90)); },
    missionStart() { [392, 523, 659].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'triangle', 0.2), i * 110)); },
    missionDone() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.22), i * 110)); },
    fail() { [330, 262, 196].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'sawtooth', 0.14), i * 140)); },
    doorSlam() { noise(0.1, 0.3, 400); blip(90, 0.12, 'sine', 0.25, 45); },
    crash() { noise(0.25, 0.4, 700); },
    engineStart() { blip(70, 0.3, 'sawtooth', 0.15, 140); },
    engine(speed01, on) {
      if (!ensure() || muted) { this.engineStop(); return; }
      resume();
      if (!on) { this.engineStop(); return; }
      if (!engineOsc) {
        engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
        engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 500;
        engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
        engineOsc.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(master);
        engineOsc.start();
      }
      const t = now();
      engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, t, 0.08);
      engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.06, t, 0.1);
      engineFilter.frequency.setTargetAtTime(350 + speed01 * 900, t, 0.1);
    },
    engineStop() {
      if (engineOsc) { try { engineOsc.stop(); } catch {} engineOsc = null; engineGain = null; engineFilter = null; }
    },
    siren(on) {
      if (!ensure()) return;
      if (!on) {
        if (sirenOsc) { try { sirenOsc.stop(); sirenLfo.stop(); } catch {} sirenOsc = null; sirenGain = null; }
        return;
      }
      if (sirenOsc || muted) return;
      resume();
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle'; sirenOsc.frequency.value = 800;
      sirenLfo = ctx.createOscillator(); sirenLfo.type = 'sine'; sirenLfo.frequency.value = 0.55;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 320;
      sirenLfo.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0.045;
      sirenOsc.connect(sirenGain); sirenGain.connect(master);
      sirenOsc.start(); sirenLfo.start();
    },
  };
}
