const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

function setupReveals() {
  const { gsap } = window;
  if (!gsap || reduceMotion) return;
  gsap.registerPlugin(window.ScrollTrigger);
  gsap.utils.toArray(".reveal").forEach((el) => {
    gsap.from(el, { y: 46, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%" } });
  });
}

function setupRail() {
  const links = [...document.querySelectorAll("[data-rail]")];
  const chapters = [...document.querySelectorAll("[data-chapter]")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = entry.target.dataset.chapter;
      links.forEach((link) => link.classList.toggle("is-active", link.dataset.rail === index));
    });
  }, { rootMargin: "-45% 0px -45% 0px" });
  chapters.forEach((chapter) => observer.observe(chapter));
}

function dropProfile(THREE) {
  const points = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI * 0.72);
    points.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
  }
  const last = points[points.length - 1];
  const tip = new THREE.Vector2(0.0001, 2.15);
  const control = new THREE.Vector2(last.x * 0.55, 1.45);
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const x = (1 - t) * (1 - t) * last.x + 2 * (1 - t) * t * control.x + t * t * tip.x;
    const y = (1 - t) * (1 - t) * last.y + 2 * (1 - t) * t * control.y + t * t * tip.y;
    points.push(new THREE.Vector2(Math.max(x, 0.0001), y));
  }
  points[0].x = 0.0001;
  return points;
}

function glowTexture(THREE, color) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color.replace(/[\d.]+\)$/, "0.35)"));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function heartbeat(t) {
  const p = t % 1.15;
  const bump = (center, width, height) => height * Math.exp(-Math.pow((p - center) / width, 2));
  return bump(0.08, 0.05, 1) + bump(0.3, 0.06, 0.6);
}

