import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

const SHIP_SCENE_VERSION = 'motionpath-ship-rig-2026-07-28';
console.log('[ranu.win] warp-ship.js loaded:', SHIP_SCENE_VERSION);

const isLowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  /Mobi|Android/i.test(navigator.userAgent);
const STAR_SCALE = isLowPower ? 0.45 : 1;
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(190,235,255,0.85)');
  grad.addColorStop(0.5, 'rgba(79,200,255,0.35)');
  grad.addColorStop(1, 'rgba(79,200,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ============================================================================
// Ambient starfield — full-page background, static camera. The "warp tunnel" look comes
// entirely from stars streaming toward the camera (classic warp-speed effect), not from the
// camera itself moving, so it stays simple and never needs to track anything else on the page.
// ============================================================================
(function starfield() {
  const canvas = document.getElementById('warp-canvas');
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowPower, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isLowPower ? 1.5 : 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);
  scene.fog = new THREE.FogExp2(0x03040a, 0.0019);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 1.2, 6.5);
  camera.lookAt(0, 1.2, -10);

  const FAR_Z = -900;
  const NEAR_Z = 12;
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0x7c9bff);
  const colorC = new THREE.Color(0x5eead4);
  function pickColor() {
    const r = Math.random();
    return r < 0.75 ? colorA.clone().lerp(colorB, Math.random()) : colorA.clone().lerp(colorC, Math.random() * 0.7);
  }

  const BG_STAR_COUNT = Math.round(1600 * STAR_SCALE);
  const bgGeom = new THREE.BufferGeometry();
  const bgPositions = new Float32Array(BG_STAR_COUNT * 3);
  const bgColors = new Float32Array(BG_STAR_COUNT * 3);
  for (let i = 0; i < BG_STAR_COUNT; i++) {
    const i3 = i * 3;
    const radius = 300 + Math.random() * 600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    bgPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
    bgPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    bgPositions[i3 + 2] = -Math.abs(radius * Math.cos(phi)) - 50;
    const b = 0.5 + Math.random() * 0.5;
    bgColors[i3] = bgColors[i3 + 1] = bgColors[i3 + 2] = b;
  }
  bgGeom.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3));
  bgGeom.setAttribute('color', new THREE.BufferAttribute(bgColors, 3));
  const bgMat = new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, opacity: 0.7, sizeAttenuation: false, fog: false });
  const bgStars = new THREE.Points(bgGeom, bgMat);
  scene.add(bgStars);

  function makeStreakLayer(opts) {
    const count = Math.max(1, Math.round(opts.count * STAR_SCALE));
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 3);
    const stars = [];

    function resetStar(i) {
      const angle = Math.random() * Math.PI * 2;
      const radius = opts.radiusMin + Math.sqrt(Math.random()) * (opts.radiusMax - opts.radiusMin);
      stars[i] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.6,
        z: FAR_Z - Math.random() * 400,
        speed: opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin)
      };
    }
    for (let i = 0; i < count; i++) {
      resetStar(i);
      stars[i].z = FAR_Z + Math.random() * (NEAR_Z - FAR_Z);
      const c = pickColor();
      const i6 = i * 6;
      colors[i6] = colors[i6 + 3] = c.r;
      colors[i6 + 1] = colors[i6 + 4] = c.g;
      colors[i6 + 2] = colors[i6 + 5] = c.b;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: opts.opacity,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    const lines = new THREE.LineSegments(geom, mat);
    scene.add(lines);

    return {
      update(dt, speed) {
        const posAttr = geom.attributes.position;
        for (let i = 0; i < count; i++) {
          const s = stars[i];
          s.z += speed * s.speed * dt;
          if (s.z > NEAR_Z) resetStar(i);
          const dist = Math.max(NEAR_Z - s.z, 0.6);
          const len = clamp((1.5 * speed * s.speed) / dist, opts.lenMin, opts.lenMax);
          const i6 = i * 6;
          posAttr.array[i6] = s.x;
          posAttr.array[i6 + 1] = s.y + 1.2;
          posAttr.array[i6 + 2] = s.z;
          posAttr.array[i6 + 3] = s.x;
          posAttr.array[i6 + 4] = s.y + 1.2;
          posAttr.array[i6 + 5] = s.z - len;
        }
        posAttr.needsUpdate = true;
      }
    };
  }

  const streakLayers = [
    makeStreakLayer({ count: 500, radiusMin: 20, radiusMax: 42, speedMin: 0.15, speedMax: 0.3, lenMin: 0.5, lenMax: 1.2, opacity: 0.55 }),
    makeStreakLayer({ count: 650, radiusMin: 13, radiusMax: 29, speedMin: 0.45, speedMax: 0.7, lenMin: 1.2, lenMax: 2.5, opacity: 0.75 }),
    makeStreakLayer({ count: 600, radiusMin: 6, radiusMax: 19, speedMin: 0.9, speedMax: 1.3, lenMin: 2.5, lenMax: 5, opacity: 0.9 }),
    makeStreakLayer({ count: 400, radiusMin: 2, radiusMax: 11, speedMin: 1.7, speedMax: 2.5, lenMin: 4.5, lenMax: 9, opacity: 1, additive: true })
  ];

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let active = true;
  document.addEventListener('visibilitychange', () => { active = !document.hidden; });

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!active) return;
    for (const layer of streakLayers) layer.update(dt, 90);
    bgStars.rotation.y += dt * 0.006;
    bgStars.rotation.x += dt * 0.002;
    renderer.render(scene, camera);
  }
  animate();
})();

