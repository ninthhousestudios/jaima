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

/**
 * ...and sooner than that when the mode was quiet to start with.
 *
 * Four time-constants is the right measure for the prime, which begins at
 * full level. Five of the seven modes here begin 25-35 dB under it and reach
 * the same absolute silence in a fraction of their own TAIL, so holding them
 * out to four buys nothing but live oscillators — and the auto-ring keeps a
 * dozen strikes going at once, on hardware that may have little to spare.
 * This is the absolute level, against the prime's own start, at which a mode
 * has stopped contributing.
 */
const FLOOR = 0.01;

/**
 * The saturation bus every strike passes through on its way out.
 *
 * The auto-ring lands a full-force strike at every turn of the swing — about
 * four a second — and the prime rings for three, so a dozen tails sum on top
 * of each other and the total walks past full scale, where it would clip
 * digitally: the "sometimes it distorts" of a bell left ringing. A tanh
 * curve is unity gain at ordinary levels, so a lone strike passes untouched,
 * and folds the dense roar smoothly under a ceiling instead. Not a
 * DynamicsCompressorNode, deliberately: that node applies an implicit makeup
 * gain derived from its knobs, which would quietly reboost everything.
 *
 * SAT is 1, so the ceiling is full scale. It was 1.5 — a ceiling of 0.67,
 * bought by bending the curve so early that a LONE strike, which peaks around
 * 0.6, was already being squashed by 2.2 dB and the ring by 6. A tanh has no
 * knee: it curves from the origin, and the price of a low ceiling is paid on
 * every quiet sound, not just the loud one. There is nothing to buy that
 * headroom for — the fold is a net, and the level below it is what keeps the
 * bell out of the net in the first place.
 */
const SAT = 1.0;

/**
 * How far past full scale the fold is drawn — and the whole reason it works.
 *
 * A WaveShaper's curve is indexed by the input over [-1, 1] AND NOTHING ELSE:
 * a sample hotter than 1 does not run off the end of the curve, it is clamped
 * to the curve's last point. So a tanh drawn across [-1, 1] is a soft fold up
 * to full scale and a HARD CLIP above it — flat-topped, the one thing this bus
 * exists to prevent, at exactly the level a dozen summed tails reach. The cure
 * is to draw the same curve compressed into the range the shaper will look at:
 * the signal is padded down by HEAD on the way in and the curve stretched by
 * HEAD to match, so the shaper's ±1 now stands for ±HEAD of signal and the
 * fold is still bending where a stack of strikes actually lands. Unity slope
 * at the origin is preserved, so a lone strike still passes untouched.
 */
const HEAD = 4;

/** The bus is a pair: the pad that buys the headroom, then the fold. */
interface Bus {
  in: GainNode;
  out: WaveShaperNode;
}

let bus: Bus | null = null;

function bellBus(ctx: AudioContext): Bus {
  if (!bus) {
    const shaper = ctx.createWaveShaper();
    // Long, because the interesting part of the curve is now squeezed into
    // the middle eighth of it — a lone strike must not come out stepped.
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(SAT * HEAD * x) / SAT;
    }
    shaper.curve = curve;
    // The curve bends, so it makes harmonics; without oversampling they
    // alias back under Nyquist as inharmonic grit.
    shaper.oversample = '4x';
    const pad = ctx.createGain();
    pad.gain.value = 1 / HEAD;
    pad.connect(shaper).connect(ctx.destination);
    bus = { in: pad, out: shaper };
  }
  return bus;
}

/**
 * The bus's output, built if it is not there yet, for a meter to hang on.
 *
 * Diagnostics only — `?bell-debug`, see `bell-debug.ts`. Nothing in the room
 * calls this, and with the panel closed nothing is ever attached.
 */
export function bellTap(): AudioNode {
  return bellBus(audio()).out;
}

let tick: AudioBuffer | null = null;

/**
 * Strikes still sounding — the master gain a closing hand chokes, and the
 * oscillators an eviction must stop.
 */
interface Ring {
  out: GainNode;
  oscs: OscillatorNode[];
  /** Its own gain, tracked because every later strike takes it down. */
  level: number;
  /** A hand is already closed round it, so a strike must not revive it. */
  choked: boolean;
}

/**
 * What a strike leaves of the tails already sounding — the clapper's other
 * half, and the fix for the loud clang.
 *
 * A clapper does not only excite the bell, it LANDS on it: brass already in
 * motion is damped by the thing that strikes it, which is why a hand bell
 * rung fast sounds tight and renewed rather than building into a roar. The
 * code had only the excitation, so at four strikes a second against a prime
 * that rings for twelve, a dozen tails at the same seven frequencies summed
 * on top of each other and their phases drifted in and out of alignment.
 * Simulated over five seconds of auto-ring the peak wandered between 1.27 and
 * 1.54 against a lone strike's 0.63 — up to 8 dB of unasked-for accent, on
 * whichever strike happened to land in phase. That is the clang, and it was
 * never one strike being loud; it was ten of them agreeing.
 *
 * At 0.75 the same run peaks at 0.80 and varies by a twentieth of a dB from
 * strike to strike. Three or four tails are still plainly audible under the
 * newest, which is the layering that makes it a bell and not a beep — what is
 * gone is only the part that was summing into an accident.
 */
