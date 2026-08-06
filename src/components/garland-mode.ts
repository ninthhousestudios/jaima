import { seeded } from './altar-flowers';
import { Rope } from './garland-rope';

/**
 * Offering garlands.
 *
 * Not a picture of a garland that appears: one you take from the panel, carry
 * across the altar and hang on her frame. Everything here exists to make that
 * one act read as the act it is.
 *
 * A garland is a strand of flower sprites threaded onto a Verlet rope
 * (garland-rope.ts). Held in one hand it hangs in a long narrow U; hung on the
 * frame its ends move to the two top corners and it spreads into a wide drape.
 * The rope does that transition for free, because the strand's length does not
 * change when the pins move apart — which is exactly the thing a rigid sprite
 * could never do, and the reason the flowers are rendered one at a time in
 * tools/garland-flowers.py rather than as three finished garland images.
 *
 * Hanging it on the frame rather than round her neck is not a compromise. It
 * is what is actually done with a framed photo at a shrine, so the one thing
 * a flat photo cannot support was never needed.
 *
 * THEY PERSIST. The panel is not the garlands, any more than the sound panel
 * is the sound: leave garland mode for japa or the altar and what you hung
 * stays hung. Only Clear takes them down. That is also why the canvas lives
 * inside #altar rather than in the mode overlay — it is part of the shrine
 * now, under .altar-light and .altar-shade like every other decoration.
 *
 * The loop stops when every garland has settled and restarts on the next
 * touch. A still altar costs nothing.
 */

/** Sprite pool for a kind, as [name, weight] — see tools/garland-flowers.py. */
type Pool = ReadonlyArray<readonly [string, number]>;

interface Kind {
  readonly id: string;
  readonly label: string;
  readonly swatch: string;
  readonly pool: Pool;
  /**
   * Gap between flowers, as a fraction of the sprite box. Small numbers
   * overlap the flowers, which is what a strung garland does; it is tuned per
   * kind because a jasmine sprite fills far less of its box than a marigold.
   */
  readonly spacing: number;
  /**
   * Strand length, as a multiple of the frame's width.
   *
   * Sets how deep the garland hangs, and it is the one number here worth
   * being careful with. A strand of L across a span of W drapes to about
   * sqrt((L/2)^2 - (W/2)^2) below the pins, so 1.95 puts the bottom of the
   * loop three quarters of the way down the photo and straight across her
   * face. These land it near the middle of the frame — around her neck,
   * where a garland goes, and clear of the face the whole room is built to
   * lead the eye to.
   */
  readonly length: number;
}

const KINDS: readonly Kind[] = [
  {
    id: 'marigold',
    label: 'Marigold',
    swatch: '#e8681a',
    pool: [
      ['marigold-a', 5],
      ['marigold-b', 5],
      ['marigold-c', 4],
      ['marigold-d', 4],
      ['leaf-a', 1],
    ],
    spacing: 0.34,
    length: 1.68,
  },
  {
    id: 'rose',
    label: 'Rose',
    swatch: '#c0182c',
    pool: [
      ['rose-a', 5],
      ['rose-b', 5],
      ['rose-c', 3],
      ['leaf-a', 1],
      ['leaf-b', 1],
    ],
    spacing: 0.36,
    length: 1.64,
  },
  {
    id: 'jasmine',
    label: 'Jasmine',
    swatch: '#efe6d4',
    // Mullapoo is mostly buds, with a rose worked in every so often — which
    // is how the strands are actually strung in Kerala, not a stylisation.
    pool: [
      ['jasmine-bud-a', 6],
      ['jasmine-bud-b', 6],
      ['jasmine-a', 4],
      ['jasmine-b', 4],
      ['rose-c', 1],
      ['leaf-b', 1],
    ],
    spacing: 0.14,
    length: 1.76,
  },
];

const SPRITE_NAMES = Array.from(new Set(KINDS.flatMap(k => k.pool.map(p => p[0]))));

/** Sprite box, as a fraction of the frame's width. Sets how big garlands read. */
const BOX = 0.17;

/** Nodes per strand, capped so a jasmine strand cannot run away with the loop. */
const MAX_NODES = 120;

/** Margin around the frame within which a drop hangs on it, as a fraction
 *  of the frame's width. */
const SNAP = 0.35;

/** Each garland hung on the frame sits below the last, as real ones stack. */
const STACK_STEP = 0.34;

