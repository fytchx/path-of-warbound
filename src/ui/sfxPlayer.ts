import { sfxDefs } from '../data';

const COOLDOWNS = new Map<string, number>(sfxDefs.map((spec) => [spec.id, spec.cooldownMs]));

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
const lastPlayed = new Map<string, number>();

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) {
    ctx = new AudioCtor();
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  return ctx;
}

function getNoiseBuffer(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const length = Math.floor(ac.sampleRate * 0.4);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

function playTone(
  ac: AudioContext,
  opts: {
    type?: OscillatorType;
    freq: number;
    endFreq?: number;
    duration: number;
    gain: number;
    delay?: number;
  },
): void {
  const start = ac.currentTime + (opts.delay ?? 0);
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = opts.type ?? 'triangle';
  osc.frequency.setValueAtTime(Math.max(40, opts.freq), start);
  if (opts.endFreq && opts.endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.endFreq), start + opts.duration);
  }
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(opts.gain, start + Math.min(0.015, opts.duration * 0.25));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  osc.connect(amp);
  amp.connect(ac.destination);
  osc.start(start);
  osc.stop(start + opts.duration + 0.02);
}

function playFilteredNoise(
  ac: AudioContext,
  opts: {
    filterType: BiquadFilterType;
    freq: number;
    endFreq?: number;
    q?: number;
    duration: number;
    gain: number;
    delay?: number;
  },
): void {
  const start = ac.currentTime + (opts.delay ?? 0);
  const src = ac.createBufferSource();
  src.buffer = getNoiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.setValueAtTime(opts.freq, start);
  if (opts.endFreq) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.endFreq), start + opts.duration);
  }
  if (opts.q) filter.Q.value = opts.q;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(opts.gain, start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(ac.destination);
  src.start(start);
  src.stop(start + opts.duration + 0.02);
}

