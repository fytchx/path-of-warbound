import { sfxDefs } from '../data';

const COOLDOWNS = new Map<string, number>(sfxDefs.map((spec) => [spec.id, spec.cooldownMs]));
const EXTRA_COOLDOWNS: Record<string, number> = {
  cast_release: 110,
  spell_crit: 120,
  key_drop: 240,
  rare_drop: 260,
  boss_summon: 600,
};

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let attackSpeedScale = 1;
const lastPlayed = new Map<string, number>();

export function setSfxAttackSpeed(aps: number): void {
  if (!Number.isFinite(aps) || aps <= 0) {
    attackSpeedScale = 1;
    return;
  }
  attackSpeedScale = Math.max(0.78, Math.min(1.45, aps / 1.15));
}

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
  const length = Math.floor(ac.sampleRate * 0.45);
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
    attack?: number;
  },
): void {
  const start = ac.currentTime + (opts.delay ?? 0);
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = opts.type ?? 'triangle';
  osc.frequency.setValueAtTime(Math.max(36, opts.freq), start);
  if (opts.endFreq && opts.endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, opts.endFreq), start + opts.duration);
  }
  const atk = opts.attack ?? Math.min(0.015, opts.duration * 0.25);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(opts.gain, start + atk);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  osc.connect(amp);
  amp.connect(ac.destination);
  osc.start(start);
  osc.stop(start + opts.duration + 0.025);
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
  amp.gain.linearRampToValueAtTime(opts.gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(ac.destination);
  src.start(start);
  src.stop(start + opts.duration + 0.025);
}

