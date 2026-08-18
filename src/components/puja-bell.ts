import { chokeBell, strikeBell, warmBell } from './bell-voice';
import { el } from './dom';

/**
 * The puja bell — brass, with Nandi couchant on the handle, standing on the
 * ledge among the offerings.
 *
 * It is picked up and rung the way the arati lamp is picked up and waved, and
 * for the same reason: the bell in the room is the bell you ring, not a button
 * that plays a bell. The physics is one damped pendulum. Your hand carries the
 * pivot, the bell's body lags behind it, and the clapper lands every time the
 * swing turns over — so the sound comes out of the gesture rather than being
 * triggered alongside it, and a small shake gives a small ring.
 *
 * TWO WAYS TO RING IT, and the second is the one that matters:
 *
 *   - DRAG it and it rings from your hand, as fast or as slow as you move.
 *   - CLICK it, without dragging, and it keeps ringing on its own wherever it
 *     happens to be. Click again to stop it. That is what lets the bell be
 *     going during arati: you cannot hold the bell and the lamp at once with
 *     one pointer, and a rite performed with a bell ringing beside you is the
 *     ordinary way it is done.
 *
 * Both go through one integrator, with the self-ringing push standing in for
 * your hand's acceleration — so clicking a bell that is already swinging keeps
 * the swing it had rather than restarting it.
 *
 * THE BELL IS LIVE IN EVERY MODE, unlike the lamps. It is a bell: you ring it
 * when you want to, not when a screen permits it. So it also keeps ringing and
 * keeps its place when you leave a mode, exactly as the sound beds keep playing
 * — the arati recording is the thing with a beginning and an end, not this.
 * Only the hint that explains it belongs to arati mode.
 *
 * It stays where it is let go of. Dropped back near its place on the ledge it
 * settles into it exactly, which is the only way home and is why the bell needs
 * no Clear button of the kind the garlands have.
 */

/**
 * Where a hand closes round the handle, as a fraction of the render's own
 * width and height — so what the bell turns about.
 *
 * DERIVED FROM THE RENDER, like WICKS in altar.ts and GRIP in arati-lamp.ts.
 * `tools/altar-assets.py` prints it on every render:
 *
 *     blender -b -P tools/altar-assets.py -- --only bell
 *
 * The other sites that move with it are `transform-origin` and
 * `aspect-ratio: 732 / 1536` on `.puja-bell` in index.astro.
 */
const GRIP = { x: 0.5, y: 0.398 };

/**
 * How much of the gap to the hand the bell closes each frame.
 *
 * Below 1 for the same reason the arati lamp's FOLLOW is: the lag is the
 * weight. Here it does a second job, because the swing is driven by the
 * *acceleration* of this eased position — at 1 the bell would be nailed to the
 * pointer and every jitter of the mouse would read as a violent shake.
 */
const FOLLOW = 0.25;

/**
 * The pendulum, in degrees and frames.
 *
 * K is a restoring stiffness, so the free period is 2*pi/sqrt(K) frames — at
 * 0.054 that is about 27 frames, a touch under half a second, which is roughly
 * how fast a hand bell of this size wants to rock. D damps it: 1/D frames to
 * decay, so a released bell rings on for a second and a half.
 */
const K = 0.054;
const D = 0.014;

/**
 * Damping while it is being deliberately stopped — a hand closed round it.
 *
 * Needed because the free damping is right for a bell let go of and wrong for
 * one told to stop: from a 20-degree swing, D alone keeps it striking for four
 * more seconds, and a click that means "stop" should not be argued with for
 * four seconds. This muffles it in about half a second and stills it in under
 * two, which is what catching a ringing bell in your palm actually looks like.
 */
const STOP_D = 0.1;

/** Degrees of angular kick per pixel of hand acceleration, and the ceiling. */
const DRIVE = 1.2;
const MAX_OMEGA = 9;

/**
 * The self-ringing limit cycle: a push at every frame the swing is inside
 * AUTO_AMP, always in the direction it is already going. An escapement, in
 * other words — it settles at whatever amplitude the damping balances, and it
 * does it through the same integrator as a hand swing, so setting it going
 * mid-wave carries the swing it already had rather than resetting it.
 */
const AUTO_AMP = 20;
const AUTO_PUSH = 0.075;

/** Slower than this at the turn and the clapper does not carry to the wall. */
const STRIKE_MIN = 0.9;
/** No two strikes closer than this, ms — a real clapper cannot rebound faster. */
const STRIKE_GAP = 90;

