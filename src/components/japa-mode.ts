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
/**
 * `crawl`: how fast the column climbs, in CSS px per second. The top used to
 * be 130, which put the midpoint at ~66 — already past reading speed, so the
 * whole upper half of the slider was unusable. 66 is now the ceiling.
 */
const CRAWL_SLOW_PX = 14;
const CRAWL_FAST_PX = 66;

/** Long enough for .japa-name to fade out before the text under it changes. */
const SWAP_MS = 300;

/** A backgrounded tab hands back a huge delta; without this the column jumps. */
const MAX_FRAME_S = 0.05;

/**
 * Rows of the opening verse already risen when the crawl is sitting at rest.
 * Nothing plays until asked now, so an offset of zero would park the column
 * off the bottom of the stage and show a blank screen. Keep it inside the
 * first dhyana verse: it doubles as where `single` opens.
 */
const REST_ROWS = 4;

/** What the picker offers, and enough to label it without fetching the texts. */
interface MantraInfo {
  id: string;
  count: number;
  title: Record<Script, string>;
}

/** One mantra in one script, as built by tools/build-japa.py. */
interface MantraText {
  title: string;
  dhyanamLabel: string;
  /** Verses, lines joined by \n. Always chanted before the names. */
  dhyanam: string[];
  /** Names, or — for the stotram — verses, again \n-joined. */
  names: string[];
}

/** One thing the japa steps through. `number` is 1-based, or 0 for a dhyana
 *  verse, which is chanted but not counted. */
interface Unit {
  lines: string[];
  number: number;
}

/**
 * One line of the crawl, including the blank one that follows a verse. Every
 * row is exactly --japa-line tall, which is what lets a multi-line verse live
 * in the same column as a one-line name without the offset-to-index division
 * needing to know the difference.
 */
interface Row {
  text: string;
  unit: number;
  verse: boolean;
}

interface JapaState {
  catalogue: MantraInfo[];
  texts: Map<string, MantraText>;
  /** The text being fetched. A slow fetch that lands late is discarded. */
  pending: string;
  mantra: string;
  script: Script;
  view: View;
  units: Unit[];
  rows: Row[];
  /** First row of each unit, so a step can land on a unit boundary. */
  unitRow: number[];
  index: number;
  playing: boolean;
  /** Nothing has been played since the last reset, so the crawl sits back. */
  resting: boolean;
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
  catalogue: [],
  texts: new Map(),
  pending: '',
  mantra: 'trishati',
  script: 'malayalam',
  view: 'crawl',
  units: [],
  rows: [],
  unitRow: [],
  index: 0,
  playing: false,
  resting: true,
  speed: 5,
  singleTimer: null,
  swapTimer: null,
  frame: null,
  lastFrame: 0,
  offset: 0,
  element: null,
};

/**
 * Line height and track height, in px. The crawl converts freely between an
 * offset and a row, so both have to be exact — which is why .japa-crawl-name
 * is given a fixed height rather than being left to the font.
 */
const metrics = { line: 0, copy: 0 };

function text(): MantraText | undefined {
  return state.texts.get(`${state.mantra}-${state.script}`);
}

function q<T extends Element>(sel: string): T | null {
  return state.element?.querySelector<T>(sel) ?? null;
}

function bySpeed(slow: number, fast: number): number {
  const t = (state.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return slow + t * (fast - slow);
}

// ------------------------------------------------------------------ loading

async function loadCatalogue() {
  const res = await fetch('/data/japa/index.json');
  state.catalogue = (await res.json()).mantras as MantraInfo[];
}

/** Texts are fetched the first time they are shown, not up front: the
 *  sahasranama alone is a hundred times the trishati. */
async function loadText(key: string) {
  if (state.texts.has(key)) return;
  const res = await fetch(`/data/japa/${key}.json`);
  state.texts.set(key, (await res.json()) as MantraText);
}

/** Flattens the current text into units and then into crawl rows. */
function rebuild() {
  const t = text();
  const units: Unit[] = [];
  if (t) {
    for (const verse of t.dhyanam) units.push({ lines: verse.split('\n'), number: 0 });
    t.names.forEach((name, i) => units.push({ lines: name.split('\n'), number: i + 1 }));
  }

  const rows: Row[] = [];
  const unitRow: number[] = [];
  units.forEach((unit, u) => {
    unitRow.push(rows.length);
    const verse = unit.lines.length > 1;
    for (const line of unit.lines) rows.push({ text: line, unit: u, verse });
    // Verses need air around them to read as verses. Names are a list, and a
    // blank row between each would only stretch the column out.
    if (verse) rows.push({ text: '', unit: u, verse });
  });

  state.units = units;
  state.rows = rows;
  state.unitRow = unitRow;
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
    for (const row of state.rows) {
      const p = document.createElement('p');
      p.className = row.verse ? 'japa-crawl-name verse' : 'japa-crawl-name';
      if (lang) p.lang = lang;
      p.textContent = row.text;
      frag.appendChild(p);
    }
  }
  track.replaceChildren(frag);
}

/** Only meaningful once the overlay is displayed; hidden, everything is 0. */
function measure() {
  const first = q<HTMLElement>('.japa-crawl-name');
  metrics.line = first?.offsetHeight ?? 0;
  metrics.copy = metrics.line * state.rows.length;
}

/**
 * Puts the current unit on the reading line — the bottom edge, where a row
 * enters. At rest the column is nudged up by the opening verse, so there is
 * something on screen before anything has been played.
 */