// ============================================================================
// Ship rig — a small, fixed HUD-style canvas (see #ship-rig in style.css) with its own static
// camera; the ship just idles (gentle bob/yaw + the existing engine flicker) in place. The rig's
// on-screen POSITION is what travels between sections, animated by GSAP MotionPathPlugin on the
// outer #ship-rig div's CSS transform (see the page-driver section below) — kept completely
// separate from the 3D scene itself, so "where the ship visually sits" is plain, predictable
// CSS/DOM logic instead of 3D world-to-screen projection that previously kept colliding with
// the text panels.
// ============================================================================
const shipReady = { model: false };
(function shipRig() {
  const canvas = document.getElementById('ship-canvas');
  const rig = document.getElementById('ship-rig');
  if (!canvas || !rig) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowPower, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.3, 6.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x8891b0, 1.2));
  const keyLight = new THREE.DirectionalLight(0xcfdaff, 1.2);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xf5843e, 1.8);
  fillLight.position.set(-3, 1, -2);
  scene.add(fillLight);

  const ship = new THREE.Group();
  scene.add(ship);
  const flames = [];
  const thrusterLights = [];
  const glowTexture = makeGlowTexture();
  const SHIP_TARGET_SIZE = 3.2;

  function makeEnginePlasma(parent, localPos, glowSize) {
    const mat = new THREE.SpriteMaterial({ map: glowTexture, color: 0x4fc8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(glowSize, glowSize, 1);
    sprite.position.copy(localPos);
    sprite.userData.baseScale = { x: glowSize, y: glowSize };
    parent.add(sprite);
    flames.push(sprite);

    const light = new THREE.PointLight(0x4fc8ff, 1.4, glowSize * 8);
    light.position.copy(localPos);
    parent.add(light);
    thrusterLights.push(light);
  }

  function buildFallbackShip() {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xdedaca, metalness: 0.7, roughness: 0.3 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x336480, emissive: 0x336480, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.4 });
    const fallback = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.3, 8), hullMat);
    body.rotation.x = -Math.PI / 2;
    fallback.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.9), trimMat);
    wing.position.set(0, -0.05, 0.6);
    fallback.add(wing);
    fallback.scale.setScalar(0.68);
    ship.add(fallback);
    shipReady.model = true;
  }

  const shipBaseTint = new THREE.Color(0xdedaca);
  const loader = new GLTFLoader();
  loader.load(
    'models/spaceship.glb',
    (gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scaleFactor = SHIP_TARGET_SIZE / maxDim;

      model.position.sub(center);

      const pivot = new THREE.Group();
      pivot.add(model);
      pivot.scale.setScalar(scaleFactor);
      pivot.rotation.y = Math.PI;
      ship.add(pivot);

      const ENGINE_NAME_RE = /engine|turbine|booster/i;
      const enginePlasmaBudget = { count: 0 };
      model.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        obj.castShadow = false;
        obj.receiveShadow = false;

        const isEngine = ENGINE_NAME_RE.test(obj.material.name || '') || ENGINE_NAME_RE.test(obj.name || '');
        if (isEngine && obj.material.emissiveMap) {
          obj.material.emissive = new THREE.Color(0x4fc8ff);
          obj.material.emissiveIntensity = 1.5;
        } else if (!isEngine) {
          obj.material.color = obj.material.color ? obj.material.color.multiply(shipBaseTint) : shipBaseTint.clone();
          obj.material.emissiveIntensity = Math.max(obj.material.emissiveIntensity || 0, 0.6);
        }

        if (/rear_emission/i.test(obj.name || '') && enginePlasmaBudget.count < 4) {
          const meshBox = new THREE.Box3().setFromObject(obj);
          const meshCenter = meshBox.getCenter(new THREE.Vector3()).sub(center);
          const meshSize = meshBox.getSize(new THREE.Vector3());
          const glowSize = Math.max(meshSize.x, meshSize.y, meshSize.z) * 1.4 || 0.3;
          makeEnginePlasma(pivot, meshCenter, glowSize);
          enginePlasmaBudget.count++;
        }
      });

      shipReady.model = true;
    },
    undefined,
    (err) => {
      console.warn('[ranu.win] spaceship.glb failed to load, using fallback ship:', err);
      buildFallbackShip();
    }
  );

  function resize() {
    const w = rig.clientWidth || 1, h = rig.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Gentle scale/opacity settle-in once the model is ready, instead of the old multi-stage
  // fly-in — the rig is a small fixed HUD element now, not a camera flying through the world.
  gsap.set(rig, { opacity: 0, scale: 0.85, transformOrigin: '50% 50%' });
  const introTicker = setInterval(() => {
    if (shipReady.model) {
      clearInterval(introTicker);
      gsap.to(rig, { opacity: 1, scale: 1, duration: reducedMotion ? 0.2 : 1.1, ease: 'power3.out' });
    }
  }, 80);

  let active = true;
  document.addEventListener('visibilitychange', () => { active = !document.hidden; });

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!active) return;

    if (shipReady.model && !reducedMotion) {
      const t = performance.now() * 0.001;
      ship.rotation.y = Math.sin(t * 0.4) * 0.18;
      ship.rotation.z = Math.sin(t * 0.5 + 1) * 0.06;
      ship.position.y = Math.sin(t * 0.6) * 0.08;
    }

    const flicker = 1 + Math.sin(performance.now() * 0.02) * 0.12 + Math.random() * 0.08;
    for (const flame of flames) {
      const base = flame.userData.baseScale;
      flame.scale.set(base.x * flicker, base.y * flicker, 1);
    }
    for (const light of thrusterLights) {
      light.intensity = 1.4 + Math.sin(performance.now() * 0.03) * 0.25 + Math.random() * 0.15;
    }

    renderer.render(scene, camera);
  }
  animate();
})();