const DUCK = 0.75;

/** How fast that duck arrives. Long enough not to click, short enough to be
 * the clapper landing rather than a fade. */
const DUCK_T = 0.008;

const ringing = new Set<Ring>();

/** Strikes fired since the page loaded. Read by `?bell-debug`, nothing else. */
let struck = 0;

/** What the debug panel reports. Diagnostics only. */
export function bellStats(): { rings: number; strikes: number } {
  return { rings: ringing.size, strikes: struck };
}

/**
 * How many strikes may sound at once. The resonance of strikes over strikes
 * is the bell's best quality and it stays: what the auto-ring layers is the
 * recent dozen tails, and those all fit. But unbounded, four full-force
 * strikes a second times a twelve-second prime is two-hundred-odd live
 * oscillators, and when the audio thread misses its deadline the whole
 * output stutters. Past the cap the OLDEST tail is faded out in 50 ms —
 * always under a brand-new strike at the same pitch, so its exit is masked.
 *
 * Eight rather than fourteen, since DUCK arrived: the eighth-oldest tail has
 * been damped by seven later strikes and stands 20 dB under the newest, so
 * the six this drops were inaudible and were being synthesised anyway. That
 * is the one lever this file has on a weak device, where the symptom is not
 * a stutter but the whole output stream going away for seconds at a time.
 */
const MAX_RINGING = 8;

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
  struck++;

  // The clapper lands on a bell that is already sounding, and damps it.
  for (const r of ringing) {
    if (r.choked) continue;
    r.level *= DUCK;
    r.out.gain.setTargetAtTime(r.level, t0, DUCK_T);
  }

  const out = ctx.createGain();
  out.gain.value = LEVEL * force;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = CUTOFF_LO + force * (CUTOFF_HI - CUTOFF_LO);
  lp.connect(out).connect(bellBus(ctx).in);

  const oscs: OscillatorNode[] = [];
  let last: OscillatorNode | null = null;
  let longest = 0;
  for (const [freq, level, tau, beat] of MODES) {
    // The clapper never lands twice in the same spot: a couple of dB on each
    // mode, and a fraction of a Hz on each partial so the beat of a pair
    // does not run identically strike after strike.
    const amp = level * Math.pow(10, (Math.random() * 4 - 2) / 20);
    const parts = beat > 0.05 ? [freq - beat / 2, freq + beat / 2] : [freq];
    // Whichever comes first: four of its own time-constants, or the moment
    // its envelope passes under FLOOR.
    const life = Math.min(tau * TAIL, tau * Math.log(Math.max(amp, FLOOR) / FLOOR));
    // One envelope per mode; a pair's two sines sum into it.
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amp / parts.length, t0);
    gain.gain.setTargetAtTime(0, t0, tau);
    gain.connect(lp);
    for (const f of parts) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f + Math.random() * 0.6 - 0.3;
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + life);
      oscs.push(osc);
      if (life > longest) {
        longest = life;
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

  const ring: Ring = { out, oscs, level: LEVEL * force, choked: false };
  ringing.add(ring);
  if (last) {
    // The prime outlives everything else; its end is the strike's end —
    // whether it ran its course or an eviction moved its stop time up.
    last.onended = () => {
      ringing.delete(ring);
      lp.disconnect();
      out.disconnect();
    };
  }

  if (ringing.size > MAX_RINGING) {
    // Sets iterate in insertion order, so the first entry is the oldest —
    // which may be a choked strike still draining, and evicting those first
    // is exactly right.
    for (const oldest of ringing) {
      ringing.delete(oldest);
      oldest.out.gain.setTargetAtTime(0, t0, 0.05);
      for (const osc of oldest.oscs) osc.stop(t0 + 0.3);
      break;
    }
  }
}

/**
 * A hand closing round a ringing bell. The mode envelopes keep their own
 * decays under it; the master gain just takes everything to silence in the
 * time a palm takes to damp brass.
 */
export function chokeBell(): void {
  const now = audio().currentTime;
  for (const ring of ringing) {
    // Marked, so a strike landing before the tail has drained does not duck
    // it — which, being a multiply toward a level above zero, would raise it.
    ring.choked = true;
    ring.level = 0;
    ring.out.gain.setTargetAtTime(0, now, 0.06);
  }
}