function seekIndex() {
  state.offset = (state.unitRow[state.index] ?? 0) * metrics.line;
  if (state.resting) state.offset += REST_ROWS * metrics.line;
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

  const total = state.rows.length;
  if (line > 0 && total > 0) {
    const row = ((Math.floor(state.offset / line) % total) + total) % total;
    const unit = state.rows[row].unit;
    if (unit !== state.index) {
      state.index = unit;
      updateCounter();
    }
  }
}

function updateName() {
  const nameEl = q<HTMLElement>('.japa-name');
  if (!nameEl) return;

  const unit = state.units[state.index];
  if (state.swapTimer !== null) clearTimeout(state.swapTimer);
  nameEl.classList.remove('visible');
  nameEl.lang = LANG[state.script];
  state.swapTimer = window.setTimeout(() => {
    nameEl.classList.toggle('verse', (unit?.lines.length ?? 1) > 1);
    nameEl.textContent = unit?.lines.join('\n') ?? '';
    nameEl.classList.add('visible');
    state.swapTimer = null;
  }, SWAP_MS);
}

function updateCounter() {
  const el = q<HTMLElement>('.japa-counter');
  const t = text();
  const unit = state.units[state.index];
  if (!el || !t || !unit) return;
  // A dhyana verse is chanted before the count starts, so it is named rather
  // than numbered — which is also how you see the japa proper has not begun.
  el.lang = unit.number === 0 ? LANG[state.script] : '';
  el.textContent = unit.number === 0 ? t.dhyanamLabel : `${unit.number} / ${t.names.length}`;
}

/** The picker carries each mantra's own name, so it follows the script. */
function labelMantras() {
  const sel = q<HTMLSelectElement>('.japa-mantra');
  if (!sel) return;
  sel.lang = LANG[state.script];
  for (const opt of Array.from(sel.options)) {
    const info = state.catalogue.find(m => m.id === opt.value);
    if (info) opt.textContent = info.title[state.script];
  }
  sel.value = state.mantra;
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
  if (playing) state.resting = false;
  updatePlayButton();
  syncDriver();
}

function step(dir: 1 | -1) {
  const total = state.units.length;
  if (total === 0) return;
  state.resting = false;

  const next = (((state.index + dir) % total) + total) % total;
  if (state.view === 'crawl') {
    seekUnit(next, dir);
    applyCrawl();
  } else {
    state.index = next;
    updateName();
    updateCounter();
  }
}

/** Lands the crawl on a unit boundary without letting a step that wraps past
 *  either end of the list look like a jump back through the whole column. */
function seekUnit(unit: number, dir: 1 | -1) {
  const { line, copy } = metrics;
  if (line <= 0 || copy <= 0) return;

  const base = Math.floor(state.offset / copy) * copy;
  let target = base + state.unitRow[unit] * line;
  if (dir > 0 && target < state.offset) target += copy;
  if (dir < 0 && target > state.offset) target -= copy;
  state.offset = target;
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
    seekIndex();
    applyCrawl();
  } else {
    updateName();
  }
  updateCounter();
  syncDriver();
}

/**
 * Shows a mantra in a script, fetching it if this is its first outing. `reset`
 * sends it back to the dhyanam; a script change keeps its place, because the
 * two texts hold the same units in the same order.
 */
async function show(mantra: string, script: Script, reset: boolean) {
  const key = `${mantra}-${script}`;
  state.pending = key;
  await loadText(key);
  if (state.pending !== key) return;

  state.mantra = mantra;
  state.script = script;
  rebuild();
  if (reset) {
    state.index = 0;
    state.resting = true;
  }

  buildTrack();
  labelMantras();
  measure();
  if (state.view === 'crawl') {
    seekIndex();
    applyCrawl();
  } else {
    updateName();
  }
  updateCounter();
}

// -------------------------------------------------------------------- setup

export async function initJapaMode(container: HTMLElement) {
  await loadCatalogue();

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
    <p class="japa-counter"></p>
    <div class="japa-controls">
      <select class="japa-mantra" aria-label="Mantra">
        ${state.catalogue.map(m => `<option value="${m.id}"></option>`).join('')}
      </select>
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
        <button class="japa-play" aria-label="Play">▶</button>
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

  updatePlayButton();
  await show(state.mantra, state.script, true);

  el.querySelector('.japa-back')!.addEventListener('click', () => step(-1));
  el.querySelector('.japa-advance')!.addEventListener('click', () => step(1));
  el.querySelector('.japa-play')!.addEventListener('click', () => setPlaying(!state.playing));

  el.querySelector('.japa-speed')!.addEventListener('input', (e) => {
    state.speed = parseInt((e.target as HTMLInputElement).value, 10);
    // The crawl reads the speed every frame; only the interval needs rebuilding.
    if (state.view === 'single') syncDriver();
  });

  el.querySelector('.japa-mantra')!.addEventListener('change', (e) => {
    // A new mantra opens at its dhyanam, wherever the last one had got to.
    show((e.target as HTMLSelectElement).value, state.script, true);
  });

  el.querySelectorAll<HTMLElement>('.japa-view').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view as View));
  });

  el.querySelectorAll<HTMLElement>('.japa-script').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.japa-script').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      show(state.mantra, btn.dataset.script as Script, false);
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
    measure();
    seekIndex();
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
  if (state.view === 'crawl') {
    seekIndex();
    applyCrawl();
  } else {
    updateName();
  }
  updateCounter();
  syncDriver();
}

/** Stops the motion but keeps play/pause, so returning resumes where it was. */
export function destroyJapa() {
  stopDrivers();
}