/**
 * The speed at the turn that counts as a strike at full force.
 *
 * It has to span what the integrator can actually reach, which is MAX_OMEGA,
 * and it did not: at 4 anything from a moderate rock upward pinned at 1. That
 * mattered for one reason — the escapement settles at a fixed amplitude and
 * turns over at 4.0, so the SELF-RING sat at maximum force and maximum
 * brightness for as long as it was left going, four strikes a second, every
 * one of them identical and as hard as the bell can be hit. A bell rocking in
 * its own swing is not being hit as hard as an arm can hit it. At 6 it lands
 * at two thirds — 3.5 dB down and a good deal darker, which is what a rocking
 * bell sounds like — and a deliberate shake still has the whole range above it
 * to reach for.
 */
const FULL_OMEGA = 6;

/**
 * The integrator runs on a fixed step, not on the frame.
 *
 * Every constant above is per step, so if the frame drove it the bell would
 * ring twice as fast on a 120 Hz display and half as fast on a throttled tab.
 * Rate is exactly what an ear notices about a bell — a lamp that follows the
 * hand a little more tightly is not noticeable at all, which is why the arati
 * wave gets away with reading the frame directly and this does not. rAF hands
 * over real elapsed time; this spends it in whole steps and drops the rest.
 */
const STEP_MS = 1000 / 60;
/** Never work through more than this at once, after a tab has been away. */
const MAX_STEPS = 4;

/** Under this, in px, the bell has arrived where it was going. */
const EPS = 0.04;

/**
 * And under this, in degrees, it has stopped swinging.
 *
 * Looser than EPS on purpose. The swing has to be small in angle AND in speed
 * on the same frame, and those two are a quarter-cycle apart, so the test only
 * passes once the amplitude is under about four times this — at 0.04 the loop
 * would run on for six seconds after the last audible strike, chasing a swing
 * of a hundredth of a degree. This is a tenth of a pixel at the mouth.
 */
const ANGLE_EPS = 0.15;

/** Clearance kept between the carried bell's grip and the edge of the room. */
const BOUND = 0.04;

/** Further than this from where it went down and it was a carry, not a click. */
const CLICK_PX = 6;

/**
 * Release it within this of where it stands and it settles back into place, as
 * a fraction of the altar's width. Putting it back is the only way home, and
 * without a margin you would have to hit the spot to the pixel.
 */
const HOME_SNAP = 0.05;

