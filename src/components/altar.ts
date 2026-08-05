import { marigold, rose, jasmine, petalScatter, thoranam } from './altar-flowers';
import { buildAratiLamp } from './arati-lamp';
import { el, flame } from './dom';
import type { ParticleField, Source } from './particles';

/**
 * The shrine the darshan photo sits in: curtain backdrop, framed and matted
 * photo on a ledge, a tall nilavilakku either side, and offerings across the
 * front.
 *
 * The composition follows design.md's first principle — the room is always
 * dominant. Real altars are visually dense but you still look straight at the
 * face, because everything around it is dark and low-contrast, not because
 * it is empty. So this fills the viewport with detail and then crushes the
 * value range of everything that is not the photo (see .altar-light).
 */

/**
 * The five wick positions on the rendered lamp, as a fraction of the PNG's
 * own width and height.
 *
 * Derived from the render geometry in tools/altar-assets.py: the lips sit at
 * theta = 90 + 72k degrees on a rim of radius 1.14, viewed through a 9-degree
 * downward tilt. The tilt is why the back wick reads highest and the two
 * front wicks lowest — and why they are scaled: further wicks are smaller.
 *
 * DERIVED FROM THE RENDER — three sites move together. If the lamp profile,
 * TILT_DEG or ORTHO_MARGIN in tools/altar-assets.py change, all of these go
 * stale at once:
 *
 *   1. WICKS, below
 *   2. `aspect-ratio: 440 / 1536` on `.altar-lamp` in index.astro
 *   3. `.altar-diya .altar-flame { left: 89.3%; top: 43.7% }` in index.astro
 *
 * Nothing enforces the relationship. A stale value throws no error; the flames
 * simply drift off the wicks. Re-derive rather than eyeballing: the render is
 * orthographic, so a point at world (x, y, z) lands at
 *   fx = 0.5 + x / ortho_width
 *   fy = 0.5 - (y * sin(TILT) + (z - height/2) * cos(TILT)) / ortho_height
 * with ortho_height = ORTHO_MARGIN * projected height, and ortho_width scaled
 * from it by the render's pixel aspect.
 */
const WICKS = [
  { x: 0.5, y: 0.165, scale: 0.72 }, // back
  { x: 0.146, y: 0.176, scale: 0.86 }, // left
  { x: 0.854, y: 0.176, scale: 0.86 }, // right
  { x: 0.281, y: 0.195, scale: 1.0 }, // front left
  { x: 0.719, y: 0.195, scale: 1.0 }, // front right
];

export interface Altar {
  /** Report the flame and incense positions so smoke and embers come from them. */
  attachParticles(field: ParticleField): void;
}

function svg(
  className: string,
  viewBox: string,
  contents: string,
  preserve = 'xMidYMid meet',
): HTMLDivElement {
  const host = document.createElement('div');
  host.className = className;
  host.innerHTML =
    `<svg viewBox="${viewBox}" preserveAspectRatio="${preserve}" focusable="false"` +
    ` aria-hidden="true">${contents}</svg>`;
  return host;
}

function buildLamp(stage: HTMLElement, side: 'left' | 'right'): HTMLElement {
  const lamp = el('div', `altar-lamp altar-lamp-${side}`, stage);

  const img = document.createElement('img');
  img.src = '/images/altar/nilavilakku@2x.png';
  img.alt = '';
  img.className = 'altar-lamp-img';
  lamp.appendChild(img);

  // Flames live outside the mirrored image so they are never flipped —
  // a flame leaning the wrong way would give the mirror trick away.
  const wicks = el('div', 'altar-wicks', lamp);
  WICKS.forEach((wick, i) => {
    const f = flame(wicks, wick.scale, i);
    f.style.left = `${wick.x * 100}%`;
    f.style.top = `${wick.y * 100}%`;
  });

  return lamp;
}

/**
 * A bracket shelf on the wall with an arati lamp standing on it.
 *
 * They go in the strip of bare wall between each nilavilakku and the frame —
 * the only place wide enough that does not crowd something. In arati mode the
 * lamp lifts off the shelf, so the shelf is built as its own thing and the
 * lamp merely stands on it: nothing about the lamp's position lives here.
 */
function buildShelf(stage: HTMLElement, side: 'left' | 'right', seed: number) {
  const shelf = el('div', `altar-shelf altar-shelf-${side}`, stage);
  el('div', 'altar-shelf-slab', shelf);
  el('div', 'altar-shelf-corbel', shelf);
  return buildAratiLamp(shelf, seed);
}

