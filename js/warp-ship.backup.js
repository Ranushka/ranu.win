(function () {
  const canvas = document.getElementById('warp-canvas');
  const hero = document.getElementById('hero');
  if (!canvas || typeof THREE === 'undefined') return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.012);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

  // ---------- Lights ----------
  scene.add(new THREE.AmbientLight(0x556080, 0.6));
  const keyLight = new THREE.DirectionalLight(0xaabfff, 0.5);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  // ---------- Ship (procedural low-poly starfighter — no external assets needed) ----------
  const ship = new THREE.Group();
  const flames = [];

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xd7dbe6, metalness: 0.85, roughness: 0.22 });
  const hullDarkMat = new THREE.MeshStandardMaterial({ color: 0x9aa1b5, metalness: 0.8, roughness: 0.3 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x232a42, metalness: 0.6, roughness: 0.45 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x5eead4, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.4 });
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x7c9bff, emissive: 0x0e1740, emissiveIntensity: 1.2,
    metalness: 0.1, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.65
  });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x9be9ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

  // Fuselage: nose -> mid -> tail, built from a tapered lathe profile for a sleek fighter silhouette
  const profile = [
    new THREE.Vector2(0.0, -1.55),
    new THREE.Vector2(0.09, -1.35),
    new THREE.Vector2(0.22, -0.9),
    new THREE.Vector2(0.32, -0.2),
    new THREE.Vector2(0.34, 0.5),
    new THREE.Vector2(0.24, 1.05),
    new THREE.Vector2(0.16, 1.35),
    new THREE.Vector2(0.0, 1.5)
  ];
  const fuselage = new THREE.Mesh(new THREE.LatheGeometry(profile, 10), hullMat);
  fuselage.rotation.x = Math.PI / 2;
  ship.add(fuselage);

  // Dorsal spine ridge
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.4), hullDarkMat);
  spine.position.set(0, 0.3, 0.1);
  ship.add(spine);

  // Nose accent stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 1.0), accentMat);
  stripe.position.set(0, 0.2, -0.9);
  ship.add(stripe);

  // Canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.7), canopyMat);
  canopy.scale.set(1, 0.85, 1.7);
  canopy.rotation.x = Math.PI;
  canopy.position.set(0, 0.28, -0.55);
  ship.add(canopy);

  // Delta wings via extruded 2D shape for a sharp swept silhouette
  function makeWingShape() {
    const s = new THREE.Shape();
    s.moveTo(0, -0.55);
    s.lineTo(2.0, 0.15);
    s.lineTo(1.85, 0.42);
    s.lineTo(0.55, 0.5);
    s.lineTo(0, 0.55);
    s.closePath();
    return s;
  }
  function makeWing(mirror) {
    const geo = new THREE.ExtrudeGeometry(makeWingShape(), { depth: 0.05, bevelEnabled: false });
    const wing = new THREE.Mesh(geo, trimMat);
    wing.scale.x = mirror;
    wing.rotation.x = Math.PI / 2;
    wing.position.set(mirror * 0.3, -0.02, 0.75);
    return wing;
  }
  ship.add(makeWing(1));
  ship.add(makeWing(-1));

  // Wingtip fins (angled up)
  function makeFin(mirror) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.55), hullDarkMat);
    fin.position.set(mirror * 2.15, 0.2, 1.05);
    fin.rotation.z = -mirror * 0.35;
    return fin;
  }
  ship.add(makeFin(1));
  ship.add(makeFin(-1));

  // Engine nacelles with glow ring + animated thruster flame
  function makeEngine(x) {
    const g = new THREE.Group();
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 1.0, 10), hullDarkMat);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(x, -0.05, 1.15);
    g.add(nacelle);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 8, 16), accentMat);
    ring.position.set(x, -0.05, 1.66);
    g.add(ring);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.9, 10, 1, true), flameMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, -0.05, 2.15);
    g.add(flame);
    flames.push(flame);

    return g;
  }
  ship.add(makeEngine(0.48));
  ship.add(makeEngine(-0.48));

  const thrusterLight = new THREE.PointLight(0x5eead4, 2.6, 9);
  thrusterLight.position.set(0, -0.05, 2);
  ship.add(thrusterLight);

  ship.scale.setScalar(0.75);
  scene.add(ship);

  // ---------- Warp starfield: 5 parallax layers (stopped -> slow -> medium -> fast -> very fast) ----------
  const FAR_Z = -900;
  const NEAR_Z = 12;
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0x7c9bff);
  const colorC = new THREE.Color(0x5eead4);

  function pickColor() {
    const r = Math.random();
    return r < 0.75 ? colorA.clone().lerp(colorB, Math.random()) : colorA.clone().lerp(colorC, Math.random() * 0.7);
  }

  // Layer 0 — "stopped": distant static background, effectively motionless
  const BG_STAR_COUNT = 1600;
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
    const count = opts.count;
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
        len: opts.lenMin + Math.random() * (opts.lenMax - opts.lenMin),
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
          const i6 = i * 6;
          posAttr.array[i6] = s.x;
          posAttr.array[i6 + 1] = s.y + 1.2;
          posAttr.array[i6 + 2] = s.z;
          posAttr.array[i6 + 3] = s.x;
          posAttr.array[i6 + 4] = s.y + 1.2;
          posAttr.array[i6 + 5] = s.z - s.len * (1 + globalSpeed * 0.01);
        }
        posAttr.needsUpdate = true;
      }
    };
  }

  const streakLayers = [
    // Layer 1 — slow drift, far out
    makeStreakLayer({ count: 500, radiusMin: 12, radiusMax: 26, speedMin: 0.15, speedMax: 0.3, lenMin: 1, lenMax: 2.5, opacity: 0.55 }),
    // Layer 2 — medium
    makeStreakLayer({ count: 650, radiusMin: 8, radiusMax: 18, speedMin: 0.45, speedMax: 0.7, lenMin: 2.5, lenMax: 5, opacity: 0.75 }),
    // Layer 3 — fast
    makeStreakLayer({ count: 600, radiusMin: 4, radiusMax: 12, speedMin: 0.9, speedMax: 1.3, lenMin: 5, lenMax: 10, opacity: 0.9 }),
    // Layer 4 — very fast, closest to the flight path, brightest streaks
    makeStreakLayer({ count: 400, radiusMin: 1.2, radiusMax: 7, speedMin: 1.7, speedMax: 2.5, lenMin: 9, lenMax: 18, opacity: 1, additive: true })
  ];

  // ---------- Input: keyboard + mouse hover + touch drag ----------
  const input = { x: 0, y: 0 };
  const keyState = {};
  let baseSpeed = 90;

  window.addEventListener('keydown', (e) => { keyState[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keyState[e.key.toLowerCase()] = false; });

  // Mouse/pen: steer just by hovering, no click needed
  function hoverMove(clientX, clientY) {
    const nx = (clientX / window.innerWidth) * 2 - 1;
    const ny = (clientY / window.innerHeight) * 2 - 1;
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

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (!active || document.hidden) return;

    keyboardInput(dt);

    // Ship target lateral/vertical position from input
    shipTargetPos.set(input.x * 5.2, 1.2 + input.y * 2.4, 0);
    ship.position.lerp(shipTargetPos, Math.min(dt * 4, 1));

    // Banking / pitch feel
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -input.x * 0.5, dt * 4);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, input.y * 0.25, dt * 4);

    // Engine flame flicker
    const flicker = 1 + Math.sin(performance.now() * 0.02) * 0.12 + Math.random() * 0.06;
    for (const flame of flames) flame.scale.set(flicker, flicker, 1 + flicker * 0.3);

    // Chase camera (NFS-style: behind + slightly above)
    tmpCamPos.copy(ship.position).add(camOffset);
    camera.position.lerp(tmpCamPos, Math.min(dt * 5, 1));
    tmpLook.copy(ship.position).add(camLookOffset);
    camera.lookAt(tmpLook);
    camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, -input.x * 0.08, dt * 4);

    // Update warp streaks across all parallax layers (infinite loop: stars stream past and recycle)
    const speed = baseSpeed * (1 + Math.abs(input.x) * 0.15);
    for (const layer of streakLayers) layer.update(dt, speed);

    renderer.render(scene, camera);
  }

  animate();
})();
