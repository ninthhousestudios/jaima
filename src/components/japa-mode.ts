type Script = 'iast' | 'devanagari' | 'malayalam';

interface JapaState {
  names: Record<Script, string[]>;
  currentScript: Script;
  currentIndex: number;
  streaming: boolean;
  speed: number;
  streamTimer: number | null;
  element: HTMLElement | null;
}

const state: JapaState = {
  names: { iast: [], devanagari: [], malayalam: [] },
  currentScript: 'malayalam',
  currentIndex: 0,
  streaming: false,
  speed: 3000,
  streamTimer: null,
  element: null,
};

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

function getCurrentName(): string {
  const names = state.names[state.currentScript];
  if (names.length === 0) return '';
  return names[state.currentIndex % names.length];
}

function advance() {
  const names = state.names[state.currentScript];
  if (names.length === 0) return;
  state.currentIndex = (state.currentIndex + 1) % names.length;
  updateDisplay();
}

function updateDisplay() {
  if (!state.element) return;
  const nameEl = state.element.querySelector('.japa-name') as HTMLElement;
  const counterEl = state.element.querySelector('.japa-counter') as HTMLElement;
  const names = state.names[state.currentScript];

  if (nameEl) {
    nameEl.classList.remove('visible');
    setTimeout(() => {
      nameEl.textContent = getCurrentName();
      nameEl.classList.add('visible');
    }, 300);
  }

  if (counterEl && names.length > 0) {
    counterEl.textContent = `${(state.currentIndex % names.length) + 1} / ${names.length}`;
  }
}

function startStreaming() {
  stopStreaming();
  state.streaming = true;
  state.streamTimer = window.setInterval(advance, state.speed);
  updateStreamButton();
}

function stopStreaming() {
  state.streaming = false;
  if (state.streamTimer !== null) {
    clearInterval(state.streamTimer);
    state.streamTimer = null;
  }
  updateStreamButton();
}

function updateStreamButton() {
  if (!state.element) return;
  const btn = state.element.querySelector('.japa-stream-toggle') as HTMLElement;
  if (btn) btn.textContent = state.streaming ? '⏸' : '▶';
}

export async function initJapaMode(container: HTMLElement) {
  await loadNames();

  const el = document.createElement('div');
  el.className = 'japa-overlay mode-overlay';
  el.id = 'mode-japa';
  el.innerHTML = `
    <div class="japa-display">
      <p class="japa-name visible">${getCurrentName()}</p>
      <p class="japa-counter">1 / ${state.names[state.currentScript].length}</p>
    </div>
    <div class="japa-controls">
      <div class="japa-scripts">
        <button class="japa-script active" data-script="malayalam">മല</button>
        <button class="japa-script" data-script="iast">IAST</button>
        <button class="japa-script" data-script="devanagari">देव</button>
      </div>
      <div class="japa-playback">
        <button class="japa-stream-toggle">▶</button>
        <input type="range" class="japa-speed" min="1000" max="8000" value="${state.speed}" step="500" />
        <button class="japa-advance" aria-label="Next name">→</button>
      </div>
    </div>
  `;

  container.appendChild(el);
  state.element = el;

  el.querySelector('.japa-advance')!.addEventListener('click', advance);

  el.querySelector('.japa-stream-toggle')!.addEventListener('click', () => {
    if (state.streaming) stopStreaming();
    else startStreaming();
  });

  el.querySelector('.japa-speed')!.addEventListener('input', (e) => {
    state.speed = parseInt((e.target as HTMLInputElement).value);
    if (state.streaming) startStreaming();
  });

  el.querySelectorAll('.japa-script').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.japa-script').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentScript = (btn as HTMLElement).dataset.script as Script;
      updateDisplay();
      if (state.streaming) startStreaming();
    });
  });

  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.japa-controls')) return;
    advance();
  });
}

export function destroyJapa() {
  stopStreaming();
}