interface Sprite {
  readonly front: HTMLImageElement;
  /** The same flower darkened, for the half of the strand on the back side. */
  readonly back: HTMLCanvasElement;
}

interface Flower {
  readonly sprite: Sprite;
  /** Turn relative to the strand's tangent, so neighbours do not line up. */
  readonly spin: number;
  readonly scale: number;
  /** Which side of the doubled strand this one is strung on. */
  readonly behind: boolean;
  /** Offset across the strand, so the flowers are not in single file. */
  readonly offset: number;
}

interface Garland {
  readonly kind: Kind;
  readonly rope: Rope;
  readonly flowers: Flower[];
  readonly box: number;
  /** Set once hung on the frame; kept so a resize can re-hang it. */
  stack: number | null;
  /** Falling off the altar after Clear. */
  discarded: boolean;
}

let loading: Promise<Map<string, Sprite>> | null = null;
let sprites: Map<string, Sprite> | null = null;

function loadSprites(): Promise<Map<string, Sprite>> {
  if (loading) return loading;
  // @3x only where the display can show it. The sprites are the bulk of what
  // this mode costs and nobody sees the difference below that.
  const density = window.devicePixelRatio > 2 ? '3x' : '2x';
  loading = Promise.all(
    SPRITE_NAMES.map(
      name =>
        new Promise<[string, Sprite]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([name, { front: img, back: darken(img) }]);
          img.onerror = () => reject(new Error(`garland sprite ${name}`));
          img.src = `/images/garland/${name}@${density}.png`;
        }),
    ),
  )
    .then(entries => {
      sprites = new Map(entries);
      return sprites;
    })
    .catch(err => {
      // Not cached as a rejection: a transient failure would otherwise make
      // the mode dead for the rest of the session.
      loading = null;
      throw err;
    });
  return loading;
}

/**
 * A darkened copy, made once at load.
 *
 * The alternative is a canvas filter per drawImage, which is the same effect
 * at a hundred times the per-frame cost. `source-atop` keeps the flower's own
 * alpha, so the silhouette is untouched.
 */
function darken(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(12, 4, 0, 0.5)';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function pick(pool: Pool, rand: () => number): string {
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let n = rand() * total;
  for (const [name, weight] of pool) {
    n -= weight;
    if (n <= 0) return name;
  }
  return pool[pool.length - 1][0];
}

