import { audio } from './audio';

/**
 * The ghanta's voice — synthesised, so no recording ships.
 *
 * A struck bell is a set of decaying resonant modes, which means its whole
 * sound fits in the table below. The numbers are measured, not invented:
 * `tools/bell-modes.py` reads them off a real ghanta recording
 * (docs/ganta-bell.mp3, kept out of the repo like the ocean masters) and
 * prints this table. It also renders docs/bell-preview.wav from the same
 * model — audition changes there, against the reference, before trusting
 * them here.
 *
 * A synth earns its place over that recording in three ways a sample has no
 * access to:
 *
 *   - Force shapes the TIMBRE, not just the level. A soft swing is a dark
 *     ting, a hard shake a bright clang — one lowpass whose cutoff follows
 *     the strike force, which is what a bell's nonlinearity does.
 *   - No two strikes match, honestly. The sample path faked this by shifting
 *     playbackRate, which changes the bell's pitch — the one thing a real
 *     bell never varies. Here the pitch is fixed and the mix wobbles a
 *     couple of dB per mode, which is what a clapper landing in a slightly
 *     different spot actually varies.
 *   - A ring can be CHOKED mid-tail. Clicking a ringing bell closes a hand
 *     round it: STOP_D stills the swing in half a second, and `choke` kills
 *     the sound with it — a sample's tail would ring on for seconds after
 *     the hand has visibly closed.
 */

/**
 * [freq Hz, level 0..1, decay time-constant s, beat Hz] per mode.
 *
 * Regenerate with the tool rather than hand-editing frequencies; levels and
 * beats are fair game for taste. `beat` is the shimmer: a bell's
 * near-degenerate mode pairs sit a few Hz apart, split by its asymmetries —
 * the clapper, the Nandi — and the prime's 5 Hz wobble is most of what makes
 * it read as metal rather than as a sine. A beating mode is played as two
 * sines either side of the centre.
 */
const MODES: [number, number, number, number][] = [
  [1016.8, 1.0, 3.08, 5.2],
  [2028.4, 0.018, 1.55, 0.0],
  [3004.7, 0.672, 0.3, 0.0],
  [3680.8, 0.029, 1.12, 0.0],
  [3775.6, 0.036, 1.06, 0.0],
  [4019.0, 0.016, 1.42, 0.0],
  [4092.2, 0.253, 0.25, 0.0],
];

/**
 * Loudest a single strike is allowed to be, before the swing scales it.
 * The mode levels sum to about 2, so this stays well under 0.5 to keep a
 * hard strike — and the auto-ring's overlapping tails — clear of clipping.
 */
const LEVEL = 0.3;

/** The brightness law: lowpass cutoff, Hz, at force 0 and at force 1. */
const CUTOFF_LO = 1200;
const CUTOFF_HI = 10000;

/** The clapper's contact: a few ms of band-passed noise. Without it every
 * strike fades in microscopically and the ear knows something is wrong
 * without knowing what. */
const TICK_S = 0.05;
const TICK_TAU = 0.006;
const TICK_LEVEL = 0.35;

/** An oscillator is stopped this many time-constants in, about -35 dB —
 * inaudible under the room, and it keeps the auto-ring from accumulating
 * hundreds of live nodes. */
const TAIL = 4;

let tick: AudioBuffer | null = null;

/** Master gains of strikes still sounding, so a closing hand can reach them. */
const ringing = new Set<GainNode>();

/**
 * Called from a pointerdown, like the beds' warm: the AudioContext must be
 * created inside a user gesture, and resume is never awaited — a context
 * blocked by the autoplay policy leaves the promise pending for ever.
 */
export function warmBell(): void {
  const ctx = audio();
  void ctx.resume();
  if (!tick) {
    tick = ctx.createBuffer(1, Math.round(TICK_S * ctx.sampleRate), ctx.sampleRate);
    const data = tick.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (TICK_TAU * ctx.sampleRate));
    }
  }
}

/** One clapper strike. `force` is 0..1, read off the speed at the turn. */
export function strikeBell(force: number): void {
  const ctx = audio();
  const t0 = ctx.currentTime;

  const out = ctx.createGain();
  out.gain.value = LEVEL * force;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = CUTOFF_LO + force * (CUTOFF_HI - CUTOFF_LO);
  lp.connect(out).connect(ctx.destination);

  let last: OscillatorNode | null = null;
  let longest = 0;
  for (const [freq, level, tau, beat] of MODES) {
    // The clapper never lands twice in the same spot: a couple of dB on each
    // mode, and a fraction of a Hz on each partial so the beat of a pair
    // does not run identically strike after strike.
    const amp = level * Math.pow(10, (Math.random() * 4 - 2) / 20);
    const parts = beat > 0.05 ? [freq - beat / 2, freq + beat / 2] : [freq];
    for (const f of parts) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f + Math.random() * 0.6 - 0.3;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(amp / parts.length, t0);
      gain.gain.setTargetAtTime(0, t0, tau);
      osc.connect(gain).connect(lp);
      osc.start(t0);
      osc.stop(t0 + tau * TAIL);
      if (tau > longest) {
        longest = tau;
        last = osc;
      }
    }
  }

  if (tick) {
    const src = ctx.createBufferSource();
    src.buffer = tick;
    const gain = ctx.createGain();
    gain.gain.value = TICK_LEVEL * force;
    src.connect(gain).connect(lp);
    src.start(t0);
  }

  ringing.add(out);
  if (last) {
    // The prime outlives everything else; its end is the strike's end.
    last.onended = () => {
      ringing.delete(out);
      out.disconnect();
    };
  }
}

/**
 * A hand closing round a ringing bell. The mode envelopes keep their own
 * decays under it; the master gain just takes everything to silence in the
 * time a palm takes to damp brass.
 */
export function chokeBell(): void {
  const now = audio().currentTime;
  for (const out of ringing) {
    out.gain.setTargetAtTime(0, now, 0.06);
  }
}
