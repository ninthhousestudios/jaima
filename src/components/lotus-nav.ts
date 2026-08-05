export type Mode = 'photo' | 'garland' | 'japa' | 'teachings' | 'sound' | 'arati';

export interface LotusNav {
  element: HTMLElement;
  activeMode: Mode | null;
  onModeChange: (mode: Mode | null) => void;
}

interface PetalDef {
  mode: Mode;
  label: string;
  disabled?: boolean;
}

const PETALS: PetalDef[] = [
  { mode: 'photo', label: 'Photo' },
  { mode: 'garland', label: 'Garland' },
  { mode: 'japa', label: 'Japa' },
  { mode: 'teachings', label: 'Teachings' },
  { mode: 'sound', label: 'Sound' },
  { mode: 'arati', label: 'Āratī', disabled: true },
];

interface Whorl {
  base: number;
  tip: number;
  half: number;
}

/** The interactive ring — one broad petal per mode. */
const OUTER: Whorl = { base: 14, tip: 58, half: 17 };
/** Decoration only, offset half a step so it fills the outer ring's gaps. */
const INNER: Whorl = { base: 10, tip: 41, half: 12.5 };

const STAMENS = 16;
const HIT_CLOSED = 30;
const HIT_OPEN = 12;

/**
 * One petal, drawn pointing up from the flower's centre so a single rotation
 * places it. Ovate and widest just past halfway, with the sides drawn back in
 * sharply at the end to give the point a lotus petal has and a leaf doesn't.
 */
function petalPath({ base, tip, half }: Whorl): string {
  const len = tip - base;
  const y = (f: number) => -(base + len * f);
  return [
    `M 0 ${-base}`,
    `C ${half * 0.55} ${y(0.1)} ${half} ${y(0.3)} ${half * 0.92} ${y(0.52)}`,
    `C ${half * 0.8} ${y(0.74)} ${half * 0.34} ${y(0.9)} 0 ${-tip}`,
    `C ${-half * 0.34} ${y(0.9)} ${-half * 0.8} ${y(0.74)} ${-half * 0.92} ${y(0.52)}`,
    `C ${-half} ${y(0.3)} ${-half * 0.55} ${y(0.1)} 0 ${-base}`,
    'Z',
  ].join(' ');
}

function veinPath({ base, tip, half }: Whorl): string {
  return `M 0 ${-(base + 2)} Q ${half * 0.08} ${-(base + tip) / 2} 0 ${-(tip - 3)}`;
}

/**
 * A lotus closes by standing its petals upright, not by shrinking. Seen from
 * above that foreshortens them along their own axis while they keep most of
 * their width, so the bud is a squat overlapping rosette — hence the very
 * uneven scale.
 */
function petalTransform(angle: number, open: boolean): string {
  const deg = (angle * 180) / Math.PI + 90;
  return open ? `rotate(${deg}deg)` : `rotate(${deg}deg) scale(0.9, 0.4)`;
}

