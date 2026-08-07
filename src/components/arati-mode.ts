import { GRIP, type AratiLamp } from './arati-lamp';
import { initAratiLyrics } from './arati-lyrics';
import { createAratiPlayer } from './arati-player';
import type { Mode } from './lotus-nav';

/**
 * Ārati.
 *
 * A recording of the ārati plays in the corner, and either of the two lamps
 * standing on the shelves can be picked up and waved before her for as long as
 * the visitor wants. Those two are deliberately not wired to each other:
 * nothing waits for the video, nothing counts bars, the wave does not start or
 * stop with playback. The rite is the visitor's to perform; the recording is
 * what the room sounds like while they perform it.
 *
 * The lamps waved are the ones already on the wall, not a third lamp the mode
 * conjures. Taking the lamp down off its shelf is half of what makes it read
 * as ārati rather than as a widget — the shelf is visibly empty while you hold
 * it, and the lamp goes back when you let go.
 *
 * The whole wave is `setLift` + `setTilt` + `setDrag` from arati-lamp.ts and
 * nothing else. No canvas, no physics engine, no reparenting.
 *
 * The words are the third thing here, hidden behind a button, and they are the
 * one part that *is* wired to the recording — arati-lyrics.ts, over the
 * channel arati-player.ts opens. That does not contradict the paragraph above.
 * The wave is the visitor's own offering and has no right answer; the words
 * are what is being sung this second, and there is exactly one of those.
 *
 * ## The rite outlives the mode
 *
 * An ārati is not a screen you are looking at, it is something happening in
 * the room, and things are done to the altar while it happens: she is
 * garlanded, and the photo she is being sung to may be changed. So the
 * recording and the words hold their corner of the screen for as long as the
 * recording plays, whatever mode is selected, and only a pause stops them.
 *
 * What that costs is the other three modes: japa, teachings and sound all take
 * the whole room — the first two under a full-screen scrim, and the third by
 * singing over her. Those are shut while the recording plays (ONGOING), which
 * is the same statement read the other way round: what stays open is exactly
 * what can be done *during* an ārati.
 *
 * The earlier rule was that leaving the mode paused the recording, and the
 * reason was sound: a hidden iframe keeps playing, and the audio would follow
 * you into japa with nothing on screen to explain it or turn it off. That
 * reason is answered better here — the player is never hidden while it plays,
 * so there is always something on screen to turn it off with.
 */

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

/**
 * The modes an ārati in progress closes off. Japa and teachings drop a
 * full-screen scrim over the altar; sound sings over her. None of the three is
 * something anyone does *during* an ārati, and what is left out of this list —
 * photo and garland — is exactly what they do.
 */
const ONGOING: readonly Mode[] = ['japa', 'teachings', 'sound'];

let selectArati: ((selected: boolean) => void) | null = null;

/**
 * Tells ārati whether it is the mode the visitor has chosen.
 *
 * Not the same question as whether the ārati is on screen: the recording keeps
 * its corner for as long as it plays, so this only decides whether the panel
 * is shown when nothing is playing. Call it after the overlay's `.active` has
 * been settled — it measures the lyric column, and everything inside a
 * display:none overlay measures 0.
 *
 * The lamps are live in every mode, like the bell, and are not gated here.
 */
export function setAratiMode(selected: boolean) {
  selectArati?.(selected);
}

export function initAratiMode(
  room: HTMLElement,
  altar: HTMLElement,
  lamps: readonly AratiLamp[],
  /** Called with the modes that are unavailable while the ārati runs. */
  onShut: (modes: readonly Mode[]) => void,
) {
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

  /**
   * The recording, and the words that follow it.
   *
   * The player is built on first entry, never at init — the same rule the
   * sound beds follow: a visitor who never opens ārati mode never talks to
   * YouTube at all, and the room's first paint is not waiting on a third-party
   * frame. The lyrics panel is built now but stays hidden until asked for; it
   * is three files of text and no network at all.
   */
  const player = createAratiPlayer(panel.querySelector<HTMLElement>('.arati-player')!);
  const lyrics = initAratiLyrics(panel, player);

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

  /** Is ārati the mode the visitor has chosen? Not the same as being visible. */
  let selected = false;

  /**
   * Puts the ārati on screen if it is either chosen or playing, and shuts the
   * modes it cannot share the room with while it plays.
   *
   * Both halves have to run on a state change as well as on a mode change,
   * hence `player.onChange` below: pressing play in YouTube's own controls has
   * to close the other petals, and pausing has to hand them back.
   */
  function sync() {
    const playing = player.playing();
    panel.classList.toggle('active', selected || playing);
    // What is left on screen when the ārati plays on under another mode is the
    // recording and the words, not the two lines of instruction: those belong
    // to the mode you chose, and over a photo you came to look at they are
    // just captions in the way.
    panel.classList.toggle('chosen', selected);
    // Only once `.active` is on: the lyric column measures itself, and every
    // height inside a display:none overlay reads 0. A zeroed measurement does
    // not go stale, it freezes the column dead.
    if (selected || playing) lyrics.activate();
    onShut(playing ? ONGOING : []);
  }

  player.onChange(sync);

  selectArati = next => {
    selected = next;
    // Mounted on first entry and never at init, so a visitor who does not open
    // ārati mode never talks to YouTube at all.
    if (next) player.mount();
    sync();
  };
}
