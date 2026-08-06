import { GRIP, type AratiLamp } from './arati-lamp';

/**
 * Ārati.
 *
 * A recording of the ārati plays in the corner, and either of the two lamps
 * standing on the shelves can be picked up and waved before her for as long as
 * the visitor wants. Those are the only two things in the mode, and they are
 * deliberately not wired to each other: nothing waits for the video, nothing
 * counts bars, the wave does not start or stop with playback. The rite is the
 * visitor's to perform; the recording is what the room sounds like while they
 * perform it.
 *
 * The lamps waved are the ones already on the wall, not a third lamp the mode
 * conjures. Taking the lamp down off its shelf is half of what makes it read
 * as ārati rather than as a widget — the shelf is visibly empty while you hold
 * it, and the lamp goes back when you let go.
 *
 * The whole wave is `setLift` + `setTilt` + `setDrag` from arati-lamp.ts and
 * nothing else. No canvas, no physics engine, no reparenting.
 */

/** docs/arati-youtube.md. Cheap to change, so it is one constant. */
const VIDEO_ID = 'tqMBR5lLUHI';

/**
 * How much of the gap to the hand the lamp closes each frame.
 *
 * Below 1 it lags behind the pointer, and that lag is the whole illusion of
 * weight — it is also where the velocity the tilt and the drag read comes
 * from. At 1 the lamp is nailed to the cursor and never leans at all.
 */
const FOLLOW = 0.2;

/**
 * Lean per pixel travelled in a frame, and the ceiling on it.
 *
 * The lamp leads with its top, the way a wrist-led sweep actually carries one:
 * moving right, it turns clockwise. The flames lean the other way (DRAG) and
 * less far, because a flame trails the air it is dragged through. Those two
 * signs being opposite is most of why the wave reads as motion rather than as
 * a rotating picture.
 */
const TILT_PER_PX = 1.6;
const MAX_TILT = 34;
const DRAG_PER_PX = 0.9;
const MAX_DRAG = 18;

/** How fast the two angles chase their targets. Lower is more languid. */
const EASE = 0.25;

/** Under this, in px and in degrees, the lamp is home and the loop can stop. */
const EPS = 0.04;

/** Clearance kept between the carried lamp's grip and the edge of the room. */
const BOUND = 0.04;

