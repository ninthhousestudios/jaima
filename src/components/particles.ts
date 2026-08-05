import * as THREE from 'three';

/**
 * Ambient particle field for the room: falling flower petals, incense smoke,
 * and embers rising off the lamp flames.
 *
 * The governing constraint (design.md): nothing moves faster than incense
 * smoke. A petal takes half a minute to cross the viewport.
 *
 * All motion is in world units per second. The orthographic frustum is 1 unit
 * tall, so a speed of 0.03 crosses the screen in ~33s.
 */

const PETAL_COUNT = 22;
// Divided round-robin between the burning tips, so it is a per-column budget
// as much as a total: three sticks at 27 is nine wisps a column. Deliberately
// thinner per column than the single stick's 16 — three columns as dense as
// that one was would be fog, and nothing here is allowed to out-shout the
// photo. Raise it in multiples of the stick count.
const SMOKE_COUNT = 27;
const EMBER_COUNT = 5;

/** Seconds for a petal to fall the full height of the viewport. */
const FALL_TIME_MIN = 26;
const FALL_TIME_MAX = 46;

interface Bounds {
  w: number;
  h: number;
}

/** Normalised viewport coordinates (0..1, origin top-left). */
export interface Source {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Textures — generated at runtime so the room ships no image assets.
// Each is drawn white-on-transparent with soft edges; per-particle colour
// comes from the material tint.
// ---------------------------------------------------------------------------

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Vertical shading ramp: petals are darker at the base, luminous at the tip. */
function petalShading(ctx: CanvasRenderingContext2D, size: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, size, 0, 0);
  g.addColorStop(0, 'rgba(150, 150, 150, 1)');
  g.addColorStop(0.45, 'rgba(225, 225, 225, 1)');
  g.addColorStop(1, 'rgba(255, 255, 255, 1)');
  return g;
}

/** Broad, cupped, notched at the tip — rose. */
function roseTexture(): THREE.Texture {
  return canvasTexture(128, (ctx) => {
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = petalShading(ctx, 128);
    ctx.beginPath();
    ctx.moveTo(64, 120);
    ctx.bezierCurveTo(12, 104, 6, 42, 52, 14);
    ctx.quadraticCurveTo(64, 24, 76, 14);
    ctx.bezierCurveTo(122, 42, 116, 104, 64, 120);
    ctx.closePath();
    ctx.fill();

    ctx.filter = 'blur(5px)';
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(64, 116);
    ctx.lineTo(64, 34);
    ctx.stroke();
  });
}

/** Small ruffled wedge — marigold. */
function marigoldTexture(): THREE.Texture {
  return canvasTexture(128, (ctx) => {
    ctx.filter = 'blur(2.5px)';
    ctx.fillStyle = petalShading(ctx, 128);
    ctx.beginPath();
    ctx.moveTo(64, 122);
    ctx.bezierCurveTo(30, 100, 20, 56, 30, 30);
    // Ruffled top edge — three shallow lobes.
    ctx.quadraticCurveTo(42, 12, 52, 28);
    ctx.quadraticCurveTo(64, 8, 76, 28);
    ctx.quadraticCurveTo(86, 12, 98, 30);
    ctx.bezierCurveTo(108, 56, 98, 100, 64, 122);
    ctx.closePath();
    ctx.fill();
  });
}

/** Narrow and elongated — jasmine. */
function jasmineTexture(): THREE.Texture {
  return canvasTexture(128, (ctx) => {
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = petalShading(ctx, 128);
    ctx.beginPath();
    ctx.moveTo(64, 124);
    ctx.bezierCurveTo(44, 96, 40, 40, 64, 8);
    ctx.bezierCurveTo(88, 40, 84, 96, 64, 124);
    ctx.closePath();
    ctx.fill();
  });
}

