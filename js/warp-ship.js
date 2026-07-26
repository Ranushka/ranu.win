import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

(function () {
  const SHIP_SCENE_VERSION = 'v34-continuous-streak-length-2026-07-24';
  console.log('[ranu.win] warp-ship.js loaded:', SHIP_SCENE_VERSION);

  const canvas = document.getElementById('warp-canvas');
  const hero = document.getElementById('hero');
  if (!canvas) return;

  // Rough low-power heuristic (few CPU cores, low device memory, or a mobile UA) — cuts star
  // counts and render resolution on weaker devices instead of dropping frames on all of them.
  const isLowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    /Mobi|Android/i.test(navigator.userAgent);
  const STAR_SCALE = isLowPower ? 0.45 : 1;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowPower, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isLowPower ? 1.5 : 2));
  // Compresses bright values instead of hard-clipping them to white (e.g. high-emissiveIntensity engine glow).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.0019);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

  // ---------- Lights ----------
  scene.add(new THREE.AmbientLight(0x8891b0, 1.1));
  const keyLight = new THREE.DirectionalLight(0xcfdaff, 1.1);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);
  // Blue-gray fill light on the ship, from the reference palette
  const shipFillLight = new THREE.DirectionalLight(0xf5843e, 1.8);
  shipFillLight.position.set(-3, 1, -2);
  scene.add(shipFillLight);

  // ---------- Ship: real 3D model (converted from a user-supplied USDZ scan/asset), with a small procedural fallback ----------
  const ship = new THREE.Group();
  const flames = [];
  const SHIP_TARGET_SIZE = 2.8; // largest dimension, in scene units, after auto-scaling the loaded model
  const SHIP_BASE_Y = 1.2; // vertical resting height for both the ship and the star tunnel (they must match)
  let modelReady = false; // gates the intro fly-in so it doesn't finish before the model is actually visible

  // Engine point lights are created once the real model loads and its engine/turbine meshes
  // are found (see loader below) — no guessed offsets, positioned from actual mesh geometry.
  const thrusterLights = [];

  // ---------- Engine plasma glow (soft radial sprite, additive-blended, layered over the real emissive geometry) ----------
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

  // Adds a small additive glow sprite plus a point light at a mesh's own world position
  // (converted into pivot-local space by the caller), sized relative to that mesh's own bounds.
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

  const shipBaseTint = new THREE.Color(0xdedaca); // beige/cream, from the reference palette

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
      // If the model faces the wrong way once live, adjust this yaw in 90-degree steps.
      pivot.rotation.y = Math.PI;
      ship.add(pivot);

      // Engine/turbine/exhaust parts, identified by their real material names from the model
      // (Engine_A, Engine_B, Booster_Turbine, Turbine_Rear_Emission, ...) instead of guessed
      // offsets. Their own baked emissive textures (the glow-ring detail) get lit up with a
      // bright blue tint; a small additive sprite + point light is added at each exhaust mesh's
      // own world position for extra "plasma" bloom.
      const ENGINE_NAME_RE = /engine|turbine|booster/i;
      const enginePlasmaBudget = { count: 0 };
      model.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        obj.castShadow = false;
        obj.receiveShadow = false;

        const isEngine = ENGINE_NAME_RE.test(obj.material.name || '') || ENGINE_NAME_RE.test(obj.name || '');
        // Only tint blue where there's an actual emissive texture to mask it — otherwise the
        // whole (untextured) mesh surface would flood solid blue instead of just its glow spots.
        if (isEngine && obj.material.emissiveMap) {
          obj.material.emissive = new THREE.Color(0x4fc8ff);
          obj.material.emissiveIntensity = 1.5; // higher clips to white (blue channel > 1.0 with no tone mapping)
        } else if (!isEngine) {
          obj.material.color = obj.material.color ? obj.material.color.multiply(shipBaseTint) : shipBaseTint.clone();
          obj.material.emissiveIntensity = Math.max(obj.material.emissiveIntensity || 0, 0.6);
        }

        // Only the actual rear-exhaust glow parts get a bloom sprite + light (not the whole
        // engine housing), and cap it so we don't spawn a light per tiny sub-mesh.
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


  // ---------- Warp starfield: 5 parallax layers (stopped -> slow -> medium -> fast -> very fast) ----------
  const FAR_Z = -900;
  const NEAR_Z = 12;
  const STREAK_LEN_SCALE = 1.5; // tuned so continuous angular-velocity-based length ~matches the old fixed-band look
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0x7c9bff);
  const colorC = new THREE.Color(0x5eead4);

  function pickColor() {
    const r = Math.random();
    return r < 0.75 ? colorA.clone().lerp(colorB, Math.random()) : colorA.clone().lerp(colorC, Math.random() * 0.7);
  }

  // Layer 0 — distant backdrop; drifts slowly (rotation, in the animate loop below) rather than
  // sitting fully static, so every star layer has some motion.
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

  // Layers 1-4 — streaking tunnel stars, each with its own speed/length/radius band
  function makeStreakLayer(opts) {
    const count = Math.max(1, Math.round(opts.count * STAR_SCALE));
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 3);
    const stars = [];

    function resetStar(i) {
      const angle = Math.random() * Math.PI * 2;
      // sqrt-biased radius: denser near the tunnel's core, thinning toward the rim
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
      update(dt, globalSpeed) {
        const posAttr = geom.attributes.position;
        for (let i = 0; i < count; i++) {
          const s = stars[i];
          s.z += globalSpeed * s.speed * dt;
          if (s.z > NEAR_Z) resetStar(i);
          // Streak length follows apparent (angular) velocity — real speed divided by distance
          // from the camera — rather than a fixed random length per star. This matches the
          // motion-streak literature (Geisler 1999): perceived streak length tracks how fast a
          // point sweeps across the visual field, which grows as it gets closer, not a constant.
          const dist = Math.max(NEAR_Z - s.z, 0.6);
          const len = clamp((STREAK_LEN_SCALE * globalSpeed * s.speed) / dist, opts.lenMin, opts.lenMax);
          const i6 = i * 6;
          posAttr.array[i6] = s.x;
          posAttr.array[i6 + 1] = s.y + SHIP_BASE_Y;
          posAttr.array[i6 + 2] = s.z;
          posAttr.array[i6 + 3] = s.x;
          posAttr.array[i6 + 4] = s.y + SHIP_BASE_Y;
          posAttr.array[i6 + 5] = s.z - len;
        }
        posAttr.needsUpdate = true;
      }
    };
  }

  const streakLayers = [
    // Layer 1 — slow drift, far out
    makeStreakLayer({ count: 500, radiusMin: 20, radiusMax: 42, speedMin: 0.15, speedMax: 0.3, lenMin: 0.5, lenMax: 1.2, opacity: 0.55 }),
    // Layer 2 — medium
    makeStreakLayer({ count: 650, radiusMin: 13, radiusMax: 29, speedMin: 0.45, speedMax: 0.7, lenMin: 1.2, lenMax: 2.5, opacity: 0.75 }),
    // Layer 3 — fast
    makeStreakLayer({ count: 600, radiusMin: 6, radiusMax: 19, speedMin: 0.9, speedMax: 1.3, lenMin: 2.5, lenMax: 5, opacity: 0.9 }),
    // Layer 4 — very fast, closest to the flight path, brightest streaks
    makeStreakLayer({ count: 400, radiusMin: 2, radiusMax: 11, speedMin: 1.7, speedMax: 2.5, lenMin: 4.5, lenMax: 9, opacity: 1, additive: true })
  ];

  // ---------- Input: keyboard + mouse hover + touch drag ----------
  const input = { x: 0, y: 0 };
  const keyState = {};
  let baseSpeed = 90;

  window.addEventListener('keydown', (e) => { keyState[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keyState[e.key.toLowerCase()] = false; });

  // Mouse/pen: steer just by hovering, no click needed
  const HOVER_SENSITIVITY = 0.16; // lower = more mouse travel needed to reach full steering input
  function hoverMove(clientX, clientY) {
    const nx = ((clientX / window.innerWidth) * 2 - 1) * HOVER_SENSITIVITY;
    const ny = ((clientY / window.innerHeight) * 2 - 1) * HOVER_SENSITIVITY;
    input.x = clamp(nx, -1, 1);
    input.y = clamp(-ny, -1, 1);
  }

  // Touch: no hover concept, so steer via drag instead
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

  // ---------- Visibility (pause when hero off-screen / tab hidden) ----------
  let active = true;
  if ('IntersectionObserver' in window && hero) {
    const io = new IntersectionObserver((entries) => {
      active = entries[0].isIntersecting;
    }, { threshold: 0.01 });
    io.observe(hero);
  }

  // ---------- Animation loop ----------
  const shipTargetPos = new THREE.Vector3();
  const camOffset = new THREE.Vector3(0, 2.4, 6.5);
  const camLookOffset = new THREE.Vector3(0, 0.4, -6);
  const clock = new THREE.Clock();
  const tmpCamPos = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();

  // Intro sequence: tiny dot far down the tunnel -> eases into resting position (2x, the new
  // baseline size) -> overshoots to 8x (4x of the new baseline) off-screen, with no stop at the
  // top of the overshoot -> returns to resting position. After that, normal per-frame steering
  // takes over, at the same 2x baseline. The camera (below) tracks the steady steering target
  // throughout, not the ship's own position, so it doesn't chase the ship through this sequence.
  const REST_SCALE = 1.5;
  const REST_POS = new THREE.Vector3(0, SHIP_BASE_Y, 0);
  const introStages = [
    { pos: new THREE.Vector3(0, SHIP_BASE_Y, -190), scale: 0.05 },        // start: far away, tiny dot
    { pos: REST_POS.clone(), scale: REST_SCALE },                  // arrives at resting position
    { pos: new THREE.Vector3(0, -13, 7), scale: REST_SCALE * 4 },  // overshoots: huge, off-screen bottom
    { pos: REST_POS.clone(), scale: REST_SCALE }                   // settles back to resting position
  ];
  const introStageDurations = [2.0, 1.0, 1.5];

  function linear(t) { return t; }
  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  // Stage 0 ends at full speed (no ease-out) and stage 1 starts at full speed (no ease-in),
  // so there's no zero-velocity moment at the stage0/stage1 boundary — only stage 2 eases out
  // to a full stop at the very end, when the ship settles into its permanent resting position.
  const introStageEasings = [easeInCubic, linear, easeOutCubic];

  let introStageIndex = 0;
  let introStageT = 0;
  let introDone = false;

  ship.position.copy(introStages[0].pos);
  ship.scale.setScalar(introStages[0].scale);

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (!active || document.hidden) return;

    keyboardInput(dt);

    // Ship target lateral/vertical position from input (kept in sync even during the intro, so the camera doesn't jump)
    shipTargetPos.set(input.x * 5.2, SHIP_BASE_Y + input.y * 2.4, 0);

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
    } else if (modelReady) {
      ship.position.lerp(shipTargetPos, Math.min(dt * 2, 1));
    }

    // Banking / pitch feel
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -input.x * 0.5, dt * 4);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, input.y * 0.25, dt * 4);

    // Engine plasma flicker
    const flicker = 1 + Math.sin(performance.now() * 0.02) * 0.12 + Math.random() * 0.08;
    for (const flame of flames) {
      const base = flame.userData.baseScale;
      flame.scale.set(base.x * flicker, base.y * flicker, 1);
    }
    for (const light of thrusterLights) {
      light.intensity = 1.4 + Math.sin(performance.now() * 0.03) * 0.25 + Math.random() * 0.15;
    }

    // Chase camera (NFS-style: behind + slightly above) — tracks the steering target directly,
    // so it stays steady during the intro fly-in instead of racing the ship's temporary far position.
    tmpCamPos.copy(shipTargetPos).add(camOffset);
    camera.position.lerp(tmpCamPos, Math.min(dt * 5, 1));
    tmpLook.copy(shipTargetPos).add(camLookOffset);
    camera.lookAt(tmpLook);
    camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, -input.x * 0.08, dt * 4);

    // Update warp streaks across all parallax layers (infinite loop: stars stream past and recycle)
    const speed = baseSpeed * (1 + Math.abs(input.x) * 0.15);
    for (const layer of streakLayers) layer.update(dt, speed);

    // Slow drift for the distant backdrop layer, so it isn't fully static either
    bgStars.rotation.y += dt * 0.006;
    bgStars.rotation.x += dt * 0.002;

    renderer.render(scene, camera);
  }

  animate();
})();
