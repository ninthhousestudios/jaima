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

  const wrapper = document.createElement('div');
  wrapper.className = 'lotus-nav';
  wrapper.innerHTML = `
    <svg viewBox="-90 -90 180 180" class="lotus-svg">
      <circle cx="0" cy="0" r="18" class="lotus-center" />
      ${PETALS.map((p, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / PETALS.length;
        return `<path
          class="lotus-petal${p.disabled ? ' disabled' : ''}"
          data-mode="${p.mode}"
          data-angle="${angle}"
          data-index="${i}"
          d="${createPetalPath(angle, false)}"
        />`;
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
      <circle cx="0" cy="0" r="30" class="lotus-hit" />
    </svg>
    <div class="lotus-glow"></div>
  `;

  container.appendChild(wrapper);

  const svg = wrapper.querySelector('.lotus-svg')!;
  const hit = wrapper.querySelector('.lotus-hit') as SVGCircleElement;
  const petalEls = wrapper.querySelectorAll<SVGPathElement>('.lotus-petal');
  const labelEls = wrapper.querySelectorAll<SVGTextElement>('.lotus-label');
  const glow = wrapper.querySelector('.lotus-glow') as HTMLElement;

  function updatePetals(open: boolean) {
    petalEls.forEach((el, i) => {
      const angle = parseFloat(el.dataset.angle!);
      const d = createPetalPath(angle, open);
      el.setAttribute('d', d);
    });
    labelEls.forEach(el => {
      el.setAttribute('opacity', open ? '1' : '0');
    });
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
  };
}