function playCue(key: string): void {
  const ac = ensureContext();
  if (!ac || ac.state !== 'running') return;

  switch (key) {
    case 'melee_slash':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 1800, endFreq: 420, q: 1.4, duration: 0.09, gain: 0.07 });
      playTone(ac, { type: 'triangle', freq: 260, endFreq: 110, duration: 0.08, gain: 0.05 });
      break;
    case 'melee_crit':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 2400, endFreq: 320, q: 1.2, duration: 0.14, gain: 0.09 });
      playTone(ac, { type: 'sawtooth', freq: 340, endFreq: 95, duration: 0.13, gain: 0.07 });
      playTone(ac, { type: 'sine', freq: 880, endFreq: 520, duration: 0.1, gain: 0.04, delay: 0.01 });
      break;
    case 'auto_shot':
      playFilteredNoise(ac, { filterType: 'highpass', freq: 1500, endFreq: 600, duration: 0.06, gain: 0.045 });
      playTone(ac, { type: 'sine', freq: 540, endFreq: 210, duration: 0.065, gain: 0.04 });
      break;
    case 'fireball_cast':
      playFilteredNoise(ac, { filterType: 'lowpass', freq: 420, endFreq: 1400, duration: 0.15, gain: 0.06 });
      break;
    case 'fireball_impact':
      playFilteredNoise(ac, { filterType: 'lowpass', freq: 950, endFreq: 140, duration: 0.18, gain: 0.09 });
      playTone(ac, { type: 'triangle', freq: 150, endFreq: 48, duration: 0.17, gain: 0.08 });
      break;
    case 'frost_cast':
      playTone(ac, { type: 'sine', freq: 980, endFreq: 1320, duration: 0.11, gain: 0.04 });
      break;
    case 'frost_impact':
      playFilteredNoise(ac, { filterType: 'highpass', freq: 2600, duration: 0.1, gain: 0.065 });
      playTone(ac, { type: 'sine', freq: 1420, endFreq: 640, duration: 0.12, gain: 0.045 });
      break;
    case 'lightning_cast':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 3200, q: 2.2, duration: 0.09, gain: 0.05 });
      break;
    case 'lightning_impact':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 2800, endFreq: 450, q: 1.5, duration: 0.13, gain: 0.08 });
      playTone(ac, { type: 'sawtooth', freq: 620, endFreq: 140, duration: 0.11, gain: 0.045 });
      break;
    case 'void_cast':
      playTone(ac, { type: 'sine', freq: 240, endFreq: 170, duration: 0.15, gain: 0.05 });
      break;
    case 'void_impact':
      playTone(ac, { type: 'triangle', freq: 190, endFreq: 65, duration: 0.16, gain: 0.07 });
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 650, endFreq: 240, q: 2, duration: 0.14, gain: 0.05 });
      break;
    case 'aoe_pulse':
      playTone(ac, { type: 'sine', freq: 135, endFreq: 45, duration: 0.2, gain: 0.085 });
      playFilteredNoise(ac, { filterType: 'lowpass', freq: 520, endFreq: 120, duration: 0.16, gain: 0.06 });
      break;
    case 'poison_tick':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 1900, endFreq: 900, q: 3.2, duration: 0.055, gain: 0.032 });
      break;
    case 'bleed_tick':
      playTone(ac, { type: 'triangle', freq: 280, endFreq: 120, duration: 0.055, gain: 0.035 });
      break;
    case 'ignite_tick':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 1400, endFreq: 700, q: 2, duration: 0.06, gain: 0.032 });
      break;
    case 'guard_ward':
      playTone(ac, { type: 'sine', freq: 660, endFreq: 880, duration: 0.14, gain: 0.045 });
      playTone(ac, { type: 'sine', freq: 990, endFreq: 1180, duration: 0.12, gain: 0.03, delay: 0.03 });
      break;
    case 'dodge_mitigate':
      playFilteredNoise(ac, { filterType: 'highpass', freq: 2100, duration: 0.06, gain: 0.04 });
      break;
    case 'telegraph_warn':
      playTone(ac, { type: 'triangle', freq: 210, endFreq: 185, duration: 0.24, gain: 0.065 });
      break;
    case 'telegraph_punish':
      playTone(ac, { type: 'sine', freq: 740, endFreq: 1110, duration: 0.14, gain: 0.065 });
      break;
    case 'boss_phase':
      playTone(ac, { type: 'sawtooth', freq: 110, endFreq: 72, duration: 0.36, gain: 0.075 });
      playTone(ac, { type: 'triangle', freq: 165, endFreq: 110, duration: 0.36, gain: 0.06, delay: 0.04 });
      break;
    case 'enemy_death':
      playTone(ac, { type: 'sine', freq: 310, endFreq: 85, duration: 0.12, gain: 0.04 });
      break;
    case 'orb_craft':
      playTone(ac, { type: 'triangle', freq: 523.25, duration: 0.09, gain: 0.055 });
      playTone(ac, { type: 'sine', freq: 783.99, duration: 0.16, gain: 0.055, delay: 0.05 });
      break;
    case 'chroma_craft':
      playTone(ac, { type: 'sine', freq: 659.25, duration: 0.09, gain: 0.045 });
      playTone(ac, { type: 'sine', freq: 987.77, duration: 0.14, gain: 0.045, delay: 0.04 });
      playTone(ac, { type: 'sine', freq: 1318.5, duration: 0.16, gain: 0.035, delay: 0.08 });
      break;
    case 'boss_cache_open':
      playTone(ac, { type: 'triangle', freq: 392, duration: 0.12, gain: 0.06 });
      playTone(ac, { type: 'triangle', freq: 523.25, duration: 0.14, gain: 0.06, delay: 0.07 });
      playTone(ac, { type: 'sine', freq: 783.99, duration: 0.24, gain: 0.065, delay: 0.14 });
      break;
    case 'level_up':
      playTone(ac, { type: 'sine', freq: 440, duration: 0.14, gain: 0.05 });
      playTone(ac, { type: 'sine', freq: 554.37, duration: 0.16, gain: 0.05, delay: 0.07 });
      playTone(ac, { type: 'sine', freq: 659.25, duration: 0.26, gain: 0.06, delay: 0.14 });
      break;
    default:
      break;
  }
}

export function installSfxPlayer(isEnabled: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {};

  const unlock = () => {
    if (isEnabled()) ensureContext();
  };

  const onSfx = (event: Event) => {
    if (!isEnabled()) return;
    const detail = (event as CustomEvent<{ key?: string; at?: number }>).detail;
    const key = detail?.key;
    if (!key) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const cooldown = COOLDOWNS.get(key) ?? 120;
    const prev = lastPlayed.get(key) ?? 0;
    if (now - prev < cooldown) return;
    lastPlayed.set(key, now);
    playCue(key);
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('warbound:sfx', onSfx);

  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('warbound:sfx', onSfx);
  };
}