interface Wave {
  readonly lamp: AratiLamp;
  /** Offset from the shelf, px. */
  x: number;
  y: number;
  tilt: number;
  drag: number;
  /** Lift bounds, computed at pickup so the lamp cannot leave the room. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Page point that maps to the current lift, fixed at pickup. */
  originX: number;
  originY: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

interface AratiMode {
  activate(): void;
  deactivate(): void;
}

let mode: AratiMode | null = null;

/**
 * Entering ārati mounts the player; leaving pauses it.
 *
 * The lamps themselves are live in every mode, like the bell — where a mode
 * owns their patch of screen (the garland canvas, the overlays) it already
 * sits above the shelves, so nothing needs gating here. Only the recording
 * belongs to the mode.
 */
export function setAratiActive(active: boolean) {
  if (!mode) return;
  if (active) mode.activate();
  else mode.deactivate();
}

export function initAratiMode(room: HTMLElement, altar: HTMLElement, lamps: readonly AratiLamp[]) {
  const panel = document.createElement('div');
  panel.className = 'arati-overlay mode-overlay';
  panel.id = 'mode-arati';
  // Two lines, because neither gesture is one anybody would guess at, and the
  // bell's second one least of all — nothing about a still bell says that
  // clicking it leaves it going. The bell itself is live in every mode; only
  // this explanation of it belongs to arati.
  panel.innerHTML = `
    <div class="arati-player"></div>
    <p class="arati-hint">Take either lamp from its shelf and wave it before her.</p>
    <p class="arati-hint">Drag the bell to ring it. Click it to leave it ringing
      while you wave, click again to stop, and set it down wherever you like.</p>
  `;
  room.appendChild(panel);

  const player = panel.querySelector<HTMLElement>('.arati-player')!;
  let frame: HTMLIFrameElement | null = null;

  /**
   * The player is built on first entry, never at init.
   *
   * Same rule the sound beds follow: a visitor who never opens ārati mode
   * never talks to YouTube at all, and the room's first paint is not waiting
   * on a third-party frame. `enablejsapi` is what makes `pause()` below work.
   */
  function mount() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = 'Ārati';
    frame.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture';
    frame.setAttribute('allowfullscreen', '');
    // youtube-nocookie: no tracking cookie until the visitor presses play.
    // No autoplay parameter anywhere — the visitor starts the ārati.
    frame.src =
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}` +
      `?enablejsapi=1&rel=0&modestbranding=1&playsinline=1` +
      `&origin=${encodeURIComponent(window.location.origin)}`;
    player.appendChild(frame);
  }

  /**
   * Stop the recording when the visitor leaves the mode.
   *
   * The overlay goes `display: none` around the iframe, and a hidden YouTube
   * frame keeps playing — the audio would follow you into japa with nothing on
   * screen to explain it or turn it off. So the frame is left mounted, keeping
   * its position for when you come back, and told to pause over the postMessage
   * channel `enablejsapi=1` opens.
   *
   * This is the one place where sound mode's rule is deliberately inverted.
   * The beds are ambience and outlive their panel on purpose; the ārati is a
   * rite with a beginning and an end, and it belongs to its own mode.
   */
  function pause() {
    frame?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
      'https://www.youtube-nocookie.com',
    );
  }

  const waves: Wave[] = lamps.map(lamp => ({
    lamp,
    x: 0,
    y: 0,
    tilt: 0,
    drag: 0,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    originX: 0,
    originY: 0,
  }));

  let carried: Wave | null = null;
  let pointer = { x: 0, y: 0 };
  let running = false;

  function tick() {
    let moving = false;

    for (const w of waves) {
      const held = carried === w;
      const tx = held ? clamp(pointer.x - w.originX, w.minX, w.maxX) : 0;
      const ty = held ? clamp(pointer.y - w.originY, w.minY, w.maxY) : 0;

      const nx = w.x + (tx - w.x) * FOLLOW;
      const ny = w.y + (ty - w.y) * FOLLOW;
      // Speed this frame, which is what both angles are read off. Horizontal
      // only: a lamp raised straight up does not lean, and a flame lifted
      // vertically is compressed rather than swept aside.
      const vx = nx - w.x;
      w.x = nx;
      w.y = ny;

      w.tilt += (clamp(vx * TILT_PER_PX, -MAX_TILT, MAX_TILT) - w.tilt) * EASE;
      w.drag += (clamp(-vx * DRAG_PER_PX, -MAX_DRAG, MAX_DRAG) - w.drag) * EASE;

      const settled =
        Math.abs(w.x) < EPS &&
        Math.abs(w.y) < EPS &&
        Math.abs(w.tilt) < EPS &&
        Math.abs(w.drag) < EPS;

      if (!held && settled) {
        // Snap to exact zero rather than leaving a hundredth of a degree on
        // the element: the lamp is standing on its shelf again, and a resting
        // altar should hold no state from a wave that finished.
        w.x = w.y = w.tilt = w.drag = 0;
        w.lamp.root.classList.remove('lifted');
      } else {
        moving = true;
      }

      w.lamp.setLift(w.x, w.y);
      w.lamp.setTilt(w.tilt);
      w.lamp.setDrag(w.drag);
    }

    // Same bargain the garlands strike: once every lamp is back on its shelf
    // the loop stops, so an altar nobody is waving at costs nothing.
    if (moving) requestAnimationFrame(tick);
    else running = false;
  }

  function run() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  for (const w of waves) {
    const root = w.lamp.root;

    root.addEventListener('pointerdown', e => {
      if (carried) return;
      e.preventDefault();
      e.stopPropagation();

      // The point under the hand keeps its lift, so the lamp never jumps on
      // being taken — including when it is caught halfway back to its shelf.
      w.originX = e.clientX - w.x;
      w.originY = e.clientY - w.y;

      // Where the grip is when the lamp stands at rest, and how far the lift
      // may carry it from there before the lamp leaves the room.
      const box = root.getBoundingClientRect();
      const homeX = box.left + GRIP.x * box.width - w.x;
      const homeY = box.top + GRIP.y * box.height - w.y;
      const bounds = altar.getBoundingClientRect();
      const inset = bounds.width * BOUND;
      w.minX = bounds.left + inset - homeX;
      w.maxX = bounds.right - inset - homeX;
      w.minY = bounds.top + inset - homeY;
      w.maxY = bounds.bottom - inset - homeY;

      pointer = { x: e.clientX, y: e.clientY };
      carried = w;
      root.classList.add('lifted');
      root.setPointerCapture(e.pointerId);
      run();
    });

    root.addEventListener('pointermove', e => {
      if (carried !== w) return;
      pointer = { x: e.clientX, y: e.clientY };
    });

    const release = (e: PointerEvent) => {
      if (carried !== w) return;
      carried = null;
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
      // .lifted stays on until the loop finds it home, so the lamp keeps its
      // glow and its raised stacking order all the way back down.
      run();
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
  }

  mode = {
    activate() {
      mount();
    },
    deactivate() {
      pause();
    },
  };
}
