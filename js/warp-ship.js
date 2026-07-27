import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gsap } from 'gsap';
import { Observer } from 'gsap/Observer';

gsap.registerPlugin(Observer);

(function () {
  const SHIP_SCENE_VERSION = 'gsap-observer-quickto-2026-07-27';
  console.log('[ranu.win] warp-ship.js loaded:', SHIP_SCENE_VERSION);

  const canvas = document.getElementById('warp-canvas');
  if (!canvas) return;

  const isLowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    /Mobi|Android/i.test(navigator.userAgent);
  const STAR_SCALE = isLowPower ? 0.45 : 1;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowPower, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isLowPower ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  // Near-black navy instead of pure black — a small warmth that reads as "graded footage"
  // rather than a flat WebGL clear color.
  scene.background = new THREE.Color(0x03040a);
  scene.fog = new THREE.FogExp2(0x03040a, 0.0019);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);

  // ---------- Lights ----------
  scene.add(new THREE.AmbientLight(0x8891b0, 1.1));
  const keyLight = new THREE.DirectionalLight(0xcfdaff, 1.1);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);
  const shipFillLight = new THREE.DirectionalLight(0xf5843e, 1.8);
  shipFillLight.position.set(-3, 1, -2);
  scene.add(shipFillLight);

  // ---------- Ship ----------
  const ship = new THREE.Group();
  ship.rotation.order = 'YXZ'; // yaw (path heading) applied before pitch/bank, avoids gimbal fighting on tight turns
  const flames = [];
  const SHIP_TARGET_SIZE = 2.8;
  const SHIP_BASE_Y = 1.2;
  let modelReady = false;
  const thrusterLights = [];

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
  const glowTexture = makeGlowTexture();

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
    const wingGeo = new THREE.BoxGeometry(2.2, 0.06, 0.9);
    const wing = new THREE.Mesh(wingGeo, trimMat);
    wing.position.set(0, -0.05, 0.6);
    fallback.add(wing);
    fallback.scale.setScalar(0.68);
    ship.add(fallback);
    modelReady = true;
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

      modelReady = true;
    },
    undefined,
    (err) => {
      console.warn('[ranu.win] spaceship.glb failed to load, using fallback ship:', err);
      buildFallbackShip();
    }
  );

  scene.add(ship);

  // ---------- Flight path: one waypoint per section, ship+camera travel it as the page scrolls ----------
  // Lateral swing is intentionally mild (a few units, not a slalom) so the ride reads as a calm
  // glide between destinations rather than a dizzying weave.
  const waypointDefs = [
    { id: 'hero', pos: new THREE.Vector3(0, SHIP_BASE_Y, 0) },
    { id: 'about', pos: new THREE.Vector3(-4, SHIP_BASE_Y + 1, -80) },
    { id: 'experience', pos: new THREE.Vector3(4.5, SHIP_BASE_Y - 0.6, -170) },
    { id: 'skills', pos: new THREE.Vector3(-4, SHIP_BASE_Y + 1.2, -250) },
    { id: 'contact', pos: new THREE.Vector3(0, SHIP_BASE_Y, -330) }
  ];
  const flightCurve = new THREE.CatmullRomCurve3(waypointDefs.map((w) => w.pos), false, 'catmullrom', 0.5);
  const NUM_SEGMENTS = waypointDefs.length - 1;

  // Glowing beacons mark each destination (not the hero start) so arrival reads as "reaching a place."
  const waypointMarkers = waypointDefs.slice(1).map((w) => {
    const mat = new THREE.SpriteMaterial({ map: glowTexture, color: 0x7c9bff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(w.pos);
    sprite.scale.setScalar(4);
    scene.add(sprite);
    const light = new THREE.PointLight(0x7c9bff, 0, 24);
    light.position.copy(w.pos);
    scene.add(light);
    return { sprite, light, pos: w.pos };
  });

  // ---------- Scroll -> flight-curve parameter t, driven by GSAP Observer + quickTo ----------
  // Section pixel offsets still give the exact per-section t breakpoints (so arrival stays
  // synced to content), but instead of ScrollTrigger's scroll-linked scrub, an Observer
  // normalizes wheel/touch/scroll input and a quickTo() eases flightState.t toward the target
  // on GSAP's own ticker — snappier and less laggy-feeling than a scrub timeline.
  const flightState = { t: 0 };
  let breakpoints = waypointDefs.map(() => 0);
  function computeBreakpoints() {
    breakpoints = waypointDefs.map((w) => {
      const el = document.querySelector(`[data-waypoint="${w.id}"]`);
      return el ? el.getBoundingClientRect().top + window.scrollY : 0;
    });
  }
  function scrollT() {
    const y = window.scrollY;
    if (y <= breakpoints[0]) return 0;
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const isLast = i === NUM_SEGMENTS - 1;
      if (y <= breakpoints[i + 1] || isLast) {
        const span = Math.max(breakpoints[i + 1] - breakpoints[i], 1);
        const frac = clamp((y - breakpoints[i]) / span, 0, 1);
        return (i + frac) / NUM_SEGMENTS;
      }
    }
    return 1;
  }
  const setFlightT = gsap.quickTo(flightState, 't', { duration: reducedMotion ? 0.001 : 0.6, ease: 'power3.out' });
  function syncFlightTarget() { setFlightT(scrollT()); }

  Observer.create({ target: window, type: 'wheel,touch,scroll', tolerance: 0, onChange: syncFlightTarget });
  window.addEventListener('resize', () => { computeBreakpoints(); syncFlightTarget(); });
  window.addEventListener('load', () => { computeBreakpoints(); syncFlightTarget(); });

  // ---------- Warp starfield: parallax layers recentred on the camera every frame, so the tunnel
  // travels with the ship along the whole flight path instead of sitting at a fixed world position ----------
  const NEAR_LOCAL = 12;
  const FAR_LOCAL = -400;
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
        z: FAR_LOCAL - Math.random() * 400,
        speed: opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin)
      };
    }
    for (let i = 0; i < count; i++) {
      resetStar(i);
      stars[i].z = FAR_LOCAL + Math.random() * (NEAR_LOCAL - FAR_LOCAL);
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
      update(dt, globalSpeed, camPos) {
        const posAttr = geom.attributes.position;
        for (let i = 0; i < count; i++) {
          const s = stars[i];
          s.z += globalSpeed * s.speed * dt;
          if (s.z > NEAR_LOCAL) resetStar(i);
          const dist = Math.max(NEAR_LOCAL - s.z, 0.6);
          const len = clamp((1.5 * globalSpeed * s.speed) / dist, opts.lenMin, opts.lenMax);
          const i6 = i * 6;
          posAttr.array[i6] = camPos.x + s.x;
          posAttr.array[i6 + 1] = camPos.y + s.y;
          posAttr.array[i6 + 2] = camPos.z + s.z;
          posAttr.array[i6 + 3] = camPos.x + s.x;
          posAttr.array[i6 + 4] = camPos.y + s.y;
          posAttr.array[i6 + 5] = camPos.z + s.z - len;
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

  // ---------- Input: subtle look-around only (scroll drives actual travel now) ----------
  const input = { x: 0, y: 0 };
  const keyState = {};

  window.addEventListener('keydown', (e) => { keyState[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keyState[e.key.toLowerCase()] = false; });

  const HOVER_SENSITIVITY = 0.16;
  function hoverMove(clientX, clientY) {
    const nx = ((clientX / window.innerWidth) * 2 - 1) * HOVER_SENSITIVITY;
    const ny = ((clientY / window.innerHeight) * 2 - 1) * HOVER_SENSITIVITY;
    input.x = clamp(nx, -1, 1);
    input.y = clamp(-ny, -1, 1);
  }

  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragOrigin = { x: 0, y: 0 };

  function touchDown(clientX, clientY) {
    dragging = true;
    dragStart = { x: clientX, y: clientY };
    dragOrigin = { x: input.x, y: input.y };
  }
  function touchMove(clientX, clientY) {
    if (!dragging) return;
    const dx = (clientX - dragStart.x) / window.innerWidth;
    const dy = (clientY - dragStart.y) / window.innerHeight;
    input.x = clamp(dragOrigin.x - dx * 2.4, -1, 1);
    input.y = clamp(dragOrigin.y - dy * 2.4, -1, 1);
  }
  function touchUp() { dragging = false; }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') touchMove(e.clientX, e.clientY);
    else hoverMove(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touchDown(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', touchUp);
  canvas.style.pointerEvents = 'auto';

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function keyboardInput(dt) {
    let kx = 0, ky = 0;
    if (keyState['a'] || keyState['arrowleft']) kx -= 1;
    if (keyState['d'] || keyState['arrowright']) kx += 1;
    if (keyState['w'] || keyState['arrowup']) ky += 1;
    if (keyState['s'] || keyState['arrowdown']) ky -= 1;
    if (kx || ky) {
      input.x = clamp(input.x + kx * dt * 1.6, -1, 1);
      input.y = clamp(input.y + ky * dt * 1.6, -1, 1);
    }
  }

  // ---------- Resize ----------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  computeBreakpoints();
  syncFlightTarget();

  // ---------- Intro sequence: unchanged from V1, ship settles onto the flight path's start point ----------
  const REST_SCALE = 1.5;
  const REST_POS = waypointDefs[0].pos.clone();
  const introStages = [
    { pos: new THREE.Vector3(0, SHIP_BASE_Y, -190), scale: 0.05 },
    { pos: REST_POS.clone(), scale: REST_SCALE },
    { pos: new THREE.Vector3(0, -13, 7), scale: REST_SCALE * 4 },
    { pos: REST_POS.clone(), scale: REST_SCALE }
  ];
  const introStageDurations = [2.0, 1.0, 1.5];

  function linear(t) { return t; }
  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  const introStageEasings = [easeInCubic, linear, easeOutCubic];

  let introStageIndex = 0;
  let introStageT = 0;
  let introDone = false;

  ship.position.copy(introStages[0].pos);
  ship.scale.setScalar(introStages[0].scale);

  // ---------- Animation loop ----------
  const clock = new THREE.Clock();
  const CAM_DISTANCE = 6.5;
  const CAM_HEIGHT = 2.0;
  const LOOKAHEAD = 10;
  const FRAME_BIAS = 2.6;
  const tmpTangent = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);
  const tmpRight = new THREE.Vector3();
  const tmpCamTarget = new THREE.Vector3();
  const tmpLookTarget = new THREE.Vector3();
  let active = true;

  document.addEventListener('visibilitychange', () => { active = !document.hidden; });

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!active) return;

    keyboardInput(dt);

    if (modelReady && !introDone) {
      introStageT += dt;
      const duration = introStageDurations[introStageIndex];
      const t = Math.min(introStageT / duration, 1);
      const eased = introStageEasings[introStageIndex](t);
      const from = introStages[introStageIndex];
      const to = introStages[introStageIndex + 1];
      ship.position.lerpVectors(from.pos, to.pos, eased);
      ship.scale.setScalar(THREE.MathUtils.lerp(from.scale, to.scale, eased));
      if (t >= 1) {
        introStageIndex++;
        introStageT = 0;
        if (introStageIndex >= introStageDurations.length) introDone = true;
      }
      camera.position.set(REST_POS.x, REST_POS.y + CAM_HEIGHT, REST_POS.z + CAM_DISTANCE);
      camera.lookAt(REST_POS.x, REST_POS.y, REST_POS.z - LOOKAHEAD);
    } else if (modelReady) {
      // flightState.t is driven entirely by the Observer + quickTo pair above, already eased
      // toward the scroll-derived target — no extra per-frame smoothing needed here.
      const t = clamp(flightState.t, 0, 1);
      const shipPoint = flightCurve.getPoint(t);
      tmpTangent.copy(flightCurve.getTangent(clamp(t, 0.001, 0.999))).normalize();
      tmpRight.crossVectors(tmpTangent, tmpUp).normalize();

      ship.position.copy(shipPoint);
      const yawTarget = Math.atan2(tmpTangent.x, tmpTangent.z) + Math.PI;
      ship.rotation.y = THREE.MathUtils.lerp(ship.rotation.y, yawTarget, Math.min(dt * 3, 1));
      ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -input.x * 0.25, dt * 4);
      ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, input.y * 0.12, dt * 4);

      tmpCamTarget.copy(shipPoint)
        .addScaledVector(tmpTangent, -CAM_DISTANCE)
        .addScaledVector(tmpUp, CAM_HEIGHT)
        .addScaledVector(tmpRight, input.x * 0.6);
      camera.position.lerp(tmpCamTarget, Math.min(dt * 5, 1));

      // Section content panels sit left-aligned (see .panel in style.css) — bias the look target
      // left of the ship so the ship itself renders in the cleared right-hand portion of the
      // frame instead of straight ahead, where it would otherwise sit right behind the text.
      tmpLookTarget.copy(shipPoint)
        .addScaledVector(tmpTangent, LOOKAHEAD)
        .addScaledVector(tmpUp, input.y * 0.5)
        .addScaledVector(tmpRight, -FRAME_BIAS);
      camera.lookAt(tmpLookTarget);
      camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, -input.x * 0.03, dt * 4);

      // Small idle drift so the shot never sits perfectly still between scroll input — reads as
      // a held cinematic camera rather than a locked-off static one.
      if (!reducedMotion) {
        camera.position.x += Math.sin(performance.now() * 0.00035) * 0.12;
        camera.position.y += Math.cos(performance.now() * 0.00028) * 0.06;
      }

      // Waypoint beacons brighten as the ship closes in, so arriving at a section reads as
      // "reaching a destination" rather than just scrolling past a marker.
      for (const marker of waypointMarkers) {
        const dist = shipPoint.distanceTo(marker.pos);
        const proximity = clamp(1 - dist / 45, 0, 1);
        const pulse = 0.85 + Math.sin(performance.now() * 0.004) * 0.15;
        marker.sprite.material.opacity = proximity * 0.9 * pulse;
        marker.light.intensity = proximity * 2.2 * pulse;
      }
    }

    const flicker = 1 + Math.sin(performance.now() * 0.02) * 0.12 + Math.random() * 0.08;
    for (const flame of flames) {
      const base = flame.userData.baseScale;
      flame.scale.set(base.x * flicker, base.y * flicker, 1);
    }
    for (const light of thrusterLights) {
      light.intensity = 1.4 + Math.sin(performance.now() * 0.03) * 0.25 + Math.random() * 0.15;
    }

    const speed = 90 * (1 + Math.abs(input.x) * 0.15);
    for (const layer of streakLayers) layer.update(dt, speed, camera.position);

    bgStars.position.copy(camera.position);
    bgStars.rotation.y += dt * 0.006;
    bgStars.rotation.x += dt * 0.002;

    renderer.render(scene, camera);
  }

  animate();
})();