async function startScene() {
  const canvas = document.querySelector("#scene");
  const THREE = await import("./vendor/three.module.min.js");
  const isSmall = () => window.innerWidth < 900;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmall() ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x060607, 0.045);
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0.4, 11);

  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const key = new THREE.DirectionalLight(0xffe2dc, 2.2);
  key.position.set(4, 6, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0xff2a3a, 60, 30, 2);
  rim.position.set(-5, 2, -3);
  scene.add(rim);
  const under = new THREE.PointLight(0x6a0b14, 30, 20, 2);
  under.position.set(0, -4, 3);
  scene.add(under);

  const dropGroup = new THREE.Group();
  scene.add(dropGroup);
  const dropGeo = new THREE.LatheGeometry(dropProfile(THREE), 96);
  dropGeo.translate(0, -0.55, 0);
  const dropMat = new THREE.MeshPhysicalMaterial({ color: 0xb3121b, roughness: 0.16, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.6, sheenColor: new THREE.Color(0xff6b70), emissive: 0x3a0306, emissiveIntensity: 0.6 });
  const drop = new THREE.Mesh(dropGeo, dropMat);
  dropGroup.add(drop);

  const ecgPts = [[-0.78, 0], [-0.4, 0], [-0.26, 0.34], [-0.06, -0.52], [0.12, 0.46], [0.28, 0], [0.78, 0]].map(([x, y]) => new THREE.Vector3(x, y * 0.7 - 0.05, 1.02 - Math.abs(x) * 0.28));
  const ecgCurve = new THREE.CatmullRomCurve3(ecgPts, false, "catmullrom", 0.05);
  const ecg = new THREE.Mesh(new THREE.TubeGeometry(ecgCurve, 120, 0.045, 12, false), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  dropGroup.add(ecg);
  const dropHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, "rgba(229,56,63,0.9)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dropHalo.scale.set(7, 7, 1);
  dropHalo.position.z = -1.2;
  dropGroup.add(dropHalo);

  const bridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.2, -1.6, 0),
    new THREE.Vector3(-2.6, 0.9, -0.6),
    new THREE.Vector3(0, 1.8, -1),
    new THREE.Vector3(2.6, 0.9, -0.6),
    new THREE.Vector3(5.2, -1.6, 0)
  ]);
  const bridgeGeo = new THREE.TubeGeometry(bridgeCurve, 240, 0.035, 10, false);
  const bridgeGroup = new THREE.Group();
  scene.add(bridgeGroup);
  const bridgeBase = new THREE.Mesh(bridgeGeo, new THREE.MeshBasicMaterial({ color: 0x5a1a1e, transparent: true, opacity: 0 }));
  const bridgeLit = new THREE.Mesh(bridgeGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff4d55, transparent: true, opacity: 0 }));
  const litIndexCount = bridgeLit.geometry.index.count;
  bridgeLit.geometry.setDrawRange(0, 0);
  bridgeGroup.add(bridgeBase, bridgeLit);

  const nodeMat = () => new THREE.MeshStandardMaterial({ color: 0x1b1c21, emissive: 0xe5383f, emissiveIntensity: 0, roughness: 0.4 });
  const nodes = [bridgeCurve.getPointAt(0), bridgeCurve.getPointAt(1)].map((p) => {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 32), nodeMat());
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, "rgba(255,90,96,1)"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(2.6, 2.6, 1);
    group.add(core, halo);
    group.position.copy(p);
    group.scale.setScalar(0.001);
    bridgeGroup.add(group);
    return { group, core, halo };
  });

  const cellCount = isSmall() ? 55 : 95;
  const cellGeo = new THREE.TorusGeometry(0.3, 0.17, 18, 44);
  cellGeo.scale(1, 1, 0.72);
  const cellMat = new THREE.MeshStandardMaterial({ color: 0x9e0f18, roughness: 0.45, metalness: 0.05, emissive: 0x2a0205, emissiveIntensity: 0.8 });
  const cells = new THREE.InstancedMesh(cellGeo, cellMat, cellCount);
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cells);
  const seeds = Array.from({ length: cellCount }, (_, i) => {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = 1.7 + Math.random() * 1.9;
    const s = Math.sqrt(1 - u * u);
    return {
      cloud: new THREE.Vector3(r * s * Math.cos(theta), r * u * 0.75, r * s * Math.sin(theta) * 0.8),
      ringAngle: (i / cellCount) * Math.PI * 2,
      ringRadius: 2.1 + (i % 3) * 0.4,
      bridgeU: Math.random(),
      jitter: new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5),
      spin: new THREE.Vector3(Math.random() * 2, Math.random() * 2, Math.random() * 2),
      size: 0.38 + Math.random() * 0.38,
      phase: Math.random() * Math.PI * 2
    };
  });

  const dustCount = isSmall() ? 250 : 600;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 30;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 18;
    dustPos[i * 3 + 2] = -Math.random() * 14;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xff7a80, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(dust);

  const nodeAt = (u, bx, by, bs) => {
    const p = bridgeCurve.getPointAt(u);
    return { x: p.x * bs + bx, y: p.y * bs + by };
  };
  const poses = () => {
    const small = isSmall();
    const b2 = small ? { bx: 0, by: 1.5, bs: 0.34 } : { bx: 3.2, by: 0.2, bs: 0.62 };
    const b3 = small ? { bx: 0, by: 1.5, bs: 0.34 } : { bx: -3.2, by: 0.2, bs: 0.62 };
    const n2 = nodeAt(0, b2.bx, b2.by, b2.bs);
    const n3 = nodeAt(0, b3.bx, b3.by, b3.bs);
    return [
      { dx: small ? 0 : 3.1, dy: small ? 1.9 : 0.1, ds: small ? 0.7 : 1.15, ring: 0, flow: 0, bridge: 0, nodes: 0, camZ: 11, camY: 0.4, spin: 0, ...b2 },
      { dx: small ? 0 : -3.2, dy: small ? 2.0 : 0.2, ds: small ? 0.5 : 0.75, ring: 1, flow: 0, bridge: 0, nodes: 0, camZ: 11.5, camY: 0.5, spin: 1.2, ...b2 },
      { dx: n2.x, dy: n2.y, ds: small ? 0.24 : 0.32, ring: 0.15, flow: 0.6, bridge: 0.4, nodes: 0.6, camZ: small ? 13.5 : 11.5, camY: 0.5, spin: 2.2, ...b2 },
      { dx: n3.x, dy: n3.y, ds: small ? 0.22 : 0.3, ring: 0, flow: 1, bridge: 1, nodes: 1, camZ: small ? 13.5 : 11.5, camY: 0.5, spin: 3.2, ...b3 },
      { dx: small ? 0 : 3.0, dy: small ? 2.0 : 0, ds: small ? 0.75 : 1.2, ring: 0, flow: 0, bridge: 0, nodes: 0, camZ: 10.5, camY: 0.3, spin: 4.6, ...b3 }
    ];
  };

  const state = { ...poses()[0] };
  const { gsap } = window;
  let timeline = null;
  const buildTimeline = () => {
    if (!gsap) return;
    timeline?.scrollTrigger?.kill();
    timeline?.kill();
    const list = poses();
    Object.assign(state, list[0]);
    const chapters = [...document.querySelectorAll("[data-chapter]")];
    timeline = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: chapters[0], start: "top top", endTrigger: chapters[chapters.length - 1], end: "bottom bottom", scrub: 1.2 } });
    list.slice(1).forEach((pose) => {
      timeline.to(state, { ...pose, duration: 1, ease: "power1.inOut" });
    });
  };
  buildTimeline();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (event) => {
    pointer.tx = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (event.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      buildTimeline();
      window.ScrollTrigger?.refresh();
    }, 200);
  });

  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      clock.getDelta();
      requestAnimationFrame(frame);
    }
  });

  function frame() {
    if (!running) return;
    const t = clock.getElapsedTime();
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    const beat = heartbeat(t);
    dropGroup.position.set(state.dx, state.dy + Math.sin(t * 0.8) * 0.12, 0);
    dropGroup.scale.setScalar(state.ds * (1 + beat * 0.05));
    dropGroup.rotation.y = Math.sin(t * 0.4) * 0.35 + state.spin * 0.6 + pointer.x * 0.25;
    dropGroup.rotation.z = Math.sin(t * 0.3) * 0.05;
    dropMat.emissiveIntensity = 0.5 + beat * 0.9;
    dropHalo.material.opacity = 0.35 + beat * 0.35;

    bridgeGroup.position.set(state.bx, state.by, 0);
    bridgeGroup.scale.setScalar(state.bs);
    bridgeBase.material.opacity = Math.min(1, state.bridge * 2) * 0.6;
    bridgeLit.material.opacity = state.bridge > 0.01 ? 0.95 : 0;
    const drawCount = Math.floor(litIndexCount * Math.min(1, state.bridge) / 3) * 3;
    bridgeLit.geometry.setDrawRange(0, drawCount);

    nodes.forEach((node, i) => {
      const k = Math.min(1, state.nodes * (i === 0 ? 1.4 : 1));
      node.group.scale.setScalar(0.001 + k * (1 + beat * 0.08));
      const lit = i === 0 ? k : Math.max(0, (state.bridge - 0.85) / 0.15);
      node.core.material.emissiveIntensity = 0.3 + lit * 2.2;
      node.halo.material.opacity = lit * (0.6 + beat * 0.4);
    });

    for (let i = 0; i < cellCount; i++) {
      const seed = seeds[i];
      tmpA.copy(seed.cloud).applyAxisAngle(yAxis, t * 0.08 + seed.phase * 0.02).multiplyScalar(Math.max(0.6, state.ds));
      tmpA.y += Math.sin(t * 0.7 + seed.phase) * 0.25;
      tmpA.add(dropGroup.position);
      const angle = seed.ringAngle + t * 0.35;
      tmpB.set(Math.cos(angle) * seed.ringRadius * Math.max(0.7, state.ds + 0.3), Math.sin(angle) * seed.ringRadius * 0.62 * Math.max(0.7, state.ds + 0.3), Math.sin(angle * 2) * 0.4).add(dropGroup.position);
      tmpA.lerp(tmpB, state.ring);
      const u = (seed.bridgeU + t * 0.06) % 1;
      const visibleU = state.flow < 1 ? u * Math.max(0.05, state.bridge) : u;
      bridgeCurve.getPointAt(Math.min(0.999, visibleU), tmpC).multiplyScalar(state.bs).add(seed.jitter);
      tmpC.x += state.bx;
      tmpC.y += state.by;
      tmpA.lerp(tmpC, state.flow);
      dummy.position.copy(tmpA);
      dummy.rotation.set(seed.spin.x * t * 0.4, seed.spin.y * t * 0.4, seed.spin.z * t * 0.2);
      dummy.scale.setScalar(seed.size * (isSmall() ? 0.8 : 1));
      dummy.updateMatrix();
      cells.setMatrixAt(i, dummy.matrix);
    }
    cells.instanceMatrix.needsUpdate = true;

    dust.rotation.y = t * 0.01;
    dust.position.y = Math.sin(t * 0.2) * 0.2;

    camera.position.set(pointer.x * 0.6, state.camY - pointer.y * 0.35, state.camZ);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.body.classList.add("scene-ready");
}

async function init() {
  setupRail();
  const canUse3d = !reduceMotion && webglAvailable() && window.gsap && window.ScrollTrigger;
  if (window.gsap && window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);
  setupReveals();
  if (!canUse3d) {
    document.body.classList.add("no-3d");
    return;
  }
  try {
    await startScene();
  } catch (error) {
    console.error(error);
    document.body.classList.add("no-3d");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