function playCue(key: string): void {
  const ac = ensureContext();
  if (!ac || ac.state !== 'running') return;
  const spd = attackSpeedScale;
  const durScale = 1 / Math.sqrt(spd);

  switch (key) {
    case 'melee_slash':
      // Crisp blade whoosh + weighted hit thud, pitched by weapon attack speed
      playFilteredNoise(ac, {
        filterType: 'bandpass',
        freq: 1950 * spd,
        endFreq: 440 * spd,
        q: 1.5,
        duration: 0.085 * durScale,
        gain: 0.075,
      });
      playTone(ac, {
        type: 'triangle',
        freq: 235 * spd,
        endFreq: 86 * spd,
        duration: 0.08 * durScale,
        gain: 0.065,
      });
      break;
    case 'melee_crit':
      // Heavy cleave + chest thump + bright gold crit chime
      playFilteredNoise(ac, {
        filterType: 'bandpass',
        freq: 2600 * spd,
        endFreq: 340 * spd,
        q: 1.25,
        duration: 0.13 * durScale,
        gain: 0.095,
      });
      playTone(ac, {
        type: 'sawtooth',
        freq: 290 * spd,
        endFreq: 78 * spd,
        duration: 0.12 * durScale,
        gain: 0.075,
      });
      playTone(ac, { type: 'sine', freq: 1046.5, endFreq: 1567.98, duration: 0.14, gain: 0.055, delay: 0.012 });
      break;
    case 'auto_shot':
      // Snappy bow/staff bolt release pitched by attack speed
      playFilteredNoise(ac, {
        filterType: 'highpass',
        freq: 1600 * spd,
        endFreq: 680 * spd,
        duration: 0.055 * durScale,
        gain: 0.05,
      });
      playTone(ac, {
        type: 'sine',
        freq: 560 * spd,
        endFreq: 215 * spd,
        duration: 0.065 * durScale,
        gain: 0.045,
      });
      break;
    case 'cast_release':
      // Bright arcane release shimmer when a timed spell finishes charging
      playTone(ac, { type: 'sine', freq: 587.33, endFreq: 1174.66, duration: 0.12, gain: 0.045 });
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 2400, endFreq: 4200, q: 1.8, duration: 0.09, gain: 0.035 });
      break;
    case 'spell_crit':
      playTone(ac, { type: 'sine', freq: 1174.66, endFreq: 1760, duration: 0.13, gain: 0.05 });
      playTone(ac, { type: 'triangle', freq: 880, duration: 0.11, gain: 0.03, delay: 0.025 });
      break;
    case 'fireball_cast':
      playFilteredNoise(ac, { filterType: 'lowpass', freq: 440, endFreq: 1650, duration: 0.16, gain: 0.065 });
      playTone(ac, { type: 'sine', freq: 310, endFreq: 620, duration: 0.13, gain: 0.035 });
      break;
    case 'fireball_impact':
      playFilteredNoise(ac, { filterType: 'lowpass', freq: 1050, endFreq: 130, duration: 0.19, gain: 0.095 });
      playTone(ac, { type: 'triangle', freq: 165, endFreq: 46, duration: 0.18, gain: 0.085 });
      break;
    case 'frost_cast':
      playTone(ac, { type: 'sine', freq: 980, endFreq: 1390, duration: 0.12, gain: 0.045 });
      playTone(ac, { type: 'sine', freq: 1480, endFreq: 1975, duration: 0.1, gain: 0.03, delay: 0.02 });
      break;
    case 'frost_impact':
      playFilteredNoise(ac, { filterType: 'highpass', freq: 2600, duration: 0.11, gain: 0.068 });
      playTone(ac, { type: 'sine', freq: 1460, endFreq: 660, duration: 0.13, gain: 0.05 });
      break;
    case 'lightning_cast':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 3400, q: 2.3, duration: 0.095, gain: 0.055 });
      playTone(ac, { type: 'sawtooth', freq: 880, endFreq: 440, duration: 0.08, gain: 0.03 });
      break;
    case 'lightning_impact':
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 2900, endFreq: 420, q: 1.5, duration: 0.14, gain: 0.085 });
      playTone(ac, { type: 'sawtooth', freq: 640, endFreq: 135, duration: 0.12, gain: 0.05 });
      break;
    case 'void_cast':
      playTone(ac, { type: 'sine', freq: 250, endFreq: 165, duration: 0.16, gain: 0.055 });
      playTone(ac, { type: 'triangle', freq: 375, endFreq: 245, duration: 0.14, gain: 0.03, delay: 0.02 });
      break;
    case 'void_impact':
      playTone(ac, { type: 'triangle', freq: 195, endFreq: 62, duration: 0.17, gain: 0.075 });
      playFilteredNoise(ac, { filterType: 'bandpass', freq: 680, endFreq: 230, q: 2, duration: 0.15, gain: 0.055 });
      break;
    case 'aoe_pulse':
      playTone(ac, { type: 'sine', freq: 140, endFreq: 44, duration: 0.21, gain: 0.09 });
      playFilteredNoise(ac, { filterType: 'lowpass', freq: 560, endFreq: 115, duration: 0.17, gain: 0.065 });
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
      playTone(ac, { type: 'sine', freq: 660, endFreq: 880, duration: 0.14, gain: 0.048 });
      playTone(ac, { type: 'sine', freq: 990, endFreq: 1180, duration: 0.12, gain: 0.035, delay: 0.03 });
      break;
    case 'dodge_mitigate':
      playFilteredNoise(ac, { filterType: 'highpass', freq: 2200, duration: 0.065, gain: 0.045 });
      playTone(ac, { type: 'sine', freq: 920, endFreq: 1380, duration: 0.09, gain: 0.04 });
      break;
    case 'telegraph_warn':
      // Ominous low enemy telegraph warning hum
      playTone(ac, { type: 'sawtooth', freq: 148, endFreq: 124, duration: 0.32, gain: 0.05, attack: 0.04 });
      playTone(ac, { type: 'sine', freq: 74, endFreq: 64, duration: 0.34, gain: 0.075, attack: 0.03 });
      playTone(ac, { type: 'triangle', freq: 296, endFreq: 248, duration: 0.24, gain: 0.035, delay: 0.04 });
      break;
    case 'telegraph_punish':
      playTone(ac, { type: 'sine', freq: 740, endFreq: 1110, duration: 0.14, gain: 0.065 });
      break;
    case 'boss_summon':
      // Deep brassy Boss Summon Horn
      playTone(ac, { type: 'sawtooth', freq: 82.41, endFreq: 73.42, duration: 0.65, gain: 0.075, attack: 0.06 });
      playTone(ac, { type: 'triangle', freq: 123.47, endFreq: 110, duration: 0.6, gain: 0.065, attack: 0.07, delay: 0.03 });
      playTone(ac, { type: 'sine', freq: 55, endFreq: 49, duration: 0.7, gain: 0.09, attack: 0.05 });
      break;
    case 'boss_phase':
      playTone(ac, { type: 'sawtooth', freq: 110, endFreq: 72, duration: 0.36, gain: 0.075 });
      playTone(ac, { type: 'triangle', freq: 165, endFreq: 110, duration: 0.36, gain: 0.06, delay: 0.04 });
      break;
    case 'enemy_death':
      playTone(ac, { type: 'sine', freq: 310, endFreq: 85, duration: 0.12, gain: 0.04 });
      break;
    case 'key_drop':
      // Shimmering Rift Key golden arpeggio
      playTone(ac, { type: 'sine', freq: 659.25, duration: 0.11, gain: 0.055 });
      playTone(ac, { type: 'sine', freq: 830.61, duration: 0.12, gain: 0.055, delay: 0.055 });
      playTone(ac, { type: 'sine', freq: 987.77, duration: 0.14, gain: 0.06, delay: 0.11 });
      playTone(ac, { type: 'sine', freq: 1318.51, duration: 0.26, gain: 0.065, delay: 0.165 });
      break;
    case 'rare_drop':
      // Crystalline Rare / Mythic loot drop chime
      playTone(ac, { type: 'triangle', freq: 587.33, duration: 0.11, gain: 0.05 });
      playTone(ac, { type: 'sine', freq: 880, duration: 0.14, gain: 0.055, delay: 0.06 });
      playTone(ac, { type: 'sine', freq: 1174.66, duration: 0.24, gain: 0.06, delay: 0.12 });
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
    const cooldown = COOLDOWNS.get(key) ?? EXTRA_COOLDOWNS[key] ?? 120;
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
