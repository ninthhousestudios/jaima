/**
 * The thread a garland hangs on.
 *
 * A Verlet strand: positions and their previous positions, gravity, and a few
 * rounds of relaxing every segment back to its rest length. There are no
 * velocities to integrate and no springs to tune, which is why this is forty
 * lines rather than a physics engine — and Verlet is unconditionally stable
 * under the one thing that happens here constantly, a pinned end being yanked
 * across the screen faster than any spring would survive.
 *
 * The strand is open, not a closed loop, and its two ends are the pins. That
 * single choice is the whole interaction:
 *
 *   - both pins on the cursor  -> it hangs from one hand in a long narrow U
 *   - pins on the frame's top corners -> it spreads into a wide shallow drape
 *
 * The rest length never changes between those, so the drape follows from the
 * pin separation exactly the way a real garland's does. Nothing has to
 * animate the transition; letting go re-pins the ends and the sag falls out
 * of the simulation.
 */

export interface Node {
  x: number;
  y: number;
  /** Previous position. The velocity is implicit in (x - px, y - py). */
  px: number;
  py: number;
}

/** Fraction of velocity kept per step — the air a garland swings through. */
const DAMPING = 0.94;

/** How hard a segment is pulled back to its rest length, per relaxation pass. */
const PASSES = 8;

/** Below this much movement the strand is at rest and the loop can stop. */
const SETTLED = 0.06;

export class Rope {
  readonly nodes: Node[];
  /** Distance between neighbouring nodes when the strand hangs slack. */
  readonly segment: number;
  /** Pixels per step², already scaled by the garland's size. */
  private readonly gravity: number;
  /**
   * How far apart the ends sit when the garland is held in one hand.
   *
   * Not zero, and that matters: pinned to the very same point, with gravity
   * straight down, every node shares an x and the strand is a perfectly
   * collinear vertical line — the two sides of the loop exactly overlap and
   * it never reads as a loop at all. A hand holding a garland does keep the
   * two strands a hand's width apart, so this is the honest value anyway.
   */
  private readonly spread: number;

  /** Where the two ends are held. */
  pinA: { x: number; y: number };
  pinB: { x: number; y: number };
  /** Cleared by `release()`, after which the whole strand falls. */
  pinned = true;

  constructor(
    count: number,
    segment: number,
    gravity: number,
    spread: number,
    at: { x: number; y: number },
  ) {
    this.segment = segment;
    this.gravity = gravity;
    this.spread = spread;
    this.pinA = { x: at.x - spread / 2, y: at.y };
    this.pinB = { x: at.x + spread / 2, y: at.y };
    // Born as a narrow U rather than a straight line, so the first frame is
    // already a plausible garland and not a rod that whips into shape.
    this.nodes = Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      const x = at.x + (spread / 2) * Math.tanh((t - 0.5) * 6);
      const y = at.y + Math.sin(t * Math.PI) ** 0.5 * segment * count * 0.42;
      return { x, y, px: x, py: y };
    });
  }

  /** Hold the garland at one point — carried in one hand. */
  hold(x: number, y: number): void {
    this.pinA = { x: x - this.spread / 2, y };
    this.pinB = { x: x + this.spread / 2, y };
    this.pinned = true;
  }

  /** Move the pins apart — a garland hung over two corners. */
  drape(ax: number, ay: number, bx: number, by: number): void {
    this.pinA = { x: ax, y: ay };
    this.pinB = { x: bx, y: by };
    this.pinned = true;
  }

  /** Let go of both ends. Used by Clear, so the garlands fall off the altar. */
  release(): void {
    this.pinned = false;
  }

  /** Advance one step. Returns true while anything is still moving. */
  step(): boolean {
    for (const n of this.nodes) {
      const vx = (n.x - n.px) * DAMPING;
      const vy = (n.y - n.py) * DAMPING;
      n.px = n.x;
      n.py = n.y;
      n.x += vx;
      n.y += vy + this.gravity;
    }

    // Relaxation. Each pass pulls every segment halfway back to rest from both
    // ends; several passes make the strand behave as one length rather than a
    // chain that stretches under its own weight. The pins are re-applied
    // inside the loop, not after it, or the last pass leaves them displaced.
    const last = this.nodes.length - 1;
    for (let pass = 0; pass < PASSES; pass++) {
      for (let i = 0; i < last; i++) {
        const a = this.nodes[i];
        const b = this.nodes[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const shift = ((dist - this.segment) / dist) * 0.5;
        const ox = dx * shift;
        const oy = dy * shift;
        a.x += ox;
        a.y += oy;
        b.x -= ox;
        b.y -= oy;
      }
      if (this.pinned) {
        this.nodes[0].x = this.pinA.x;
        this.nodes[0].y = this.pinA.y;
        this.nodes[last].x = this.pinB.x;
        this.nodes[last].y = this.pinB.y;
      }
    }

    // Measured here, after the constraints, rather than from (x - px) at the
    // top of the step. That reads the *previous* frame's displacement, so a
    // strand starting from rest reports itself settled on its very first call
    // and the animation loop shuts down before gravity has moved anything.
    let motion = 0;
    for (const n of this.nodes) {
      motion += Math.abs(n.x - n.px) + Math.abs(n.y - n.py);
    }
    return motion > SETTLED * this.nodes.length;
  }

  /** The strand's tangent at node i, for turning a flower to lie along it. */
  angleAt(i: number): number {
    const a = this.nodes[Math.max(0, i - 1)];
    const b = this.nodes[Math.min(this.nodes.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** True once every node has fallen past `y` — a released garland is gone. */
  below(y: number): boolean {
    return this.nodes.every(n => n.y > y);
  }

  /** Squared distance from a point to the nearest node, for hit testing. */
  nearest(x: number, y: number): number {
    let best = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < best) best = d;
    }
    return best;
  }

  /** Shift the whole strand, so picking one up does not snap it to the cursor. */
  translate(dx: number, dy: number): void {
    for (const n of this.nodes) {
      n.x += dx;
      n.y += dy;
      n.px += dx;
      n.py += dy;
    }
  }
}
