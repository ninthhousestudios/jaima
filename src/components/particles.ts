import * as THREE from 'three';

interface Petal {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  rotSpeed: THREE.Vector3;
  life: number;
  maxLife: number;
  drift: number;
  driftPhase: number;
}

interface Mote {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  pulsePhase: number;
  pulseSpeed: number;
}

interface SmokeWisp {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spread: number;
  initialScale: number;
}

const PETAL_COUNT = 12;
const MOTE_COUNT = 25;
const SMOKE_COUNT = 6;

const PETAL_COLORS = [
  0xf5c6d0, // soft pink
  0xfce4ec, // pale rose
  0xe8b5ce, // dusty pink
  0xf8e0e6, // blush
  0xfff3e0, // cream
  0xffe0b2, // light saffron
];

function createPetalGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.04);
  shape.bezierCurveTo(0.015, 0.035, 0.025, 0.02, 0.02, 0);
  shape.bezierCurveTo(0.015, -0.015, 0.005, -0.03, 0, -0.035);
  shape.bezierCurveTo(-0.005, -0.03, -0.015, -0.015, -0.02, 0);
  shape.bezierCurveTo(-0.025, 0.02, -0.015, 0.035, 0, 0.04);
  return new THREE.ShapeGeometry(shape);
}

function createPetal(scene: THREE.Scene, bounds: { w: number; h: number }): Petal {
  const color = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const geometry = createPetalGeometry();
  const mesh = new THREE.Mesh(geometry, material);

  const scale = 0.6 + Math.random() * 0.8;
  mesh.scale.set(scale, scale, scale);
  mesh.position.set(
    (Math.random() - 0.5) * bounds.w * 0.8,
    bounds.h * 0.5 + Math.random() * 0.1,
    -0.1 + Math.random() * 0.2,
  );
  mesh.rotation.set(
    Math.random() * Math.PI,
    Math.random() * Math.PI,
    Math.random() * Math.PI,
  );

  scene.add(mesh);

  const maxLife = 15 + Math.random() * 20;
  return {
    mesh,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.002,
      -(0.003 + Math.random() * 0.004),
      0,
    ),
    rotSpeed: new THREE.Vector3(
      (Math.random() - 0.5) * 0.008,
      (Math.random() - 0.5) * 0.006,
      (Math.random() - 0.5) * 0.01,
    ),
    life: 0,
    maxLife,
    drift: 0.001 + Math.random() * 0.002,
    driftPhase: Math.random() * Math.PI * 2,
  };
}

function createMote(scene: THREE.Scene, bounds: { w: number; h: number }): Mote {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd699,
    transparent: true,
    opacity: 0,
  });
  const geometry = new THREE.CircleGeometry(0.003 + Math.random() * 0.004, 8);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.set(
    (Math.random() - 0.5) * bounds.w,
    (Math.random() - 0.5) * bounds.h,
    0.05 + Math.random() * 0.1,
  );

  scene.add(mesh);

  const maxLife = 8 + Math.random() * 15;
  return {
    mesh,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.0005,
      0.001 + Math.random() * 0.002,
      0,
    ),
    life: 0,
    maxLife,
    pulsePhase: Math.random() * Math.PI * 2,
    pulseSpeed: 0.3 + Math.random() * 0.5,
  };
}

function createSmokeWisp(scene: THREE.Scene, bounds: { w: number; h: number }): SmokeWisp {
  const material = new THREE.MeshBasicMaterial({
    color: 0xc8b8a8,
    transparent: true,
    opacity: 0,
  });
  const geometry = new THREE.CircleGeometry(0.02, 16);
  const mesh = new THREE.Mesh(geometry, material);

  const xCenter = (Math.random() - 0.5) * bounds.w * 0.3;
  mesh.position.set(
    xCenter,
    -bounds.h * 0.35,
    0.02,
  );

  scene.add(mesh);

  const maxLife = 10 + Math.random() * 12;
  const initialScale = 0.5 + Math.random() * 0.5;
  mesh.scale.set(initialScale, initialScale, 1);

  return {
    mesh,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.001,
      0.002 + Math.random() * 0.003,
      0,
    ),
    life: 0,
    maxLife,
    spread: 0.003 + Math.random() * 0.004,
    initialScale,
  };
}