function gradient(id: string, whorl: Whorl, stops: [number, string][]): string {
  return `
    <linearGradient id="${id}" gradientUnits="userSpaceOnUse"
                    x1="0" y1="${-whorl.base}" x2="0" y2="${-whorl.tip}">
      ${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}" />`).join('')}
    </linearGradient>`;
}

function heartMarkup(): string {
  const stamens = Array.from({ length: STAMENS }, (_, i) => {
    const a = (i * Math.PI * 2) / STAMENS + 0.2;
    const r0 = 9.5;
    const r1 = 13.5 + (i % 3) * 1.3;
    const x0 = Math.cos(a) * r0;
    const y0 = Math.sin(a) * r0;
    const x1 = Math.cos(a) * r1;
    const y1 = Math.sin(a) * r1;
    return `<line class="lotus-stamen" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" />
            <circle class="lotus-anther" cx="${x1}" cy="${y1}" r="1.1" />`;
  }).join('');

  const seeds = Array.from({ length: 7 }, (_, i) => {
    if (i === 6) return `<circle class="lotus-seed" cx="0" cy="0" r="1.4" />`;
    const a = (i * Math.PI * 2) / 6;
    return `<circle class="lotus-seed" cx="${Math.cos(a) * 4.6}" cy="${Math.sin(a) * 4.6}" r="1.4" />`;
  }).join('');

  return `<g class="lotus-heart">${stamens}<circle class="lotus-pod" r="9" />${seeds}</g>`;
}

export function initLotusNav(container: HTMLElement, onModeChange: (mode: Mode | null) => void): LotusNav {
  let isOpen = false;
  let activeMode: Mode | null = null;

  const angleOf = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / PETALS.length;
  const halfStep = Math.PI / PETALS.length;

  const wrapper = document.createElement('div');
  wrapper.className = 'lotus-nav';
  wrapper.innerHTML = `
    <svg viewBox="-90 -90 180 180" class="lotus-svg">
      <defs>
        ${gradient('lotus-outer', OUTER, [
          [0, 'hsl(45, 55%, 94%)'],
          [0.35, 'hsl(345, 45%, 82%)'],
          [1, 'hsl(335, 52%, 61%)'],
        ])}
        ${gradient('lotus-inner', INNER, [
          [0, 'hsl(48, 60%, 95%)'],
          [0.45, 'hsl(350, 40%, 87%)'],
          [1, 'hsl(340, 46%, 72%)'],
        ])}
        ${gradient('lotus-active', OUTER, [
          [0, 'hsl(48, 72%, 93%)'],
          [0.4, 'hsl(42, 72%, 77%)'],
          [1, 'hsl(33, 68%, 57%)'],
        ])}
      </defs>

      <g class="lotus-whorl lotus-whorl-outer">
        ${PETALS.map((p, i) => {
          const angle = angleOf(i);
          return `<g
            class="lotus-petal${p.disabled ? ' disabled' : ''}"
            data-mode="${p.mode}"
            data-angle="${angle}"
            style="--i: ${i}; transform: ${petalTransform(angle, false)}"
          >
            <path class="lotus-blade" d="${petalPath(OUTER)}" />
            <path class="lotus-vein" d="${veinPath(OUTER)}" />
          </g>`;
        }).join('')}
      </g>

      <g class="lotus-whorl lotus-whorl-inner">
        ${PETALS.map((_, i) => {
          const angle = angleOf(i) + halfStep;
          return `<g
            class="lotus-petal-inner"
            data-angle="${angle}"
            style="--i: ${i}; transform: ${petalTransform(angle, false)}"
          >
            <path class="lotus-blade" d="${petalPath(INNER)}" />
          </g>`;
        }).join('')}
      </g>

      ${heartMarkup()}

      ${PETALS.map((p, i) => {
        const angle = angleOf(i);
        const labelR = 78;
        return `<text
          class="lotus-label${p.disabled ? ' disabled' : ''}"
          data-mode="${p.mode}"
          x="${Math.cos(angle) * labelR}" y="${Math.sin(angle) * labelR}"
          text-anchor="middle"
          dominant-baseline="central"
          opacity="0"
        >${p.label}</text>`;
      }).join('')}

      <circle cx="0" cy="0" r="${HIT_CLOSED}" class="lotus-hit" />
    </svg>
    <div class="lotus-glow"></div>
  `;

  container.appendChild(wrapper);

  const hit = wrapper.querySelector('.lotus-hit') as SVGCircleElement;
  const fronds = wrapper.querySelectorAll<SVGGElement>('[data-angle]');
  const petalEls = wrapper.querySelectorAll<SVGGElement>('.lotus-petal');
  const labelEls = wrapper.querySelectorAll<SVGTextElement>('.lotus-label');
  const glow = wrapper.querySelector('.lotus-glow') as HTMLElement;

  function updatePetals(open: boolean) {
    fronds.forEach(el => {
      el.style.transform = petalTransform(parseFloat(el.dataset.angle!), open);
    });
    labelEls.forEach(el => {
      el.setAttribute('opacity', open ? '1' : '0');
    });
    // Closed, the circle has to cover the whole bud; open, it has to shrink
    // back inside the petal bases or it swallows their clicks.
    hit.setAttribute('r', String(open ? HIT_OPEN : HIT_CLOSED));
  }

  function setActiveGlow(mode: Mode | null) {
    if (mode) {
      glow.classList.add('active');
      const idx = PETALS.findIndex(p => p.mode === mode);
      if (idx >= 0) {
        const hue = [35, 330, 45, 200, 170, 20][idx];
        glow.style.setProperty('--glow-hue', String(hue));
      }
    } else {
      glow.classList.remove('active');
    }
  }

  function close() {
    isOpen = false;
    wrapper.classList.remove('open');
    updatePetals(false);
  }

  hit.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) {
      close();
    } else {
      isOpen = true;
      wrapper.classList.add('open');
      updatePetals(true);
    }
  });

  petalEls.forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isOpen) return;

      const mode = el.dataset.mode as Mode;
      const def = PETALS.find(p => p.mode === mode);
      if (def?.disabled) return;

      if (activeMode === mode) {
        activeMode = null;
        petalEls.forEach(p => p.classList.remove('active'));
      } else {
        activeMode = mode;
        petalEls.forEach(p => p.classList.remove('active'));
        el.classList.add('active');
      }

      setActiveGlow(activeMode);
      onModeChange(activeMode);
      close();
    });
  });

  document.addEventListener('click', () => {
    if (isOpen) close();
  });

  wrapper.addEventListener('click', (e) => e.stopPropagation());

  return {
    element: wrapper,
    get activeMode() { return activeMode; },
    onModeChange,
  };
}
