/**
 * Procedural SVG flowers for the altar.
 *
 * Vector rather than photographs, for two reasons: a marigold is literally
 * concentric rings of ruffled petals, which is a shape vectors describe well;
 * and generated colour means the flowers can be tuned to the room's palette
 * instead of carrying a stock photo's white-studio lighting onto a dark altar.
 *
 * Every generator is seeded, so a given seed always produces the same flower
 * across reloads and resizes.
 */

/** mulberry32 — small, fast, good enough for scattering petals. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function n(value: number): string {
  return value.toFixed(2);
}

interface Ring {
  /** Distance from centre, as a fraction of the flower radius. */
  at: number;
  count: number;
  /** Petal length, as a fraction of the flower radius. */
  petal: number;
  lightness: number;
}

function ruffled(
  rings: Ring[],
  radius: number,
  hue: number,
  sat: number,
  rand: () => number,
): string {
  const parts: string[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const angle = (i / ring.count) * Math.PI * 2 + rand() * 0.35;
      const dist = ring.at * radius * (0.85 + rand() * 0.3);
      const cx = Math.cos(angle) * dist;
      const cy = Math.sin(angle) * dist;
      const rx = ring.petal * radius * (0.8 + rand() * 0.4);
      const ry = rx * (0.58 + rand() * 0.34);
      const rot = (angle * 180) / Math.PI + 90;
      const light = ring.lightness + rand() * 7;
      parts.push(
        `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"` +
          ` transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"` +
          ` fill="hsl(${n(hue)} ${sat}% ${n(light)}%)"/>`,
      );
    }
  }
  return parts.join('');
}

/** Many small petals, densest at the rim — the temple flower. */
export function marigold(radius: number, seed: number, hue = 33): string {
  const rand = seeded(seed);
  return ruffled(
    [
      { at: 1.0, count: 14, petal: 0.34, lightness: 51 },
      { at: 0.76, count: 12, petal: 0.31, lightness: 46 },
      { at: 0.52, count: 10, petal: 0.27, lightness: 41 },
      { at: 0.28, count: 8, petal: 0.23, lightness: 35 },
      { at: 0.08, count: 5, petal: 0.2, lightness: 30 },
    ],
    radius,
    hue + (rand() - 0.5) * 8,
    92,
    rand,
  );
}

/** Fewer, broader petals in a tighter spiral. */
export function rose(radius: number, seed: number, hue = 349): string {
  const rand = seeded(seed);
  return ruffled(
    [
      { at: 0.74, count: 7, petal: 0.5, lightness: 40 },
      { at: 0.46, count: 6, petal: 0.42, lightness: 33 },
      { at: 0.22, count: 5, petal: 0.32, lightness: 27 },
      { at: 0.05, count: 3, petal: 0.24, lightness: 22 },
    ],
    radius,
    hue + (rand() - 0.5) * 10,
    58,
    rand,
  );
}

/** Small five-petal white star. */
export function jasmine(radius: number, seed: number): string {
  const rand = seeded(seed);
  const parts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + rand() * 0.2;
    const cx = Math.cos(angle) * radius * 0.5;
    const cy = Math.sin(angle) * radius * 0.5;
    const rot = (angle * 180) / Math.PI + 90;
    parts.push(
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(radius * 0.5)}"` +
        ` ry="${n(radius * 0.3)}" transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"` +
        ` fill="hsl(38 42% ${n(84 + rand() * 8)}%)"/>`,
    );
  }
  parts.push(`<circle r="${n(radius * 0.2)}" fill="hsl(45 70% 72%)"/>`);
  return parts.join('');
}

/**
 * A loose scatter of fallen petals, for the ledge surface around the offerings.
 * Ellipses rather than shaped petals: at this size the silhouette is all that
 * survives, and the cost of a path per petal buys nothing.
 */
export function petalScatter(
  width: number,
  height: number,
  count: number,
  seed: number,
): string {
  const rand = seeded(seed);
  const palette = [
    [33, 92, 52],
    [26, 90, 46],
    [45, 88, 58],
    [349, 58, 40],
    [340, 46, 52],
    [38, 40, 86],
  ];
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const [h, s, l] = palette[Math.floor(rand() * palette.length)];
    const cx = rand() * width;
    // Biased toward the back of the ledge so the front edge stays readable.
    const cy = height * (0.25 + Math.pow(rand(), 0.7) * 0.75);
    const rx = 2.6 + rand() * 3.4;
    const ry = rx * (0.42 + rand() * 0.3);
    const rot = rand() * 180;
    parts.push(
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"` +
        ` transform="rotate(${n(rot)} ${n(cx)} ${n(cy)})"` +
        ` fill="hsl(${h} ${s}% ${n(l + rand() * 10)}%)" opacity="${n(0.55 + rand() * 0.4)}"/>`,
    );
  }
  return parts.join('');
}

/**
 * A thoranam — the strung mango-leaf and marigold swag hung above a doorway or
 * shrine. Sags as a parabola, which is close enough to a catenary at this
 * shallow a droop that the difference is invisible.
 */
export function thoranam(
  width: number,
  sag: number,
  seed: number,
  leafCount = 26,
): string {
  const rand = seeded(seed);
  const droop = (t: number) => sag * (1 - Math.pow(2 * t - 1, 2));

  const cord: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    cord.push(`${i === 0 ? 'M' : 'L'} ${n(t * width)} ${n(droop(t))}`);
  }

  const parts = [
    `<path d="${cord.join(' ')}" fill="none" stroke="hsl(35 45% 38%)" stroke-width="2"/>`,
  ];

  for (let i = 0; i < leafCount; i++) {
    const t = (i + 0.5) / leafCount;
    const x = t * width;
    const y = droop(t);
    // Leaves hang plumb, but the string's slope tilts where they attach.
    const slope = (droop(t + 0.01) - droop(t - 0.01)) / (0.02 * width);
    const tilt = (Math.atan(slope) * 180) / Math.PI * 0.55 + (rand() - 0.5) * 12;
    const len = 26 + rand() * 12;
    const wide = len * (0.3 + rand() * 0.08);
    const green = 26 + rand() * 12;
    parts.push(
      `<path transform="translate(${n(x)} ${n(y)}) rotate(${n(tilt)})"` +
        ` d="M 0 0 Q ${n(wide)} ${n(len * 0.45)} 0 ${n(len)}` +
        ` Q ${n(-wide)} ${n(len * 0.45)} 0 0 Z"` +
        ` fill="hsl(${n(96 + rand() * 20)} 34% ${n(green)}%)"/>`,
    );

    // A marigold every fourth gap, sitting on the cord.
    if (i % 4 === 2) {
      const r = 9 + rand() * 4;
      parts.push(
        `<g transform="translate(${n(x)} ${n(y + 2)})">` +
          marigold(r, seed + i * 17) +
          `</g>`,
      );
    }
  }
  return parts.join('');
}