function buildOfferings(stage: HTMLElement): HTMLElement {
  const offerings = el('div', 'altar-offerings', stage);

  // Loose petals strewn across the ledge, behind the standing pieces.
  // Stretched to fit rather than letterboxed — a scatter has no aspect ratio
  // worth preserving, and stretched ellipses are still ellipses.
  offerings.appendChild(
    svg('altar-strewn', '0 0 900 90', petalScatter(900, 90, 90, 20260804), 'none'),
  );

  const pots: Array<[string, string, number]> = [
    ['kalasha', 'left', 6],
    ['kalasha', 'right', 6],
  ];
  for (const [name, side, size] of pots) {
    const pot = el('div', `altar-pot altar-pot-${side}`, offerings);
    pot.style.setProperty('--pot-h', `${size}vh`);
    const img = document.createElement('img');
    img.src = `/images/altar/${name}@2x.png`;
    img.alt = '';
    pot.appendChild(img);
  }

  // Two small oil lamps flanking the incense, each with its own flame.
  for (const side of ['left', 'right'] as const) {
    const diya = el('div', `altar-diya altar-diya-${side}`, offerings);
    const img = document.createElement('img');
    img.src = '/images/altar/diya@2x.png';
    img.alt = '';
    diya.appendChild(img);
    const f = flame(diya, 0.85, side === 'left' ? 5 : 6);
    f.classList.add('altar-flame-diya');
  }

  // Incense: three holders, each with a stick and the point its smoke rises
  // from. The tall one is at centre; the flanking pair stand at --incense-x,
  // in front of the photo's lower corners. Leans differ so they don't read as
  // three copies of one object.
  const sticks: Array<['left' | 'centre' | 'right', number]> = [
    ['left', -3.5],
    ['centre', 2.5],
    ['right', 4],
  ];
  for (const [place, lean] of sticks) {
    const incense = el('div', `altar-incense altar-incense-${place}`, offerings);
    const img = document.createElement('img');
    img.src = '/images/altar/incense-holder@2x.png';
    img.alt = '';
    incense.appendChild(img);
    const stick = el('div', 'altar-incense-stick', incense);
    stick.style.setProperty('--stick-lean', `${lean}deg`);
    // Marks the burning tip. Its only job at runtime is to be measured, so a
    // smoke column starts exactly where the stick ends.
    el('div', 'altar-incense-tip', stick);
  }

  // Flower clusters on the ledge. Odd numbers and uneven spacing — a row of
  // evenly spaced flowers reads as a UI element rather than an offering.
  // [left %, size in vh, kind, seed]. Deliberately uneven spacing and odd
  // groupings — a row of evenly spaced flowers reads as a UI element rather
  // than an offering someone laid down.
  const clusters: Array<[number, number, 'marigold' | 'rose' | 'jasmine', number]> = [
    [8, 3.1, 'marigold', 1],
    [14, 2.2, 'rose', 2],
    [19, 1.7, 'marigold', 3],
    [27, 1.4, 'jasmine', 4],
    [33, 2.0, 'marigold', 5],
    [47, 1.2, 'rose', 6],
    [53, 1.5, 'marigold', 7],
    [68, 2.1, 'marigold', 8],
    [74, 1.4, 'jasmine', 9],
    [81, 2.4, 'rose', 10],
    [88, 3.0, 'marigold', 11],
  ];
  for (const [left, size, kind, seed] of clusters) {
    const r = 50;
    const body =
      kind === 'marigold'
        ? marigold(r, seed * 977)
        : kind === 'rose'
          ? rose(r, seed * 977)
          : jasmine(r, seed * 977);
    const node = svg('altar-bloom', '-60 -60 120 120', body);
    node.style.left = `${left}%`;
    node.style.setProperty('--bloom-size', `${size}vh`);
    offerings.appendChild(node);
  }

  return offerings;
}

export function initAltar(host: HTMLElement, darshan: HTMLElement): Altar {
  const stage = el('div', 'altar-stage', host);

  el('div', 'altar-backdrop', stage);
  el('div', 'altar-floor', stage);

  const frame = el('div', 'altar-frame', stage);
  const mat = el('div', 'altar-mat', frame);
  const aperture = el('div', 'altar-aperture', mat);
  // The photo element already exists in the page; move it into the aperture
  // rather than recreating it, so photo-mode keeps its handle on it.
  aperture.appendChild(darshan);

  const toran = svg('altar-toran', '0 0 1000 90', thoranam(1000, 34, 4242));
  stage.appendChild(toran);

  const ledge = el('div', 'altar-ledge', stage);
  el('div', 'altar-ledge-top', ledge);
  el('div', 'altar-ledge-cloth', ledge);

  buildLamp(stage, 'left');
  buildLamp(stage, 'right');
  buildShelf(stage, 'left', 11);
  buildShelf(stage, 'right', 17);
  const offerings = buildOfferings(stage);

  // Above every decoration, below the nav: the passes that make the layers
  // read as one photograph rather than a stack of cut-outs.
  el('div', 'altar-light', host);
  el('div', 'altar-shade', host);

  let field: ParticleField | null = null;

  function normalised(node: Element): Source {
    const box = node.getBoundingClientRect();
    return {
      x: (box.left + box.width / 2) / window.innerWidth,
      y: (box.top + box.height / 2) / window.innerHeight,
    };
  }

  function report() {
    if (!field) return;
    const tips = offerings.querySelectorAll('.altar-incense-tip');
    field.setIncenseSources(Array.from(tips, normalised));

    const flames = stage.querySelectorAll('.altar-lamp .altar-flame');
    field.setEmberSources(Array.from(flames, normalised));
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    // Positions are read from layout, so wait for it to settle.
    resizeTimer = window.setTimeout(report, 120);
  });

  return {
    attachParticles(f: ParticleField) {
      field = f;
      report();
    },
  };
}