// ============================================================================
// Page driver — moves the #ship-rig element between small, safe on-screen offsets (all well
// inside the right-hand gutter established by .panel's layout) as the page scrolls through each
// section, using GSAP MotionPathPlugin for a smooth curved path through those points, scrubbed
// by ScrollTrigger tied to the actual section elements. Deliberately small hand-picked offsets
// (tens of px) rather than deriving path points from raw DOM measurements of off-screen content
// — with sections of very different heights (Experience vs. the others), raw measurements would
// reproduce the same fragility that broke the previous 3D version.
// ============================================================================
(function pageDriver() {
  const rig = document.getElementById('ship-rig');
  if (!rig) return;

  const waypointOffsets = [
    { id: 'hero', x: 0, y: 0 },
    { id: 'about', x: -36, y: -64 },
    { id: 'experience', x: 30, y: 46 },
    { id: 'skills', x: -32, y: -38 },
    { id: 'contact', x: 0, y: 0 }
  ];

  function build() {
    const startEl = document.querySelector('[data-waypoint="hero"]');
    const endEl = document.querySelector('[data-waypoint="contact"]');
    if (!startEl || !endEl) return;

    gsap.timeline({
      scrollTrigger: {
        trigger: startEl,
        start: 'top top',
        endTrigger: endEl,
        end: 'top top',
        scrub: reducedMotion ? true : 1
      }
    }).fromTo(rig,
      { x: waypointOffsets[0].x, y: waypointOffsets[0].y },
      { motionPath: { path: waypointOffsets, curviness: 1.2 }, ease: 'none', duration: 1 }
    );
  }

  build();
})();
