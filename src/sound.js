// Tiny synthesized sound set — no audio files to ship.
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', gain = 0.12, when = 0) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function knock(freq, dur, gain, when = 0) {
  const c = ac();
  const t = c.currentTime + when;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  enabled: true,
  play(name) {
    if (!this.enabled) return;
    try {
      this[name]?.();
    } catch {
      /* audio unavailable */
    }
  },
  move() { knock(1600, 0.06, 1.1); },
  capture() { knock(700, 0.1, 1.6); tone(160, 0.09, 'triangle', 0.18); },
  castle() { knock(1500, 0.05, 1); knock(1300, 0.05, 1, 0.08); },
  check() { tone(880, 0.1, 'square', 0.04); tone(1320, 0.18, 'sine', 0.08, 0.06); },
  promote() { [660, 880, 1100].forEach((f, i) => tone(f, 0.12, 'sine', 0.08, i * 0.05)); },
  illegal() { tone(150, 0.12, 'sawtooth', 0.04); },
  start() { tone(523, 0.12, 'sine', 0.08); tone(784, 0.2, 'sine', 0.08, 0.08); },
  end() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'triangle', 0.06, i * 0.07)); },
  hint() { tone(1046, 0.15, 'sine', 0.06); tone(1568, 0.2, 'sine', 0.05, 0.07); },
};
