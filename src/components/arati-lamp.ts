import { el, flame } from './dom';

/**
 * The pancharati — the five-flame hand lamp that gets waved before the deity.
 *
 * Two of these stand on wall shelves flanking the photo. In arati mode (v2)
 * one is picked up and waved, so this module builds a lamp that can be moved
 * and turned rather than one that is drawn in place:
 *
 *   - Position comes from `--arati-x` / `--arati-y` and size from `--arati-h`,
 *     all set on the element. Nothing about where it sits is baked into a
 *     rule, so moving one is assignment, not a reflow of the stylesheet.
 *   - It turns by setting `--wave-tilt`. The element's transform-origin is the
 *     GRIP point below, so it pivots where a hand would hold it, and the
 *     flames counter-rotate to stay plumb (see `--flame-plumb` in index.astro).
 *
 * That is the whole interface the wave needs: two coordinates and an angle.
 */

/**
 * The five wick positions and the grip, as fractions of the render's own
 * width and height.
 *
 * DERIVED FROM THE RENDER, like WICKS in altar.ts — but no longer by hand.
 * `tools/altar-assets.py` prints these on every render:
 *
 *     blender -b -P tools/altar-assets.py -- --only arati
 *
 * Copy them from the log rather than re-deriving. The other site that moves
 * with them is `aspect-ratio: 1536 / 1310` on `.arati-lamp` in index.astro.
 */
const WICKS = [
  { x: 0.5, y: 0.2493, scale: 0.72 }, // back
  { x: 0.2009, y: 0.2892, scale: 0.86 }, // left
  { x: 0.7991, y: 0.2892, scale: 0.86 }, // right
  { x: 0.3152, y: 0.3537, scale: 1.0 }, // front left
  { x: 0.6848, y: 0.3537, scale: 1.0 }, // front right
];

/** Centre of the dish's underside — where a hand holds it, so where it turns. */
export const GRIP = { x: 0.5, y: 0.8824 };

export interface AratiLamp {
  readonly root: HTMLElement;
  /** Turn the lamp about its grip. Flames stay plumb by themselves. */
  setTilt(degrees: number): void;
  /** The flame elements, for anything that wants to source particles here. */
  flames(): HTMLElement[];
}

export function buildAratiLamp(parent: HTMLElement, seed: number): AratiLamp {
  const root = el('div', 'arati-lamp', parent);

  const img = document.createElement('img');
  img.src = '/images/altar/arati@2x.png';
  img.alt = '';
  img.className = 'arati-lamp-img';
  root.appendChild(img);

  // Flames sit outside the image so a future mirror of the render never flips
  // them, matching how the nilavilakku is put together.
  const wicks = el('div', 'arati-wicks', root);
  WICKS.forEach((wick, i) => {
    const f = flame(wicks, wick.scale, seed + i);
    f.style.left = `${wick.x * 100}%`;
    f.style.top = `${wick.y * 100}%`;
  });

  return {
    root,
    setTilt(degrees: number) {
      root.style.setProperty('--wave-tilt', `${degrees}deg`);
    },
    flames() {
      return Array.from(wicks.querySelectorAll<HTMLElement>('.altar-flame'));
    },
  };
}
