type Script = 'iast' | 'devanagari' | 'malayalam';

/**
 * `crawl` streams the whole list upward the way the Star Wars opening does.
 * `single` holds one name at a time. Both play, pause and step; they differ
 * only in what the speed slider means and what drives the motion.
 */
type View = 'crawl' | 'single';

const LANG: Record<Script, string> = {
  iast: '',
  devanagari: 'hi',
  malayalam: 'ml',
};

// The slider is a speed, not a duration: 10 is fast in both views. It used to
// carry the interval in milliseconds, which made a fuller bar mean slower.
const SPEED_MIN = 1;
const SPEED_MAX = 10;

/** `single`: how long a name is held, at the slowest and fastest settings. */
const DWELL_SLOW_MS = 7000;
const DWELL_FAST_MS = 900;
/** `crawl`: how fast the column climbs, in CSS px per second. */
const CRAWL_SLOW_PX = 14;
const CRAWL_FAST_PX = 130;

/** Long enough for .japa-name to fade out before the text under it changes. */
const SWAP_MS = 300;

/** A backgrounded tab hands back a huge delta; without this the column jumps. */
const MAX_FRAME_S = 0.05;

interface JapaState {
  names: Record<Script, string[]>;
  script: Script;
  view: View;
  index: number;
  playing: boolean;
  speed: number;
  singleTimer: number | null;
  swapTimer: number | null;
  frame: number | null;
  lastFrame: number;
  /** Crawl scroll position in px, measured down the track from its own top. */
  offset: number;
  element: HTMLElement | null;
}

const state: JapaState = {
  names: { iast: [], devanagari: [], malayalam: [] },
  script: 'malayalam',
  view: 'crawl',
  index: 0,
  playing: true,
  speed: 5,
  singleTimer: null,
  swapTimer: null,
  frame: null,
  lastFrame: 0,
  offset: 0,
  element: null,
};

/**
 * Line height and list height, in px. The crawl converts freely between an
 * offset and an index, so both have to be exact — which is why .japa-crawl-name
 * is given a fixed height rather than being left to the font.
 */
const metrics = { line: 0, copy: 0 };

function names(): string[] {
  return state.names[state.script];
}

function q<T extends Element>(sel: string): T | null {
  return state.element?.querySelector<T>(sel) ?? null;
}