/** Soft radial falloff, used for both smoke puffs and embers. */
function softDiscTexture(): THREE.Texture {
  return canvasTexture(64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.4, 'rgba(255, 255, 255, 0.55)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

// ---------------------------------------------------------------------------
// Petals
// ---------------------------------------------------------------------------

interface PetalKind {
  texture: THREE.Texture;
  colors: number[];
  /** Petal height in world units, min/max. */
  size: [number, number];
  /** Relative spawn frequency. */
  weight: number;
}

function petalKinds(): PetalKind[] {
  return [
    {
      texture: roseTexture(),
      colors: [0xb8324f, 0xd4506a, 0xe07890, 0xf0a8b8, 0xc94060],
      size: [0.028, 0.048],
      weight: 4,
    },
    {
      texture: marigoldTexture(),
      colors: [0xff8c1a, 0xf5a623, 0xffc233, 0xe07b00, 0xffb347],
      size: [0.018, 0.032],
      weight: 4,
    },
    {
      texture: jasmineTexture(),
      colors: [0xfffaf0, 0xfff3e0, 0xf5ead8],
      size: [0.014, 0.024],
      weight: 3,
    },
  ];
}

interface Petal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Terminal fall speed in world units per second, before drag. */
  fallSpeed: number;
  /** Falling-leaf oscillation. */
  swingPhase: number;
  swingSpeed: number;
  swingAmp: number;
  /** How far the petal turns over as it swings — drives the catch-the-light flash. */
  swingTilt: number;
  /** Slow spin about the petal's own axis. */
  spinSpeed: number;
  drift: number;
}

const PLANE = new THREE.PlaneGeometry(1, 1);
const FACE_NORMAL = new THREE.Vector3(0, 0, 1);

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pickKind(kinds: PetalKind[]): PetalKind {
  const total = kinds.reduce((sum, k) => sum + k.weight, 0);
  let roll = Math.random() * total;
  for (const kind of kinds) {
    roll -= kind.weight;
    if (roll <= 0) return kind;
  }
  return kinds[kinds.length - 1];
}

function spawnPetal(petal: Petal, kinds: PetalKind[], bounds: Bounds, atTop: boolean) {
  const kind = pickKind(kinds);
  petal.material.map = kind.texture;
  petal.material.color.setHex(pick(kind.colors));
  petal.material.needsUpdate = true;

  const height = kind.size[0] + Math.random() * (kind.size[1] - kind.size[0]);
  petal.mesh.scale.set(height * 0.75, height, 1);

  const y = atTop
    ? bounds.h * 0.5 + height + Math.random() * 0.2
    : (Math.random() - 0.5) * bounds.h;
  petal.mesh.position.set(
    (Math.random() - 0.5) * bounds.w * 1.05,
    y,
    -0.12 + Math.random() * 0.24,
  );

  const fallTime = FALL_TIME_MIN + Math.random() * (FALL_TIME_MAX - FALL_TIME_MIN);
  petal.fallSpeed = (bounds.h * 1.3) / fallTime;

  petal.swingPhase = Math.random() * Math.PI * 2;
  petal.swingSpeed = 0.18 + Math.random() * 0.3;
  petal.swingAmp = 0.012 + Math.random() * 0.03;
  petal.swingTilt = 0.9 + Math.random() * 1.4;
  petal.spinSpeed = (Math.random() - 0.5) * 0.16;
  petal.drift = (Math.random() - 0.5) * 0.004;

  petal.mesh.rotation.set(0, 0, Math.random() * Math.PI * 2);
}

function createPetal(scene: THREE.Scene, kinds: PetalKind[], bounds: Bounds): Petal {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(PLANE, material);
  scene.add(mesh);

  const petal: Petal = {
    mesh,
    material,
    fallSpeed: 0,
    swingPhase: 0,
    swingSpeed: 0,
    swingAmp: 0,
    swingTilt: 0,
    spinSpeed: 0,
    drift: 0,
  };
  spawnPetal(petal, kinds, bounds, false);
  return petal;
}

// ---------------------------------------------------------------------------
// Incense smoke — emitted from a point on the altar, not from the screen edge.
// A coherent column near the source that breaks up as it rises.
// ---------------------------------------------------------------------------

interface Wisp {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  rise: number;
  /** Two incommensurate frequencies give non-repeating lateral wander. */
  wanderPhaseA: number;
  wanderPhaseB: number;
  wanderAmp: number;
  spread: number;
  baseSize: number;
  /** Which burning tip this wisp belongs to; wrapped, so the count of tips
      can change under it without leaving wisps orphaned mid-rise. */
  source: number;
}

function wispSource(wisp: Wisp, sources: THREE.Vector2[]): THREE.Vector2 {
  return sources[wisp.source % sources.length];
}

function resetWisp(wisp: Wisp, sources: THREE.Vector2[], stagger: boolean) {
  const source = wispSource(wisp, sources);
  wisp.life = stagger ? Math.random() * wisp.maxLife : 0;
  wisp.maxLife = 14 + Math.random() * 10;
  wisp.rise = 0.016 + Math.random() * 0.012;
  wisp.wanderPhaseA = Math.random() * Math.PI * 2;
  wisp.wanderPhaseB = Math.random() * Math.PI * 2;
  wisp.wanderAmp = 0.012 + Math.random() * 0.02;
  wisp.spread = 0.5 + Math.random() * 0.9;
  wisp.baseSize = 0.012 + Math.random() * 0.014;
  wisp.mesh.position.set(
    source.x + (Math.random() - 0.5) * 0.004,
    source.y,
    0.02,
  );
  wisp.mesh.rotation.z = Math.random() * Math.PI * 2;
}

function createWisp(
  scene: THREE.Scene,
  texture: THREE.Texture,
  sources: THREE.Vector2[],
  source: number,
): Wisp {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xd8cbbc,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(PLANE, material);
  scene.add(mesh);

  const wisp: Wisp = {
    mesh,
    material,
    life: 0,
    maxLife: 20,
    rise: 0,
    wanderPhaseA: 0,
    wanderPhaseB: 0,
    wanderAmp: 0,
    spread: 0,
    baseSize: 0,
    source,
  };
  resetWisp(wisp, sources, true);
  return wisp;
}

// ---------------------------------------------------------------------------
// Embers — a handful, tethered to the flames, rising a short way and dying.
// ---------------------------------------------------------------------------

interface Ember {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  rise: number;
  sway: number;
  swayPhase: number;
  flickerPhase: number;
  flickerSpeed: number;
}

function resetEmber(ember: Ember, sources: THREE.Vector2[]) {
  const source = sources.length > 0 ? pick(sources) : new THREE.Vector2(0, 0);
  ember.life = 0;
  ember.maxLife = 3 + Math.random() * 4;
  ember.rise = 0.012 + Math.random() * 0.014;
  ember.sway = 0.004 + Math.random() * 0.006;
  ember.swayPhase = Math.random() * Math.PI * 2;
  ember.flickerPhase = Math.random() * Math.PI * 2;
  ember.flickerSpeed = 3 + Math.random() * 5;
  const size = 0.0035 + Math.random() * 0.004;
  ember.mesh.scale.set(size, size, 1);
  ember.mesh.position.set(
    source.x + (Math.random() - 0.5) * 0.01,
    source.y + (Math.random() - 0.5) * 0.006,
    0.06,
  );
}

function createEmber(scene: THREE.Scene, texture: THREE.Texture, sources: THREE.Vector2[]): Ember {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffb45a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(PLANE, material);
  scene.add(mesh);

  const ember: Ember = {
    mesh,
    material,
    life: 0,
    maxLife: 5,
    rise: 0,
    sway: 0,
    swayPhase: 0,
    flickerPhase: 0,
    flickerSpeed: 0,
  };
  resetEmber(ember, sources);
  ember.life = Math.random() * ember.maxLife;
  return ember;
}

// ---------------------------------------------------------------------------

export interface ParticleField {
  /** Anchor the smoke columns to the burning tips on the altar. */
  setIncenseSources(sources: Source[]): void;
  /** Tether the embers to the lamp flames. */
  setEmberSources(sources: Source[]): void;
}

export function initParticles(canvas: HTMLCanvasElement): ParticleField {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const frustumHeight = 1;
  let aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    -frustumHeight * aspect / 2, frustumHeight * aspect / 2,
    frustumHeight / 2, -frustumHeight / 2,
    0.1, 10,
  );
  camera.position.z = 1;

  const scene = new THREE.Scene();
  const bounds: Bounds = { w: frustumHeight * aspect, h: frustumHeight };

  /** Normalised viewport coords → world coords. */
  function toWorld(source: Source, out: THREE.Vector2): THREE.Vector2 {
    return out.set(
      (source.x - 0.5) * bounds.w,
      (0.5 - source.y) * bounds.h,
    );
  }

  // Placeholders until the altar reports where the incense and lamps sit.
  const incenseSources: THREE.Vector2[] = [new THREE.Vector2(0, -bounds.h * 0.34)];
  const emberSources: THREE.Vector2[] = [];

  const kinds = petalKinds();
  const disc = softDiscTexture();

  const petals: Petal[] = [];
  for (let i = 0; i < PETAL_COUNT; i++) {
    petals.push(createPetal(scene, kinds, bounds));
  }

  const wisps: Wisp[] = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    wisps.push(createWisp(scene, disc, incenseSources, i));
  }

  const embers: Ember[] = [];
  for (let i = 0; i < EMBER_COUNT; i++) {
    embers.push(createEmber(scene, disc, emberSources));
  }

  const clock = new THREE.Clock();
  const worldNormal = new THREE.Vector3();

  function updatePetals(dt: number) {
    for (const petal of petals) {
      petal.swingPhase += petal.swingSpeed * dt;

      // Coupled swing and tilt: the petal turns over as it swings, so it
      // catches the light face-on at the extremes of the arc.
      const swing = Math.sin(petal.swingPhase);
      petal.mesh.rotation.y = swing * petal.swingTilt;
      petal.mesh.rotation.x = Math.cos(petal.swingPhase * 0.7) * petal.swingTilt * 0.4;
      petal.mesh.rotation.z += petal.spinSpeed * dt;

      worldNormal.copy(FACE_NORMAL).applyQuaternion(petal.mesh.quaternion);
      const facing = Math.abs(worldNormal.z);

      // Face-on presents more area, so it falls slower and shows brighter.
      petal.mesh.position.y -= petal.fallSpeed * (1 - facing * 0.45) * dt;
      petal.mesh.position.x += (swing * petal.swingAmp + petal.drift) * dt * 6;

      const top = bounds.h * 0.5;
      const bottom = -bounds.h * 0.5;
      if (petal.mesh.position.y < bottom - 0.1) {
        spawnPetal(petal, kinds, bounds, true);
        continue;
      }

      const fadeIn = Math.min((top + 0.05 - petal.mesh.position.y) / 0.12, 1);
      const fadeOut = Math.min((petal.mesh.position.y - bottom + 0.1) / 0.14, 1);
      const flash = 0.2 + 0.8 * Math.pow(facing, 0.6);
      petal.material.opacity = Math.max(0, fadeIn * fadeOut) * flash * 0.72;
    }
  }

  function updateSmoke(dt: number) {
    for (const wisp of wisps) {
      wisp.life += dt;
      if (wisp.life >= wisp.maxLife) {
        resetWisp(wisp, incenseSources, false);
        continue;
      }

      const t = wisp.life / wisp.maxLife;

      // Coherent near the source, turbulent higher up.
      const turbulence = Math.pow(t, 1.6);
      const wander =
        Math.sin(wisp.life * 0.42 + wisp.wanderPhaseA) * 0.6 +
        Math.sin(wisp.life * 0.17 + wisp.wanderPhaseB) * 0.4;

      wisp.mesh.position.y += wisp.rise * dt;
      wisp.mesh.position.x =
        wispSource(wisp, incenseSources).x + wander * wisp.wanderAmp * turbulence;
      wisp.mesh.rotation.z += 0.06 * dt;

      const size = wisp.baseSize * (1 + t * wisp.spread * 6);
      wisp.mesh.scale.set(size, size * 1.25, 1);

      const fadeIn = Math.min(t / 0.12, 1);
      const fadeOut = 1 - Math.pow(t, 1.4);
      wisp.material.opacity = fadeIn * fadeOut * 0.13;
    }
  }

  function updateEmbers(dt: number) {
    for (const ember of embers) {
      ember.life += dt;
      if (ember.life >= ember.maxLife) {
        resetEmber(ember, emberSources);
        continue;
      }

      const t = ember.life / ember.maxLife;
      ember.mesh.position.y += ember.rise * (1 - t * 0.5) * dt;
      ember.mesh.position.x += Math.sin(ember.life * 1.7 + ember.swayPhase) * ember.sway * dt;

      const flicker = 0.55 + 0.45 * Math.sin(ember.life * ember.flickerSpeed + ember.flickerPhase);
      const fadeIn = Math.min(t / 0.15, 1);
      const fadeOut = 1 - Math.pow(t, 2);
      ember.material.opacity = fadeIn * fadeOut * flicker * 0.5;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    // Clamp so a backgrounded tab doesn't teleport everything on return.
    const dt = Math.min(clock.getDelta(), 0.05);

    updatePetals(dt);
    updateSmoke(dt);
    updateEmbers(dt);

    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    aspect = w / h;
    camera.left = -frustumHeight * aspect / 2;
    camera.right = frustumHeight * aspect / 2;
    camera.updateProjectionMatrix();
    bounds.w = frustumHeight * aspect;
  });

  // Remembered so they survive a resize, which changes the world mapping.
  let incenseNorm: Source[] = [];
  let emberNorm: Source[] = [];

  /** Refill in place: the wisps hold indices into these arrays, not the
      arrays themselves, but a source count of zero would leave them adrift. */
  function project(norm: Source[], into: THREE.Vector2[]) {
    if (norm.length === 0) return;
    into.length = 0;
    for (const s of norm) {
      into.push(toWorld(s, new THREE.Vector2()));
    }
  }

  function reproject() {
    project(incenseNorm, incenseSources);
    emberSources.length = 0;
    for (const s of emberNorm) {
      emberSources.push(toWorld(s, new THREE.Vector2()));
    }
  }

  window.addEventListener('resize', reproject);

  return {
    setIncenseSources(sources: Source[]) {
      incenseNorm = sources;
      project(incenseNorm, incenseSources);
    },
    setEmberSources(sources: Source[]) {
      emberNorm = sources;
      reproject();
    },
  };
}
