export type Mode = 'photo' | 'garland' | 'japa' | 'teachings' | 'sound' | 'arati';

export interface LotusNav {
  element: HTMLElement;
  activeMode: Mode | null;
  onModeChange: (mode: Mode | null) => void;
  /**
   * Modes that cannot be chosen at this moment, dimmed and inert.
   *
   * A rite in progress is the only thing that uses this: while the ārati is
   * playing, the modes that would cover the altar or sing over it are closed
   * off. Replaces the whole set each call — the caller states what is shut,
   * not what changed.
   */
  setDisabled: (modes: readonly Mode[]) => void;
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
  { mode: 'arati', label: 'Āratī' },
];

/**
 * The centre knob, cut out of docs/lotus.jpg by tools/lotus-knob.py. Both
 * numbers come from that script's output — the aspect ratio is printed, and
 * squashing the flower is the failure mode if it goes stale.
 */
const KNOB_W = 64;
const KNOB_H = KNOB_W / 1.4545;

/**
 * An open petal is a lens roughly 16 x 6 px on screen — about 3% of a normal
 * touch target, which is why clicking a mode used to take several tries. Each
 * petal carries an invisible circle of this radius instead, centred on the
 * petal at PETAL_HIT_R_AT. Adjacent centres are 62 units apart, so at r=20
 * they cannot overlap and steal each other's clicks.
 */
const PETAL_HIT_R = 20;
const PETAL_HIT_R_AT = 62;

function createPetalPath(angle: number, open: boolean): string {
  const r = open ? 52 : 0;
  const cx = Math.cos(angle) * r;
  const cy = Math.sin(angle) * r;
  const size = open ? 20 : 8;

  const tipX = cx + Math.cos(angle) * size;
  const tipY = cy + Math.sin(angle) * size;
  const perpAngle = angle + Math.PI / 2;
  const width = size * 0.45;
  const lx = cx + Math.cos(perpAngle) * width;
  const ly = cy + Math.sin(perpAngle) * width;
  const rx = cx - Math.cos(perpAngle) * width;
  const ry = cy - Math.sin(perpAngle) * width;

  const cp1x = (cx + tipX) / 2 + Math.cos(perpAngle) * width * 0.8;
  const cp1y = (cy + tipY) / 2 + Math.sin(perpAngle) * width * 0.8;
  const cp2x = (cx + tipX) / 2 - Math.cos(perpAngle) * width * 0.8;
  const cp2y = (cy + tipY) / 2 - Math.sin(perpAngle) * width * 0.8;

  return `M ${cx} ${cy} Q ${cp1x} ${cp1y} ${tipX} ${tipY} Q ${cp2x} ${cp2y} ${cx} ${cy}`;
}

export function initLotusNav(container: HTMLElement, onModeChange: (mode: Mode | null) => void): LotusNav {
  let isOpen = false;
  let activeMode: Mode | null = null;
  let shut: ReadonlySet<Mode> = new Set();

  const wrapper = document.createElement('div');
  wrapper.className = 'lotus-nav';
  wrapper.innerHTML = `
    <svg viewBox="-90 -90 180 180" class="lotus-svg">
      <image
        class="lotus-center"
        href="/images/lotus/lotus.png"
        x="${-KNOB_W / 2}" y="${-KNOB_H / 2}"
        width="${KNOB_W}" height="${KNOB_H}"
      />
      ${PETALS.map((p, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / PETALS.length;
        return `<g
          class="lotus-petal${p.disabled ? ' disabled' : ''}"
          data-mode="${p.mode}"
          data-angle="${angle}"
          data-index="${i}"
        >
          <path class="lotus-blade" d="${createPetalPath(angle, false)}" />
          <circle class="lotus-petal-hit" cx="0" cy="0" r="${PETAL_HIT_R}" />
        </g>`;
      }).join('')}
      ${PETALS.map((p, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / PETALS.length;
        const labelR = 78;
        const lx = Math.cos(angle) * labelR;
        const ly = Math.sin(angle) * labelR;
        return `<text
          class="lotus-label${p.disabled ? ' disabled' : ''}"
          data-mode="${p.mode}"
          x="${lx}" y="${ly}"
          text-anchor="middle"
          dominant-baseline="central"
          opacity="0"
        >${p.label}</text>`;
      }).join('')}
      <circle cx="0" cy="0" r="${KNOB_W / 2}" class="lotus-hit" />
    </svg>
    <div class="lotus-glow"></div>
  `;

  container.appendChild(wrapper);

  const svg = wrapper.querySelector('.lotus-svg')!;
  const hit = wrapper.querySelector('.lotus-hit') as SVGCircleElement;
  const petalEls = wrapper.querySelectorAll<SVGGElement>('.lotus-petal');
  const labelEls = wrapper.querySelectorAll<SVGTextElement>('.lotus-label');
  const glow = wrapper.querySelector('.lotus-glow') as HTMLElement;

  function updatePetals(open: boolean) {
    petalEls.forEach(el => {
      const angle = parseFloat(el.dataset.angle!);
      el.querySelector('.lotus-blade')!.setAttribute('d', createPetalPath(angle, open));

      // The hit circle rides out with the petal. Closed it is parked on the
      // centre, where the petals are inert anyway.
      const at = open ? PETAL_HIT_R_AT : 0;
      const hitEl = el.querySelector('.lotus-petal-hit')!;
      hitEl.setAttribute('cx', String(Math.cos(angle) * at));
      hitEl.setAttribute('cy', String(Math.sin(angle) * at));
    });
    labelEls.forEach(el => {
      el.setAttribute('opacity', open ? '1' : '0');
    });
  }

  /** A petal is shut if it was born disabled or has been closed off since. */
  function isShut(mode: Mode): boolean {
    return PETALS.find(p => p.mode === mode)?.disabled === true || shut.has(mode);
  }

  function setDisabled(modes: readonly Mode[]) {
    shut = new Set(modes);
    for (const el of [...petalEls, ...labelEls]) {
      el.classList.toggle('disabled', isShut(el.dataset.mode as Mode));
    }
  }

  function setActiveGlow(mode: Mode | null) {
    if (mode) {
      glow.classList.add('active');
      const def = PETALS.find(p => p.mode === mode);
      if (def) {
        const idx = PETALS.indexOf(def);
        const angle = -Math.PI / 2 + (idx * Math.PI * 2) / PETALS.length;
        const hue = [35, 330, 45, 200, 170, 20][idx];
        glow.style.setProperty('--glow-hue', String(hue));
      }
    } else {
      glow.classList.remove('active');
    }
  }

  hit.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) {
      isOpen = false;
      wrapper.classList.remove('open');
      updatePetals(false);
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
      if (isShut(mode)) return;

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

      isOpen = false;
      wrapper.classList.remove('open');
      updatePetals(false);
    });
  });

  document.addEventListener('click', () => {
    if (isOpen) {
      isOpen = false;
      wrapper.classList.remove('open');
      updatePetals(false);
    }
  });

  wrapper.addEventListener('click', (e) => e.stopPropagation());

  return {
    element: wrapper,
    get activeMode() { return activeMode; },
    onModeChange,
    setDisabled,
  };
}
