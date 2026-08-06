import source from '../../docs/teachings.md?raw';

/**
 * Amma's teachings.
 *
 * The words come from docs/teachings.md, read at build time. That file is the
 * only copy on purpose: words attributed to Amma are exactly the thing that
 * gets paraphrased into something she never said, so there is one place to
 * check them against and nothing in here for them to drift from.
 *
 * Two views over that list, the pair japa offers. `single` holds one teaching
 * and you click for the next; `stream` sends the whole list climbing up the
 * screen. Single is the default and — unlike japa — it does not play on its
 * own. A name is a syllable you repeat; a teaching is a sentence, and only the
 * reader knows when they have finished it.
 */

type View = 'single' | 'stream';

/**
 * Blank-line separated blocks, whitespace normalised, duplicates dropped. The
 * file repeats one teaching today and any page of quotes scraped into it will
 * do the same, and the same sentence twice in a rising column is glaring.
 */
const TEACHINGS: readonly string[] = Array.from(
  new Set(
    source
      .split(/\n\s*\n/)
      .map(block => block.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  ),
);

// The slider is a speed, as in japa: right is faster.
const SPEED_MIN = 1;
const SPEED_MAX = 10;

/**
 * How fast the column climbs, in CSS px per second. Slower at both ends than
 * the japa crawl's 14–66: those are three-word names and these are sentences,
 * and a line of prose has to be read rather than recognised.
 */
const STREAM_SLOW_PX = 8;
const STREAM_FAST_PX = 40;

/** Long enough for .teachings-quote to fade before the text under it changes. */
const SWAP_MS = 400;

/** A backgrounded tab hands back a huge delta; without this the column jumps. */
const MAX_FRAME_S = 0.05;

/**
 * The reading line, as a fraction of the stage's height above its bottom edge.
 * A teaching becomes the current one once it has climbed this far.
 *
 * It is one constant doing two jobs, and they have to agree: `seekIndex` puts
 * a teaching here and `indexAt` reads one back off the offset. Derive them
 * from different lines and the counter disagrees with itself the moment you
 * step. It also has to sit inside the clear part of the stream's mask, or the
 * teaching being counted is one you cannot yet read.
 */
const READ_LINE = 0.45;

interface TeachingsState {
  view: View;
  index: number;
  playing: boolean;
  speed: number;
  /** Stream scroll position in px, measured down the track from its own top. */
  offset: number;
  frame: number | null;
  lastFrame: number;
  swapTimer: number | null;
  element: HTMLElement | null;
}

const state: TeachingsState = {
  view: 'single',
  index: 0,
  playing: false,
  speed: 4,
  offset: 0,
  frame: null,
  lastFrame: 0,
  swapTimer: null,
  element: null,
};

/**
 * Where each teaching sits down the track, and how tall one copy of the list
 * is. Measured rather than computed: unlike japa's names these wrap to
 * different numbers of lines, so there is no single row height to divide by.
 */
const metrics = { tops: [] as number[], copy: 0, read: 0 };

function q<T extends Element>(sel: string): T | null {
  return state.element?.querySelector<T>(sel) ?? null;
}

function bySpeed(slow: number, fast: number): number {
  const t = (state.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return slow + t * (fast - slow);
}

// ---------------------------------------------------------------- rendering

function buildTrack() {
  const track = q<HTMLElement>('.teachings-stream-track');
  if (!track) return;
  const frag = document.createDocumentFragment();
  // Laid out twice, so the wrap at one list's height lands on identical
  // content and cannot be seen.
  for (let pass = 0; pass < 2; pass++) {
    for (const teaching of TEACHINGS) {
      const p = document.createElement('blockquote');
      p.className = 'teachings-stream-quote';
      p.textContent = teaching;
      frag.appendChild(p);
    }
  }
  track.replaceChildren(frag);
}

/** Only meaningful once the overlay is displayed; hidden, everything is 0. */
function measure() {
  const track = q<HTMLElement>('.teachings-stream-track');
  const stage = q<HTMLElement>('.teachings-stream');
  if (!track || !stage) return;
  const quotes = Array.from(track.children) as HTMLElement[];
  metrics.tops = quotes.slice(0, TEACHINGS.length).map(el => el.offsetTop);
  // The second copy's first element gives one list exactly, rather than
  // halving a rounded total.
  metrics.copy = quotes[TEACHINGS.length]?.offsetTop ?? 0;
  metrics.read = stage.clientHeight * READ_LINE;
}

/** Which teaching has reached the reading line. The inverse of `seekIndex`. */
function indexAt(offset: number): number {
  const { tops, copy, read } = metrics;
  if (copy <= 0 || tops.length === 0) return state.index;
  const p = (((offset - read) % copy) + copy) % copy;
  let i = 0;
  while (i + 1 < tops.length && tops[i + 1] <= p) i++;
  return i;
}

/** Put the current teaching on the reading line. */
function seekIndex() {
  state.offset = (metrics.tops[state.index] ?? 0) + metrics.read;
}

/**
 * Lands the stream on a teaching without letting a step that wraps past
 * either end of the list look like a jump back through the whole column.
 */
function seekTo(index: number, dir: 1 | -1) {
  const { tops, copy, read } = metrics;
  if (copy <= 0) return;
  const base = Math.floor((state.offset - read) / copy) * copy;
  let target = base + (tops[index] ?? 0) + read;
  if (dir > 0 && target < state.offset) target += copy;
  if (dir < 0 && target > state.offset) target -= copy;
  state.offset = target;
}

function applyStream() {
  const track = q<HTMLElement>('.teachings-stream-track');
  if (!track) return;

  const { copy } = metrics;
  if (copy > 0) {
    // Held in [0, 2*copy) so the visible window always has track above it to
    // read from. Stepping back past zero wraps to the end of the list.
    while (state.offset >= 2 * copy) state.offset -= copy;
    while (state.offset < 0) state.offset += copy;
  }
  track.style.transform = `translateY(${-state.offset}px)`;

  const at = indexAt(state.offset);
  if (at !== state.index) {
    state.index = at;
    updateCounter();
  }
}

function updateQuote() {
  const el = q<HTMLElement>('.teachings-quote');
  if (!el) return;
  const teaching = TEACHINGS[state.index] ?? '';
  if (state.swapTimer !== null) clearTimeout(state.swapTimer);
  el.classList.remove('visible');
  state.swapTimer = window.setTimeout(() => {
    el.textContent = teaching;
    el.classList.add('visible');
    state.swapTimer = null;
  }, SWAP_MS);
}

function updateCounter() {
  const el = q<HTMLElement>('.teachings-counter');
  if (el) el.textContent = `${state.index + 1} / ${TEACHINGS.length}`;
}

function updatePlayButton() {
  const btn = q<HTMLElement>('.teachings-play');
  if (btn) {
    btn.textContent = state.playing ? '⏸' : '▶';
    btn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }
}

// ------------------------------------------------------------------ driving

function tick(now: number) {
  if (!state.playing || state.view !== 'stream') {
    state.frame = null;
    return;
  }
  const dt = state.lastFrame ? Math.min((now - state.lastFrame) / 1000, MAX_FRAME_S) : 0;
  state.lastFrame = now;
  state.offset += bySpeed(STREAM_SLOW_PX, STREAM_FAST_PX) * dt;
  applyStream();
  state.frame = requestAnimationFrame(tick);
}

function stopDriver() {
  if (state.frame !== null) {
    cancelAnimationFrame(state.frame);
    state.frame = null;
  }
  state.lastFrame = 0;
}

/** Restarts the stream if it should be running. Safe to call repeatedly. */
function syncDriver() {
  stopDriver();
  if (!state.playing || state.view !== 'stream') return;
  if (!state.element?.classList.contains('active')) return;
  state.frame = requestAnimationFrame(tick);
}

function setPlaying(playing: boolean) {
  state.playing = playing;
  updatePlayButton();
  syncDriver();
}

function step(dir: 1 | -1) {
  const total = TEACHINGS.length;
  if (total === 0) return;
  const next = (((state.index + dir) % total) + total) % total;

  if (state.view === 'stream') {
    seekTo(next, dir);
    applyStream();
  } else {
    state.index = next;
    updateQuote();
    updateCounter();
  }
}

function setView(view: View) {
  state.view = view;
  const el = state.element;
  if (!el) return;

  el.classList.toggle('view-single', view === 'single');
  el.classList.toggle('view-stream', view === 'stream');
  el.querySelectorAll<HTMLElement>('.teachings-view').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if (view === 'stream') {
    // The stream was display:none until the class flip above, so it could not
    // be measured before now.
    measure();
    // Enter where the other view left off, rather than snapping to the top.
    seekIndex();
    applyStream();
  } else {
    updateQuote();
  }
  updateCounter();
  syncDriver();
}

// -------------------------------------------------------------------- setup

export function initTeachingsMode(container: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'teachings-overlay mode-overlay view-single';
  el.id = 'mode-teachings';
  el.innerHTML = `
    <div class="teachings-stage">
      <div class="teachings-stream">
        <div class="teachings-stream-track"></div>
      </div>
      <div class="teachings-display">
        <blockquote class="teachings-quote visible"></blockquote>
        <p class="teachings-attr">— Amma</p>
      </div>
    </div>
    <p class="teachings-counter"></p>
    <div class="teachings-controls">
      <div class="teachings-views">
        <button class="teachings-view active" data-view="single">Single</button>
        <button class="teachings-view" data-view="stream">Stream</button>
      </div>
      <div class="teachings-playback">
        <button class="teachings-back" aria-label="Previous teaching">←</button>
        <button class="teachings-advance" aria-label="Next teaching">→</button>
        <button class="teachings-play" aria-label="Play">▶</button>
        <input
          type="range" class="teachings-speed" aria-label="Speed"
          min="${SPEED_MIN}" max="${SPEED_MAX}" step="1" value="${state.speed}"
        />
      </div>
    </div>
  `;

  container.appendChild(el);
  state.element = el;

  buildTrack();
  // As text, not interpolated into the markup above: these are sentences from
  // a file, and the one place a stray < or & would land is the one place it
  // must not.
  el.querySelector('.teachings-quote')!.textContent = TEACHINGS[0] ?? '';
  updateCounter();
  updatePlayButton();

  el.querySelector('.teachings-back')!.addEventListener('click', () => step(-1));
  el.querySelector('.teachings-advance')!.addEventListener('click', () => step(1));
  el.querySelector('.teachings-play')!.addEventListener('click', () => setPlaying(!state.playing));

  // The stream reads the speed every frame, so there is nothing to rebuild.
  el.querySelector('.teachings-speed')!.addEventListener('input', e => {
    state.speed = parseInt((e.target as HTMLInputElement).value, 10);
  });

  el.querySelectorAll<HTMLElement>('.teachings-view').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view as View));
  });

  el.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.teachings-controls')) return;
    // Tap-anywhere belongs to the single view; in the stream it would fight
    // the column it is meant to be reading.
    if (state.view === 'single') step(1);
  });

  window.addEventListener('resize', () => {
    if (state.view !== 'stream' || !el.classList.contains('active')) return;
    measure();
    seekIndex();
    applyStream();
  });
}

/**
 * Called when teachings becomes the active mode. Nothing in the stream can be
 * measured before this point — the overlay is display:none until then, so
 * every height reads 0.
 */
export function activateTeachings() {
  if (!state.element) return;
  if (state.view === 'stream') {
    measure();
    seekIndex();
    applyStream();
  }
  updateCounter();
  syncDriver();
}

/** Stops the motion but keeps play/pause, so returning resumes where it was. */
export function destroyTeachings() {
  stopDriver();
}
