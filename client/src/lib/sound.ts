// Sounds are synthesized with Web Audio, so there are no audio files to ship.

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean) {
  muted = value;
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  audio();
}

export function playMove(capture = false) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(capture ? 300 : 520, t);
  osc.frequency.exponentialRampToValueAtTime(capture ? 120 : 260, t + 0.08);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(capture ? 0.35 : 0.22, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.13);
}

export function playExplosion() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const duration = 1.6;

  // Rumbling noise: white noise through a lowpass filter that closes over time.
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * duration), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, t);
  filter.frequency.exponentialRampToValueAtTime(90, t + duration);
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(0.0001, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  noise.connect(filter).connect(noiseGain).connect(ac.destination);

  // Low thump for body.
  const thump = ac.createOscillator();
  const thumpGain = ac.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(110, t);
  thump.frequency.exponentialRampToValueAtTime(32, t + 0.5);
  thumpGain.gain.setValueAtTime(0.0001, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  thump.connect(thumpGain).connect(ac.destination);

  noise.start(t);
  noise.stop(t + duration);
  thump.start(t);
  thump.stop(t + 0.65);
}