function resetPetal(petal: Petal, bounds: { w: number; h: number }) {
  petal.life = 0;
  petal.maxLife = 15 + Math.random() * 20;
  petal.mesh.position.set(
    (Math.random() - 0.5) * bounds.w * 0.8,
    bounds.h * 0.5 + Math.random() * 0.1,
    -0.1 + Math.random() * 0.2,
  );
  petal.velocity.set(
    (Math.random() - 0.5) * 0.002,
    -(0.003 + Math.random() * 0.004),
    0,
  );
  petal.driftPhase = Math.random() * Math.PI * 2;
  (petal.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
}

function resetMote(mote: Mote, bounds: { w: number; h: number }) {
  mote.life = 0;
  mote.maxLife = 8 + Math.random() * 15;
  mote.mesh.position.set(
    (Math.random() - 0.5) * bounds.w,
    (Math.random() - 0.5) * bounds.h,
    0.05 + Math.random() * 0.1,
  );
  mote.velocity.set(
    (Math.random() - 0.5) * 0.0005,
    0.001 + Math.random() * 0.002,
    0,
  );
  (mote.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
}

function resetSmoke(wisp: SmokeWisp, bounds: { w: number; h: number }) {
  wisp.life = 0;
  wisp.maxLife = 10 + Math.random() * 12;
  const xCenter = (Math.random() - 0.5) * bounds.w * 0.3;
  wisp.mesh.position.set(xCenter, -bounds.h * 0.35, 0.02);
  wisp.velocity.set(
    (Math.random() - 0.5) * 0.001,
    0.002 + Math.random() * 0.003,
    0,
  );
  wisp.initialScale = 0.5 + Math.random() * 0.5;
  wisp.mesh.scale.set(wisp.initialScale, wisp.initialScale, 1);
  (wisp.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
}

export function initParticles(canvas: HTMLCanvasElement) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);

  const aspect = w / h;
  const frustumHeight = 1;
  const camera = new THREE.OrthographicCamera(
    -frustumHeight * aspect / 2, frustumHeight * aspect / 2,
    frustumHeight / 2, -frustumHeight / 2,
    0.1, 10,
  );
  camera.position.z = 1;

  const scene = new THREE.Scene();

  const bounds = { w: frustumHeight * aspect, h: frustumHeight };

  const petals: Petal[] = [];
  const motes: Mote[] = [];
  const smokeWisps: SmokeWisp[] = [];

  for (let i = 0; i < PETAL_COUNT; i++) {
    const p = createPetal(scene, bounds);
    p.life = Math.random() * p.maxLife;
    petals.push(p);
  }
  for (let i = 0; i < MOTE_COUNT; i++) {
    const m = createMote(scene, bounds);
    m.life = Math.random() * m.maxLife;
    motes.push(m);
  }
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const s = createSmokeWisp(scene, bounds);
    s.life = Math.random() * s.maxLife;
    smokeWisps.push(s);
  }

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    for (const petal of petals) {
      petal.life += dt;
      if (petal.life >= petal.maxLife) {
        resetPetal(petal, bounds);
        continue;
      }

      const t = petal.life / petal.maxLife;
      const fadeIn = Math.min(t * 5, 1);
      const fadeOut = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      (petal.mesh.material as THREE.MeshBasicMaterial).opacity = fadeIn * fadeOut * 0.6;

      petal.mesh.position.x += (petal.velocity.x + Math.sin(petal.life * 0.5 + petal.driftPhase) * petal.drift) * dt * 60;
      petal.mesh.position.y += petal.velocity.y * dt * 60;

      petal.mesh.rotation.x += petal.rotSpeed.x * dt * 60;
      petal.mesh.rotation.y += petal.rotSpeed.y * dt * 60;
      petal.mesh.rotation.z += petal.rotSpeed.z * dt * 60;
    }

    for (const mote of motes) {
      mote.life += dt;
      if (mote.life >= mote.maxLife) {
        resetMote(mote, bounds);
        continue;
      }

      const t = mote.life / mote.maxLife;
      const fadeIn = Math.min(t * 4, 1);
      const fadeOut = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const pulse = 0.7 + 0.3 * Math.sin(mote.life * mote.pulseSpeed + mote.pulsePhase);
      (mote.mesh.material as THREE.MeshBasicMaterial).opacity = fadeIn * fadeOut * pulse * 0.4;

      mote.mesh.position.x += mote.velocity.x * dt * 60;
      mote.mesh.position.y += mote.velocity.y * dt * 60;
    }

    for (const wisp of smokeWisps) {
      wisp.life += dt;
      if (wisp.life >= wisp.maxLife) {
        resetSmoke(wisp, bounds);
        continue;
      }

      const t = wisp.life / wisp.maxLife;
      const fadeIn = Math.min(t * 3, 1);
      const fadeOut = t > 0.5 ? 1 - (t - 0.5) / 0.5 : 1;
      (wisp.mesh.material as THREE.MeshBasicMaterial).opacity = fadeIn * fadeOut * 0.08;

      wisp.mesh.position.x += wisp.velocity.x * dt * 60;
      wisp.mesh.position.y += wisp.velocity.y * dt * 60;
      wisp.velocity.x += (Math.random() - 0.5) * 0.00005;

      const scaleGrowth = wisp.initialScale + wisp.life * wisp.spread * 2;
      wisp.mesh.scale.set(scaleGrowth, scaleGrowth * 1.3, 1);
    }

    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    const rw = window.innerWidth;
    const rh = window.innerHeight;
    renderer.setSize(rw, rh);
    const newAspect = rw / rh;
    camera.left = -frustumHeight * newAspect / 2;
    camera.right = frustumHeight * newAspect / 2;
    camera.updateProjectionMatrix();
    bounds.w = frustumHeight * newAspect;
  });
}
