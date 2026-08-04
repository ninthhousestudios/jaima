const GARLANDS = [
  { name: 'Jasmine', color: '#f5f0e8', accent: '#e8e0d0' },
  { name: 'Rose', color: '#e8a0b0', accent: '#d4788a' },
  { name: 'Mixed', color: '#f0d0a0', accent: '#e8b878' },
];

let currentGarland = 0;

function createGarlandSVG(garland: typeof GARLANDS[0], width: number, height: number): string {
  const cx = width / 2;
  const topY = height * 0.12;
  const droopY = height * 0.45;
  const sideInset = width * 0.18;

  const flowers: string[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = sideInset + t * (width - 2 * sideInset);
    const baseY = topY + Math.sin(t * Math.PI) * (droopY - topY);
    const sag = Math.sin(t * Math.PI) * 12;
    const y = baseY + sag;
    const size = 6 + Math.random() * 5;
    const hueShift = Math.random() * 20 - 10;
    flowers.push(`<circle cx="${x}" cy="${y}" r="${size}" fill="${garland.color}" opacity="${0.7 + Math.random() * 0.3}"/>`);
    if (i % 2 === 0) {
      flowers.push(`<circle cx="${x + 2}" cy="${y + 2}" r="${size * 0.6}" fill="${garland.accent}" opacity="0.6"/>`);
    }
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="garland-svg">
    <path d="M ${sideInset} ${topY} Q ${cx} ${droopY + 15} ${width - sideInset} ${topY}"
      fill="none" stroke="${garland.accent}" stroke-width="3" opacity="0.4"/>
    ${flowers.join('\n')}
  </svg>`;
}

export function initGarlandMode(container: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'garland-overlay mode-overlay';
  el.id = 'mode-garland';
  el.innerHTML = `
    <div class="garland-display"></div>
    <div class="garland-controls">
      ${GARLANDS.map((g, i) => `
        <button class="garland-pick${i === 0 ? ' active' : ''}" data-index="${i}">
          <span class="garland-swatch" style="background:${g.color}"></span>
          ${g.name}
        </button>
      `).join('')}
    </div>
  `;
  container.appendChild(el);

  const display = el.querySelector('.garland-display') as HTMLElement;

  function renderGarland() {
    const photo = document.getElementById('darshan-photo') as HTMLImageElement;
    const w = photo.clientWidth || 400;
    const h = photo.clientHeight || 600;
    display.innerHTML = createGarlandSVG(GARLANDS[currentGarland], w, h);
    const svg = display.querySelector('.garland-svg') as SVGElement;
    if (svg) {
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
    }
  }

  renderGarland();
  window.addEventListener('resize', renderGarland);

  el.querySelectorAll('.garland-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.garland-pick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGarland = parseInt((btn as HTMLElement).dataset.index!);
      renderGarland();
    });
  });
}