function bySpeed(slow: number, fast: number): number {
  const t = (state.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return slow + t * (fast - slow);
}

async function loadNames() {
  const files: Record<Script, string> = {
    iast: '/data/iast.txt',
    devanagari: '/data/devanagari.txt',
    malayalam: '/data/malayalam.txt',
  };

  for (const [script, path] of Object.entries(files)) {
    const res = await fetch(path);
    const text = await res.text();
    state.names[script as Script] = text.split('\n').filter(l => l.trim().length > 0);
  }
}

// ---------------------------------------------------------------- rendering

function buildTrack() {
  const track = q<HTMLElement>('.japa-crawl-track');
  if (!track) return;

  const lang = LANG[state.script];
  const frag = document.createDocumentFragment();
  // The list is laid out twice so the wrap at one list's height lands on
  // identical content and cannot be seen.
  for (let pass = 0; pass < 2; pass++) {
    for (const name of names()) {
      const p = document.createElement('p');
      p.className = 'japa-crawl-name';
      if (lang) p.lang = lang;
      p.textContent = name;
      frag.appendChild(p);
    }
  }
  track.replaceChildren(frag);
}

/** Only meaningful once the overlay is displayed; hidden, everything is 0. */
function measure() {
  const first = q<HTMLElement>('.japa-crawl-name');
  metrics.line = first?.offsetHeight ?? 0;
  metrics.copy = metrics.line * names().length;
}

function applyCrawl() {
  const track = q<HTMLElement>('.japa-crawl-track');
  if (!track) return;

  const { copy, line } = metrics;
  if (copy > 0) {
    // Held in [0, 2*copy) so the visible window always has track above it to
    // read from. Stepping back past zero wraps to the end of the list.
    while (state.offset >= 2 * copy) state.offset -= copy;
    while (state.offset < 0) state.offset += copy;
  }
  track.style.transform = `translateY(${-state.offset}px)`;

  const total = names().length;
  if (line > 0 && total > 0) {
    const idx = ((Math.floor(state.offset / line) % total) + total) % total;
    if (idx !== state.index) {
      state.index = idx;
      updateCounter();
    }
  }
}

function updateName() {
  const nameEl = q<HTMLElement>('.japa-name');
  if (!nameEl) return;

  if (state.swapTimer !== null) clearTimeout(state.swapTimer);
  nameEl.classList.remove('visible');
  nameEl.lang = LANG[state.script];
  state.swapTimer = window.setTimeout(() => {
    nameEl.textContent = names()[state.index] ?? '';
    nameEl.classList.add('visible');
    state.swapTimer = null;
  }, SWAP_MS);
}

function updateCounter() {
  const el = q<HTMLElement>('.japa-counter');
  const total = names().length;
  if (el && total > 0) el.textContent = `${state.index + 1} / ${total}`;
}

function updatePlayButton() {
  const btn = q<HTMLElement>('.japa-play');
  if (btn) {
    btn.textContent = state.playing ? '⏸' : '▶';
    btn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }
}

// ------------------------------------------------------------------ driving

function tick(now: number) {
  if (!state.playing || state.view !== 'crawl') {
    state.frame = null;
    return;
  }
  const dt = state.lastFrame ? Math.min((now - state.lastFrame) / 1000, MAX_FRAME_S) : 0;
  state.lastFrame = now;
  state.offset += bySpeed(CRAWL_SLOW_PX, CRAWL_FAST_PX) * dt;
  applyCrawl();
  state.frame = requestAnimationFrame(tick);
}

function stopDrivers() {
  if (state.singleTimer !== null) {
    clearInterval(state.singleTimer);
    state.singleTimer = null;
  }
  if (state.frame !== null) {
    cancelAnimationFrame(state.frame);
    state.frame = null;
  }
  state.lastFrame = 0;
}

/** Restarts whichever driver the current view needs. Safe to call repeatedly. */
function syncDriver() {
  stopDrivers();
  if (!state.playing || !state.element?.classList.contains('active')) return;

  if (state.view === 'crawl') {
    state.frame = requestAnimationFrame(tick);
  } else {
    state.singleTimer = window.setInterval(() => step(1), bySpeed(DWELL_SLOW_MS, DWELL_FAST_MS));
  }
}

function setPlaying(playing: boolean) {
  state.playing = playing;
  updatePlayButton();
  syncDriver();
}

function step(dir: 1 | -1) {
  const total = names().length;
  if (total === 0) return;

  if (state.view === 'crawl') {
    state.offset += dir * metrics.line;
    applyCrawl();
  } else {
    state.index = ((state.index + dir) % total + total) % total;
    updateName();
    updateCounter();
  }
}

function setView(view: View) {
  state.view = view;
  const el = state.element;
  if (!el) return;

  el.classList.toggle('view-crawl', view === 'crawl');
  el.classList.toggle('view-single', view === 'single');
  el.querySelectorAll<HTMLElement>('.japa-view').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if (view === 'crawl') {
    // The crawl was display:none until the class flip above, so it could not
    // be measured before now.
    measure();
    // Enter where the other view left off, rather than snapping to the top.
    state.offset = metrics.line * state.index;
    applyCrawl();
  } else {
    updateName();
  }
  updateCounter();
  syncDriver();
}

function setScript(script: Script) {
  state.script = script;
  buildTrack();
  measure();
  if (state.view === 'crawl') applyCrawl();
  else updateName();
  updateCounter();
}

// -------------------------------------------------------------------- setup

export async function initJapaMode(container: HTMLElement) {
  await loadNames();

  const el = document.createElement('div');
  el.className = 'japa-overlay mode-overlay view-crawl';
  el.id = 'mode-japa';
  el.innerHTML = `
    <div class="japa-stage">
      <div class="japa-crawl">
        <div class="japa-crawl-stage">
          <div class="japa-crawl-track"></div>
        </div>
      </div>
      <div class="japa-display">
        <p class="japa-name visible"></p>
      </div>
    </div>
    <p class="japa-counter">1 / ${names().length}</p>
    <div class="japa-controls">
      <div class="japa-scripts">
        <button class="japa-script active" data-script="malayalam">മല</button>
        <button class="japa-script" data-script="iast">IAST</button>
        <button class="japa-script" data-script="devanagari">देव</button>
      </div>
      <div class="japa-views">
        <button class="japa-view active" data-view="crawl">Stream</button>
        <button class="japa-view" data-view="single">Single</button>
      </div>
      <div class="japa-playback">
        <button class="japa-back" aria-label="Previous name">←</button>
        <button class="japa-play" aria-label="Pause">⏸</button>
        <button class="japa-advance" aria-label="Next name">→</button>
        <input
          type="range" class="japa-speed" aria-label="Speed"
          min="${SPEED_MIN}" max="${SPEED_MAX}" step="1" value="${state.speed}"
        />
      </div>
    </div>
  `;

  container.appendChild(el);
  state.element = el;

  buildTrack();
  updateName();
  updateCounter();
  updatePlayButton();

  el.querySelector('.japa-back')!.addEventListener('click', () => step(-1));
  el.querySelector('.japa-advance')!.addEventListener('click', () => step(1));
  el.querySelector('.japa-play')!.addEventListener('click', () => setPlaying(!state.playing));

  el.querySelector('.japa-speed')!.addEventListener('input', (e) => {
    state.speed = parseInt((e.target as HTMLInputElement).value, 10);
    // The crawl reads the speed every frame; only the interval needs rebuilding.
    if (state.view === 'single') syncDriver();
  });

  el.querySelectorAll<HTMLElement>('.japa-view').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view as View));
  });

  el.querySelectorAll<HTMLElement>('.japa-script').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.japa-script').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setScript(btn.dataset.script as Script);
    });
  });

  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.japa-controls')) return;
    // Tap-anywhere belongs to the single view; in the crawl it would fight
    // the scroll it is meant to be reading.
    if (state.view === 'single') step(1);
  });

  window.addEventListener('resize', () => {
    if (state.view !== 'crawl' || !el.classList.contains('active')) return;
    const wasIndex = state.index;
    measure();
    state.offset = metrics.line * wasIndex;
    applyCrawl();
  });
}

/**
 * Called when japa becomes the active mode. Nothing can be measured before
 * this point — the overlay is display:none until then, so every height is 0.
 */
export function activateJapa() {
  if (!state.element) return;
  measure();
  if (state.view === 'crawl') applyCrawl();
  else updateName();
  updateCounter();
  syncDriver();
}

/** Stops the motion but keeps play/pause, so returning resumes where it was. */
export function destroyJapa() {
  stopDrivers();
}