export interface PujaBell {
  readonly root: HTMLElement;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function buildPujaBell(parent: HTMLElement, altar: HTMLElement): PujaBell {
  const root = el('div', 'puja-bell', parent);

  const img = document.createElement('img');
  img.src = '/images/altar/bell@2x.png';
  img.alt = '';
  img.className = 'puja-bell-img';
  root.appendChild(img);

  // --- the swing ---

  /** Offset from where it stands on the ledge, px, and where it is heading. */
  const lift = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  /** Degrees off plumb, and degrees per frame. */
  let theta = 0;
  let omega = 0;
  /** Fastest the swing got since it last turned over — what the strike reads. */
  let peak = 0;
  let lastStrike = 0;
  /** Horizontal speed of the lift last frame, so this frame can differentiate. */
  let speed = 0;

  let auto = false;
  /** Set while a click is muffling it — see STOP_D. Cleared by any new touch. */
  let stopping = false;
  let carried = false;
  let running = false;
  /** Timestamp of the last frame, 0 while stopped — see STEP_MS. */
  let last = 0;
  let pointer = { x: 0, y: 0 };
  let origin = { x: 0, y: 0 };
  /** Where the pointer went down, and how far it has strayed — tap or carry. */
  let down = { x: 0, y: 0 };
  let travelled = 0;
  let limit = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  /** One fixed step of the pendulum, toward a lift target of (tx, ty). */
  function step(tx: number, ty: number, now: number) {
    const was = lift.x;
    lift.x += (tx - lift.x) * FOLLOW;
    lift.y += (ty - lift.y) * FOLLOW;

    // Acceleration, not speed, is what swings a bell: the hand pulls the pivot
    // out from under the body, and the body is left behind. A hand moving at a
    // steady rate carries the bell along without ringing it, which is right —
    // you ring one by shaking it, not by walking with it.
    const moved = lift.x - was;
    const accel = moved - speed;
    speed = moved;

    const before = omega;
    let torque = -K * theta - (stopping ? STOP_D : D) * omega - DRIVE * accel;
    if (auto && Math.abs(theta) < AUTO_AMP) torque += AUTO_PUSH * (omega >= 0 ? 1 : -1);
    omega = clamp(omega + torque, -MAX_OMEGA, MAX_OMEGA);
    theta += omega;

    peak = Math.max(peak, Math.abs(before));
    // The turn of the swing is where the clapper arrives.
    if (before * omega < 0) {
      if (peak > STRIKE_MIN && now - lastStrike > STRIKE_GAP) {
        strikeBell(clamp(peak / FULL_OMEGA, 0.18, 1));
        lastStrike = now;
      }
      peak = 0;
    }
  }

  function tick(now: number) {
    const tx = carried ? clamp(pointer.x - origin.x, limit.minX, limit.maxX) : target.x;
    const ty = carried ? clamp(pointer.y - origin.y, limit.minY, limit.maxY) : target.y;

    const steps = last ? clamp(Math.round((now - last) / STEP_MS), 1, MAX_STEPS) : 1;
    last = now;
    for (let i = 0; i < steps; i++) step(tx, ty, now);

    root.style.setProperty('--lift-x', `${lift.x}px`);
    root.style.setProperty('--lift-y', `${lift.y}px`);
    root.style.setProperty('--swing', `${theta}deg`);

    const still = !auto && Math.abs(theta) < ANGLE_EPS && Math.abs(omega) < ANGLE_EPS;
    const placed = Math.abs(lift.x - tx) < EPS && Math.abs(lift.y - ty) < EPS;

    if (!carried && still && placed) {
      // Nothing is moving and nothing is going to. Snap the last hundredths
      // off so a bell at rest holds no state from the ring that finished.
      theta = omega = speed = peak = 0;
      lift.x = tx;
      lift.y = ty;
      stopping = false;
      // Rewritten, all three: the values above were put on the element before
      // the snap, so leaving them would have the element disagree with the
      // state by a millionth of a pixel for as long as the bell stands there.
      root.style.setProperty('--lift-x', `${lift.x}px`);
      root.style.setProperty('--lift-y', `${lift.y}px`);
      root.style.setProperty('--swing', '0deg');
      // Home, rather than merely stopped: the bell is back among the offerings
      // and is scenery again.
      if (tx === 0 && ty === 0) root.classList.remove('lifted');
      running = false;
      last = 0;
      return;
    }
    requestAnimationFrame(tick);
  }

  function run() {
    if (running) return;
    running = true;
    last = 0;
    requestAnimationFrame(tick);
  }

  function setAuto(on: boolean) {
    auto = on;
    // Turning it off is a hand closing round the bell, not a hand letting go.
    stopping = !on;
    root.classList.toggle('ringing', on);
    if (on) warmBell();
    // The hand that stills the swing muffles the ring with it — STOP_D and
    // the choke are the same gesture heard twice.
    else chokeBell();
  }

  root.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();

    // The point under the hand keeps its lift, so the bell never jumps on
    // being taken — including one caught while it is still swinging.
    origin = { x: e.clientX - lift.x, y: e.clientY - lift.y };

    // Where the grip is when the bell stands on the ledge, and how far the
    // lift may carry it from there before it leaves the room.
    const box = root.getBoundingClientRect();
    const homeX = box.left + GRIP.x * box.width - lift.x;
    const homeY = box.top + GRIP.y * box.height - lift.y;
    const bounds = altar.getBoundingClientRect();
    const inset = bounds.width * BOUND;
    limit = {
      minX: bounds.left + inset - homeX,
      maxX: bounds.right - inset - homeX,
      minY: bounds.top + inset - homeY,
      maxY: bounds.bottom - inset - homeY,
    };

    pointer = { x: e.clientX, y: e.clientY };
    down = { x: e.clientX, y: e.clientY };
    travelled = 0;
    carried = true;
    // Taking hold of one that is still muffling releases it again.
    stopping = false;
    root.classList.add('lifted');
    root.setPointerCapture(e.pointerId);
    warmBell();
    run();
  });

  root.addEventListener('pointermove', e => {
    if (!carried) return;
    pointer = { x: e.clientX, y: e.clientY };
    // Furthest from the press, not distance covered: a shaky hand on a tap
    // travels a long way without ever leaving the bell.
    travelled = Math.max(travelled, Math.hypot(e.clientX - down.x, e.clientY - down.y));
  });

  const release = (e: PointerEvent) => {
    if (!carried) return;
    carried = false;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    // It stays where it was let go of. This is the one thing on the altar that
    // does not go home by itself, and it is the whole point: you put the bell
    // down somewhere, set it going, and pick up a lamp.
    const snap = altar.getBoundingClientRect().width * HOME_SNAP;
    const home = Math.hypot(lift.x, lift.y) < snap;
    target = home ? { x: 0, y: 0 } : { x: lift.x, y: lift.y };

    if (travelled < CLICK_PX) setAuto(!auto);
    run();
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  return { root };
}