export function initGarlandMode(altar: HTMLElement, room: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.className = 'garland-canvas';
  altar.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const panel = document.createElement('div');
  panel.className = 'garland-overlay mode-overlay';
  panel.id = 'mode-garland';
  panel.innerHTML = `
    <div class="garland-controls">
      ${KINDS.map(
        k => `
        <button class="garland-pick" type="button" data-kind="${k.id}">
          <span class="garland-swatch" style="background:${k.swatch}"></span>${k.label}
        </button>`,
      ).join('')}
      <button class="garland-clear" type="button">Clear</button>
    </div>
  `;
  room.appendChild(panel);

  const garlands: Garland[] = [];
  /** Taken from the panel, following the pointer until a click places it. */
  let carried: Garland | null = null;
  /** Picked up off the altar, following the pointer until release. */
  let dragged: Garland | null = null;
  let pointer = { x: 0, y: 0 };
  let running = false;

  function frameRect() {
    const base = altar.getBoundingClientRect();
    const frame = altar.querySelector<HTMLElement>('.altar-frame');
    if (!frame) {
      return {
        left: base.width * 0.3,
        right: base.width * 0.7,
        top: base.height * 0.2,
        bottom: base.height * 0.8,
      };
    }
    const r = frame.getBoundingClientRect();
    return {
      left: r.left - base.left,
      right: r.right - base.left,
      top: r.top - base.top,
      bottom: r.bottom - base.top,
    };
  }

  /**
   * True if letting go here should hang the garland on the frame.
   *
   * The whole frame, generously margined — not a band across its top. Dropping
   * a garland over her picture means "hang this on her picture"; the ends
   * going to the top corners is a detail of how a garland hangs, not something
   * the hand should have to aim at. An earlier version tested only the top
   * edge, so a drop over the middle of the photo fell through to free
   * placement and dangled there in a narrow U.
   */
  function overFrame(x: number, y: number): boolean {
    const f = frameRect();
    const margin = (f.right - f.left) * SNAP;
    return (
      x > f.left - margin && x < f.right + margin && y > f.top - margin && y < f.bottom + margin
    );
  }

  /** Where the ends go for the nth garland hung on the frame. */
  function framePins(stack: number, box: number) {
    const f = frameRect();
    const width = f.right - f.left;
    const drop = stack * box * STACK_STEP;
    const inset = width * (0.06 + stack * 0.03);
    return { ax: f.left + inset, ay: f.top + drop, bx: f.right - inset, by: f.top + drop };
  }

  /** How many already hang there, so the next one lands below them. */
  function stackFor(g: Garland): number {
    return garlands.filter(o => o !== g && o.stack !== null).length;
  }

  function boxSize(): number {
    const f = frameRect();
    return (f.right - f.left) * BOX;
  }

  function build(kind: Kind, at: { x: number; y: number }): Garland {
    const f = frameRect();
    const box = boxSize();
    const segment = Math.max(2, box * kind.spacing);
    const count = Math.min(
      MAX_NODES,
      Math.max(12, Math.round((kind.length * (f.right - f.left)) / segment)),
    );

    // Gravity in pixels per step squared, scaled by the segment so that a
    // jasmine strand of many short links and a marigold strand of fewer long
    // ones hang with the same weight rather than the dense one falling like
    // a stone. The spread is how wide the loop sits when carried in one hand.
    const rope = new Rope(count, segment, segment * 0.05, box * 0.6, at);

    const rand = seeded(Math.floor(Math.random() * 0xffffffff));
    const flowers: Flower[] = [];
    for (let i = 0; i < count; i++) {
      flowers.push({
        sprite: sprites!.get(pick(kind.pool, rand))!,
        spin: (rand() - 0.5) * Math.PI * 0.7,
        scale: 0.82 + rand() * 0.36,
        // Mostly alternating, but not strictly, or the two sides of the
        // strand comb into a zip.
        behind: i % 2 === 0 ? rand() < 0.8 : rand() < 0.2,
        offset: (rand() - 0.5) * segment * 1.4,
      });
    }
    return { kind, rope, flowers, box, stack: null, discarded: false };
  }

  /** Hang a garland over the frame's top corners, below any already there. */
  function hangOnFrame(g: Garland, stack: number) {
    const p = framePins(stack, g.box);
    g.stack = stack;
    g.rope.drape(p.ax, p.ay, p.bx, p.by);
  }

  function place(g: Garland, x: number, y: number) {
    if (overFrame(x, y)) {
      hangOnFrame(g, stackFor(g));
    } else {
      g.stack = null;
      g.rope.hold(x, y);
    }
  }

  /**
   * While a garland is in hand and over the frame, show the line it will hang
   * on. Without it the snap is invisible until you have already let go, and
   * the two outcomes — draped on the frame, or dangling where you dropped it —
   * look nothing alike.
   */
  function drawHint(g: Garland) {
    if (!overFrame(pointer.x, pointer.y)) return;
    const p = framePins(stackFor(g), g.box);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 196, 122, 0.42)';
    ctx.lineWidth = Math.max(1.5, g.box * 0.05);
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 168, 78, 0.85)';
    ctx.shadowBlur = g.box * 0.5;
    ctx.beginPath();
    ctx.moveTo(p.ax, p.ay);
    ctx.lineTo(p.bx, p.by);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const rect = altar.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    // Both dimensions, not just the width: a window that changes height alone
    // would otherwise keep a stale backing store and the whole altar's worth
    // of garlands would draw stretched vertically.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Under the garlands, so the one in hand is never obscured by its own hint.
    const inHand = carried ?? dragged;
    if (inHand) drawHint(inHand);

    for (const g of garlands) {
      const nodes = g.rope.nodes;

      // The thread. Almost entirely hidden on a marigold strand, but a
      // jasmine one is open enough to show it, and a garland with a visible
      // gap and nothing crossing it stops reading as one object.
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      for (const n of nodes) ctx.lineTo(n.x, n.y);
      ctx.strokeStyle = 'rgba(40, 24, 10, 0.55)';
      ctx.lineWidth = Math.max(1, g.box * 0.035);
      ctx.stroke();

      // Back side of the doubled strand first, so the front overlaps it.
      for (const behind of [true, false]) {
        for (let i = 0; i < nodes.length; i++) {
          const flower = g.flowers[i];
          if (flower.behind !== behind) continue;
          const angle = g.rope.angleAt(i);
          const size = g.box * flower.scale * (behind ? 0.88 : 1);
          ctx.save();
          ctx.translate(
            nodes[i].x - Math.sin(angle) * flower.offset,
            nodes[i].y + Math.cos(angle) * flower.offset,
          );
          ctx.rotate(angle + flower.spin);
          // Sprites are centred in their frame by construction, so threading
          // one onto a rope node is drawing it at -size/2. See the invariants
          // at the top of tools/garland-flowers.py.
          ctx.drawImage(
            behind ? flower.sprite.back : flower.sprite.front,
            -size / 2,
            -size / 2,
            size,
            size,
          );
          ctx.restore();
        }
      }
    }
  }

  function tick() {
    const rect = altar.getBoundingClientRect();
    let moving = false;

    for (let i = garlands.length - 1; i >= 0; i--) {
      const g = garlands[i];
      if (g.rope.step()) moving = true;
      if (g.discarded) {
        if (g.rope.below(rect.height + g.box)) garlands.splice(i, 1);
        else moving = true;
      }
    }

    draw();

    if (moving || carried || dragged) requestAnimationFrame(tick);
    else running = false;
  }

  function run() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function localPoint(e: PointerEvent) {
    const rect = altar.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Two gestures, because the two situations genuinely differ. A garland just
  // taken from the panel is being *carried*: it follows until you click to
  // hang it, which is what your hand is already doing after pressing a button.
  // A garland already on the altar is *dragged*: press it, move, let go.
  canvas.addEventListener('pointerdown', e => {
    const p = localPoint(e);
    if (carried) {
      place(carried, p.x, p.y);
      carried = null;
      run();
      return;
    }

    const reach = boxSize() * 0.75;
    let best: Garland | null = null;
    let bestDist = reach * reach;
    // Last first: the most recently hung garland is the one on top.
    for (let i = garlands.length - 1; i >= 0; i--) {
      const d = garlands[i].rope.nearest(p.x, p.y);
      if (d < bestDist) {
        bestDist = d;
        best = garlands[i];
      }
    }
    if (!best) return;
    dragged = best;
    dragged.stack = null;
    dragged.rope.hold(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
    run();
  });

  canvas.addEventListener('pointermove', e => {
    pointer = localPoint(e);
    if (dragged) dragged.rope.hold(pointer.x, pointer.y);
    else if (carried) carried.rope.hold(pointer.x, pointer.y);
  });

  canvas.addEventListener('pointerup', e => {
    if (!dragged) return;
    const p = localPoint(e);
    place(dragged, p.x, p.y);
    dragged = null;
    canvas.releasePointerCapture(e.pointerId);
    run();
  });

  panel.querySelectorAll<HTMLElement>('.garland-pick').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = KINDS.find(k => k.id === btn.dataset.kind);
      if (!kind) return;
      panel.classList.add('loading');
      try {
        await loadSprites();
      } finally {
        panel.classList.remove('loading');
      }
      const rect = altar.getBoundingClientRect();
      const start = {
        x: pointer.x || rect.width * 0.5,
        y: pointer.y || rect.height * 0.3,
      };
      const g = build(kind, start);
      garlands.push(g);
      carried = g;
      run();
    });
  });

  panel.querySelector<HTMLElement>('.garland-clear')!.addEventListener('click', () => {
    carried = null;
    dragged = null;
    // Let go rather than delete: they fall off the bottom of the altar, which
    // is what taking a garland down looks like.
    for (const g of garlands) {
      g.discarded = true;
      g.stack = null;
      g.rope.release();
    }
    run();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      // Frame-hung garlands follow the frame. Free ones are left where they
      // are: there is no right answer for them, and re-draping every garland
      // on every resize tick looks like an earthquake.
      for (const g of garlands) {
        if (g.stack !== null) hangOnFrame(g, g.stack);
      }
      run();
    }, 180);
  });

  // Tracked on the window as well as the canvas, so a garland taken from the
  // panel is already in the hand that pressed the button.
  window.addEventListener('pointermove', e => {
    const rect = altar.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  });
}

/**
 * Only garland mode grabs the pointer. Outside it the garlands are scenery and
 * the canvas has to let clicks through to the lotus and everything under it.
 */
export function setGarlandActive(active: boolean) {
  document.querySelector('.garland-canvas')?.classList.toggle('grabbing', active);
}
