// 3D board renderer. Procedural Staunton piece models, physical materials,
// procedural wood textures, interactive piece elevation, and camera controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const FILES = 'abcdefgh';
const HEIGHT = { p: 0.78, n: 1.0, b: 1.05, r: 0.9, q: 1.15, k: 1.36 };

const sqPos = (sq) => new THREE.Vector3(FILES.indexOf(sq[0]) - 3.5, 0, 3.5 - (+sq[1] - 1));

// ---------------------------------------------------------------- piece models

const BASE = [[0, 0], [0.38, 0], [0.395, 0.03], [0.385, 0.07], [0.33, 0.1], [0.345, 0.13], [0.3, 0.165]];

function lathe(points) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 48);
}

function arc(cx, cy, r, a0, a1, steps = 12) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([Math.max(0, cx + r * Math.cos(a)), cy + r * Math.sin(a)]);
  }
  return out;
}

function buildGeometries() {
  const g = {};
  g.p = [lathe([...BASE, [0.21, 0.22], [0.14, 0.36], [0.12, 0.42], [0.21, 0.45], [0.21, 0.48], [0.1, 0.5], ...arc(0, 0.62, 0.155, -Math.PI / 2.6, Math.PI / 2)])];

  const rookTop = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.BoxGeometry(0.13, 0.12, 0.09);
    const a = (i / 6) * Math.PI * 2;
    m.translate(0, 0, 0.245);
    m.rotateY(a);
    m.translate(0, 0.9, 0);
    rookTop.push(m);
  }
  g.r = [lathe([...BASE, [0.27, 0.21], [0.235, 0.3], [0.22, 0.62], [0.28, 0.66], [0.3, 0.7], [0.3, 0.84], [0.2, 0.84], [0.2, 0.79], [0, 0.79]]), ...rookTop];

  g.b = [
    lathe([...BASE, [0.23, 0.22], [0.14, 0.4], [0.11, 0.6], [0.21, 0.63], [0.21, 0.66], [0.12, 0.69], [0.165, 0.75], [0.185, 0.81], [0.17, 0.88], [0.12, 0.95], [0.05, 1.0], [0, 1.01]]),
    new THREE.SphereGeometry(0.055, 20, 14).translate(0, 1.05, 0),
  ];

  const crownBalls = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    crownBalls.push(new THREE.SphereGeometry(0.045, 14, 10).translate(Math.cos(a) * 0.235, 1.06, Math.sin(a) * 0.235));
  }
  g.q = [
    lathe([...BASE, [0.25, 0.22], [0.15, 0.42], [0.12, 0.72], [0.23, 0.76], [0.23, 0.79], [0.13, 0.82], [0.16, 0.9], [0.25, 1.03], [0.2, 1.04], [0.1, 1.0], [0, 1.0]]),
    ...crownBalls,
    new THREE.SphereGeometry(0.075, 20, 14).translate(0, 1.1, 0),
  ];

  g.k = [
    lathe([...BASE, [0.26, 0.22], [0.16, 0.44], [0.13, 0.82], [0.24, 0.86], [0.24, 0.89], [0.14, 0.92], [0.17, 1.0], [0.26, 1.12], [0.2, 1.15], [0, 1.16]]),
    new THREE.BoxGeometry(0.07, 0.26, 0.07).translate(0, 1.28, 0),
    new THREE.BoxGeometry(0.2, 0.07, 0.07).translate(0, 1.3, 0),
  ];

  // Knight: lathe base + extruded horse-head silhouette facing forward (+x rotated to opponent)
  const s = new THREE.Shape();
  const pts = [
    [-0.22, 0.18], [0.2, 0.18], [0.15, 0.36], [0.1, 0.47], [0.29, 0.56],
    [0.37, 0.65], [0.36, 0.73], [0.29, 0.76], [0.13, 0.84], [0.06, 0.98],
    [0.0, 0.9], [-0.07, 0.95], [-0.12, 0.85], [-0.24, 0.7], [-0.27, 0.48]
  ];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 5 });
  head.translate(0, 0, -0.12);
  g.n = [lathe([...BASE, [0.27, 0.21], [0.25, 0.25], [0, 0.25]]), head];
  return g;
}

function badgeTexture(sym, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#11111b';
  x.beginPath();
  x.arc(64, 64, 62, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = color;
  x.beginPath();
  x.arc(64, 64, 54, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#11111b';
  x.font = `800 ${sym.length > 1 ? 52 : 66}px Outfit, system-ui, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(sym, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(205, 214, 244, 0.78)';
  x.font = '700 62px "JetBrains Mono", monospace, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeWoodTexture(isDark) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle wood fiber rings
  for (let i = 0; i < 50; i++) {
    const y = (i / 50) * 512;
    ctx.strokeStyle = `rgba(0, 0, 0, ${isDark ? 0.045 : 0.025})`;
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + Math.sin(i * 0.4) * 9, 340, y - Math.cos(i * 0.3) * 9, 512, y);
    ctx.stroke();
  }

  // Micro-speckle grain
  const imgData = ctx.getImageData(0, 0, 512, 512);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * (isDark ? 14 : 10);
    data[i] = Math.min(255, Math.max(0, data[i] + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
  }
  ctx.putImageData(imgData, 0, 0);

  // Soft vignette edge for inlaid bevel look
  const rad = ctx.createRadialGradient(256, 256, 175, 256, 256, 360);
  rad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rad.addColorStop(1, isDark ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.08)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- board

export function createBoard3D(container, { onSquare }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'board3d';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 11.2, 9.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 6.5;
  controls.maxDistance = 20;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.35;
  controls.update();

  scene.add(new THREE.HemisphereLight('#cdd6f4', '#1e1e2e', 1.15));
  const sun = new THREE.DirectionalLight('#fff8ee', 2.3);
  sun.position.set(5.5, 12, 6.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const rim = new THREE.DirectionalLight('#cba6f7', 1.35);
  rim.position.set(-6, 6, -8);
  scene.add(rim);

  const fill = new THREE.DirectionalLight('#89b4fa', 0.55);
  fill.position.set(-7, 8, 5);
  scene.add(fill);

  // Board squares with procedural satin wood textures and chamfered gaps
  const lightTex = makeWoodTexture(false);
  const darkTex = makeWoodTexture(true);
  const lightMat = new THREE.MeshPhysicalMaterial({ map: lightTex, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const darkMat = new THREE.MeshPhysicalMaterial({ map: darkTex, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 });

  const squareGeo = new THREE.BoxGeometry(0.985, 0.16, 0.985);
  const squareMeshes = [];
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const sq = FILES[f] + (r + 1);
      const m = new THREE.Mesh(squareGeo, (f + r) % 2 === 0 ? darkMat : lightMat);
      m.position.copy(sqPos(sq)).setY(-0.08);
      m.receiveShadow = true;
      m.userData.sq = sq;
      scene.add(m);
      squareMeshes.push(m);
    }

  // Board chassis and accent trim
  const frameMat = new THREE.MeshPhysicalMaterial({ color: '#161622', roughness: 0.3, metalness: 0.12, clearcoat: 0.65, clearcoatRoughness: 0.25 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.38, 0.36, 9.38), frameMat);
  frame.position.y = -0.2;
  frame.receiveShadow = true;
  frame.castShadow = true;
  scene.add(frame);

  const edgeMat = new THREE.MeshPhysicalMaterial({ color: '#cba6f7', metalness: 0.7, roughness: 0.2, clearcoat: 0.9, transparent: true, opacity: 0.85 });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(9.48, 0.04, 9.48), edgeMat);
  edge.position.y = -0.37;
  scene.add(edge);

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), new THREE.ShadowMaterial({ opacity: 0.38 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = -0.39;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // Notation labels
  const labels = new THREE.Group();
  const labelGeo = new THREE.PlaneGeometry(0.36, 0.36);
  for (let i = 0; i < 8; i++) {
    const mk = (text, x, z) => {
      const m = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: labelTexture(text), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, -0.025, z);
      labels.add(m);
    };
    mk(FILES[i], i - 3.5, 4.34);
    mk(FILES[i], i - 3.5, -4.34);
    mk(String(i + 1), -4.34, 3.5 - i);
    mk(String(i + 1), 4.34, 3.5 - i);
  }
  scene.add(labels);

  // Per-square overlays: heat, highlight, move dot / capture ring, hanging ring
  const flat = (geo, y) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.visible = false;
    m.renderOrder = 2;
    scene.add(m);
    return m;
  };

  const overlays = new Map();
  const planeGeo = new THREE.PlaneGeometry(0.985, 0.985);
  const dotGeo = new THREE.CircleGeometry(0.16, 32);
  const capGeo = new THREE.RingGeometry(0.36, 0.47, 48);
  const hangGeo = new THREE.RingGeometry(0.4, 0.49, 48);

  for (const m of squareMeshes) {
    const p = m.position;
    const o = {
      heat: flat(planeGeo, 0.002),
      hl: flat(planeGeo, 0.004),
      dot: flat(dotGeo, 0.006),
      cap: flat(capGeo, 0.006),
      hang: flat(hangGeo, 0.008),
    };
    for (const k in o) o[k].position.x = p.x, o[k].position.z = p.z;
    overlays.set(m.userData.sq, o);
  }

  // Hover indicator
  const hoverOverlay = flat(planeGeo, 0.003);
  hoverOverlay.material.color.set('#ffffff');
  hoverOverlay.material.opacity = 0.18;

  // Pieces setup
  const geos = buildGeometries();
  const feltMat = new THREE.MeshStandardMaterial({ color: '#143822', roughness: 0.95 });
  const feltGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.015, 32);
  feltGeo.translate(0, 0.008, 0);

  const whiteMat = new THREE.MeshPhysicalMaterial({
    color: '#f5eee3',
    roughness: 0.26,
    metalness: 0.02,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
    reflectivity: 0.55,
  });
  const blackMat = new THREE.MeshPhysicalMaterial({
    color: '#252438',
    roughness: 0.22,
    metalness: 0.08,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    sheen: 0.45,
    sheenColor: new THREE.Color('#cba6f7'),
  });

  function makePiece(code, sq) {
    const group = new THREE.Group();
    // Green felt disc base
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.userData.sq = sq;
    group.add(felt);

    for (const geo of geos[code[1]]) {
      const m = new THREE.Mesh(geo, code[0] === 'w' ? whiteMat : blackMat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.sq = sq;
      group.add(m);
    }

    if (code[1] === 'n') {
      const baseAngle = code[0] === 'w' ? Math.PI / 2 : -Math.PI / 2;
      const fileIdx = FILES.indexOf(sq[0]);
      const tilt = (fileIdx < 4 ? -0.16 : 0.16) * (code[0] === 'w' ? 1 : -1);
      group.rotation.y = baseAngle + tilt;
    }

    group.position.copy(sqPos(sq));
    scene.add(group);
    return { code, group, sq };
  }

  const pieces = new Map();
  const tweens = [];
  const dyingPieces = [];
  const arrowGroup = new THREE.Group();
  scene.add(arrowGroup);
  const badgeCache = new Map();
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  badge.scale.set(0.42, 0.42, 1);
  badge.renderOrder = 10;
  badge.visible = false;
  scene.add(badge);

  let colors = { red: '#f38ba8', green: '#a6e3a1', blue: '#89b4fa', accent: '#cba6f7', accent2: '#fab387' };
  let hangPhase = [];
  let currentSelected = null;
  let currentTargets = new Map();

  function arrowMesh(from, to, color, opacity, width) {
    const a = sqPos(from);
    const b = sqPos(to);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const w = width / 100;
    const head = w * 2.2;
    const s = new THREE.Shape();
    const start = 0.22;
    const shaft = len - head * 0.9;
    s.moveTo(start, -w / 2);
    s.lineTo(shaft, -w / 2);
    s.lineTo(shaft, -head * 0.62);
    s.lineTo(len, 0);
    s.lineTo(shaft, head * 0.62);
    s.lineTo(shaft, w / 2);
    s.lineTo(start, w / 2);
    s.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(a.x, 0.02, a.z);
    g.rotation.y = Math.atan2(-dz, dx);
    mesh.renderOrder = 5;
    return g;
  }

  function update(v) {
    colors = { ...colors, ...v.colors };
    lightMat.color.set(v.colors.light);
    darkMat.color.set(v.colors.dark);
    edgeMat.color.set(v.colors.accent);
    rim.color.set(v.colors.accent);
    labels.visible = v.coords;
    currentSelected = v.selected;
    currentTargets = v.targets || new Map();

    // Pieces diff
    const removed = [];
    for (const [sq, obj] of pieces) {
      if (v.pieces.get(sq) !== obj.code) {
        pieces.delete(sq);
        removed.push(obj);
      }
    }

    for (const [sq, code] of v.pieces) {
      if (pieces.has(sq)) continue;
      const obj = makePiece(code, sq);
      pieces.set(sq, obj);
      if (!v.animate) continue;

      let src = null;
      if (v.last && sq === v.last.to) src = removed.find((r) => r.sq === v.last.from);
      else src = removed.find((r) => r.code === code);

      if (src) {
        removed.splice(removed.indexOf(src), 1);
        tweens.push({
          group: obj.group,
          from: sqPos(src.sq),
          to: sqPos(sq),
          t0: performance.now(),
          dur: 300,
          lift: code[1] === 'n' ? 0.72 : 0.22,
        });
        obj.group.position.copy(sqPos(src.sq));
      }
    }

    // Any remaining removed piece was captured -> graceful sink/shrink animation
    for (const rem of removed) {
      dyingPieces.push({
        group: rem.group,
        t0: performance.now(),
        dur: 280,
        startY: rem.group.position.y,
      });
    }

    hangPhase = [];
    for (const [sq, o] of overlays) {
      const heat = v.heat.get(sq);
      o.heat.visible = !!heat;
      if (heat) {
        o.heat.material.color.set(heat.side === 'w' ? colors.blue : colors.red);
        o.heat.material.opacity = heat.alpha * 0.85;
      }

      let hl = null;
      if (sq === v.check) hl = [colors.red, 0.75];
      else if (sq === v.selected) hl = [colors.accent, 0.65];
      else if (v.last && (sq === v.last.from || sq === v.last.to)) hl = [colors.accent2, 0.5];
      o.hl.visible = !!hl;
      if (hl) {
        o.hl.material.color.set(hl[0]);
        o.hl.material.opacity = hl[1];
      }

      const t = v.targets.get(sq);
      o.dot.visible = t === 'move';
      o.cap.visible = t === 'capture';
      if (t === 'move') {
        o.dot.material.color.set(colors.accent);
        o.dot.material.opacity = 0.8;
      }
      if (t === 'capture') {
        o.cap.material.color.set(colors.red);
        o.cap.material.opacity = 0.85;
      }

      const hang = v.hang.get(sq);
      o.hang.visible = !!hang;
      if (hang) {
        o.hang.material.color.set(hang === 'mine' ? colors.red : colors.green);
        hangPhase.push(o.hang);
      }
    }

    for (const sq of v.marks) {
      const o = overlays.get(sq);
      o.cap.visible = true;
      o.cap.material.color.set(colors.accent);
      o.cap.material.opacity = 0.85;
    }

    arrowGroup.clear();
    for (const a of v.arrows) arrowGroup.add(arrowMesh(a.from, a.to, a.color, a.opacity, a.width));

    if (v.badge) {
      const key = v.badge.sym + v.badge.color;
      if (!badgeCache.has(key)) badgeCache.set(key, badgeTexture(v.badge.sym, v.badge.color));
      badge.material.map = badgeCache.get(key);
      badge.material.needsUpdate = true;
      const p = sqPos(v.badge.sq);
      const h = HEIGHT[v.pieces.get(v.badge.sq)?.[1]] ?? 0.6;
      badge.position.set(p.x + 0.3, h + 0.22, p.z);
      badge.visible = true;
    } else badge.visible = false;
  }

  // Camera presets and orientation animation
  let camAnim = null;
  let currentOrientation = 'w';
  let currentPreset = 'default';

  function getPresetConfig(preset, color = currentOrientation) {
    const isW = color === 'w';
    if (preset === 'low') {
      return { pos: new THREE.Vector3(0, 7.2, isW ? 11.2 : -11.2), target: new THREE.Vector3(0, 0.3, 0) };
    }
    if (preset === 'top') {
      return { pos: new THREE.Vector3(0, 15.6, isW ? 2.0 : -2.0), target: new THREE.Vector3(0, 0, 0) };
    }
    // 'default' standard 3D view
    return { pos: new THREE.Vector3(0, 11.2, isW ? 9.4 : -9.4), target: new THREE.Vector3(0, 0, 0) };
  }

  function setCameraPreset(preset, duration = 650) {
    currentPreset = preset;
    const cfg = getPresetConfig(preset, currentOrientation);
    camAnim = {
      t0: performance.now(),
      dur: duration,
      fromPos: camera.position.clone(),
      toPos: cfg.pos,
      fromTarget: controls.target.clone(),
      toTarget: cfg.target,
    };
  }

  function resetCamera() {
    setCameraPreset(currentPreset || 'default');
  }

  function setOrientation(color, instant = false) {
    currentOrientation = color;
    for (const m of labels.children) m.rotation.z = color === 'b' ? Math.PI : 0;
    const cfg = getPresetConfig(currentPreset, color);
    if (instant) {
      camera.position.copy(cfg.pos);
      controls.target.copy(cfg.target);
      controls.update();
    } else {
      setCameraPreset(currentPreset, 750);
    }
  }

  // Pointer interactions: click selects/moves, drag orbits camera, hover highlights
  const ray = new THREE.Raycaster();
  let down = null;
  let hoverSq = null;
  const el = renderer.domElement;

  el.addEventListener('pointerdown', (e) => {
    if (e.button === 0) down = { x: e.clientX, y: e.clientY };
  });

  el.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
      el.style.cursor = 'grabbing';
      if (hoverOverlay.visible) hoverOverlay.visible = false;
      return;
    }
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const targets = [...[...pieces.values()].flatMap((p) => p.group.children), ...squareMeshes];
    const hit = ray.intersectObjects(targets, false)[0];
    const sq = hit?.object.userData.sq;

    if (sq !== hoverSq) {
      hoverSq = sq;
      if (hoverSq) {
        const p = sqPos(hoverSq);
        hoverOverlay.position.x = p.x;
        hoverOverlay.position.z = p.z;
        hoverOverlay.visible = true;
      } else {
        hoverOverlay.visible = false;
      }
    }

    if (sq) {
      const hasPiece = pieces.has(sq);
      const isTarget = currentTargets && currentTargets.has(sq);
      el.style.cursor = (hasPiece || isTarget) ? 'pointer' : 'grab';
    } else {
      el.style.cursor = 'grab';
    }
  });

  el.addEventListener('pointerleave', () => {
    hoverSq = null;
    hoverOverlay.visible = false;
  });

  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || e.button !== 0) {
      down = null;
      return;
    }
    down = null;
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const targets = [...[...pieces.values()].flatMap((p) => p.group.children), ...squareMeshes];
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) onSquare(hit.object.userData.sq);
  });

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const ease = (t) => 1 - Math.pow(1 - t, 3);

  renderer.setAnimationLoop((now) => {
    // Piece move tweens
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const t = Math.min(1, (now - tw.t0) / tw.dur);
      const k = ease(t);
      tw.group.position.lerpVectors(tw.from, tw.to, k);
      tw.group.position.y = Math.sin(Math.PI * t) * tw.lift;
      if (t >= 1) tweens.splice(i, 1);
    }

    // Selected piece float
    for (const [sq, obj] of pieces) {
      const isMoving = tweens.some((tw) => tw.group === obj.group);
      if (!isMoving) {
        const isSelected = sq === currentSelected;
        const targetY = isSelected ? 0.32 + Math.sin(now / 200) * 0.03 : 0;
        obj.group.position.y += (targetY - obj.group.position.y) * 0.22;
      }
    }

    // Dying piece fade/shrink
    for (let i = dyingPieces.length - 1; i >= 0; i--) {
      const d = dyingPieces[i];
      const t = Math.min(1, (now - d.t0) / d.dur);
      const s = Math.max(0, 1 - t);
      d.group.scale.set(s, s, s);
      d.group.position.y = d.startY - t * 0.2;
      d.group.rotation.y += 0.06;
      if (t >= 1) {
        scene.remove(d.group);
        dyingPieces.splice(i, 1);
      }
    }

    // Camera animation
    if (camAnim) {
      const t = Math.min(1, (now - camAnim.t0) / camAnim.dur);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
      controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
      controls.update();
      if (t >= 1) camAnim = null;
    }

    // Pulsing hanging rings
    const s = 1 + Math.sin(now / 200) * 0.06;
    for (const h of hangPhase) h.scale.set(s, s, 1);

    controls.update();
    renderer.render(scene, camera);
  });

  function dispose() {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    pmrem.dispose();
    for (const obj of pieces.values()) scene.remove(obj.group);
    for (const d of dyingPieces) scene.remove(d.group);
    lightTex.dispose();
    darkTex.dispose();
    renderer.dispose();
    el.remove();
  }

  return { update, setOrientation, setCameraPreset, resetCamera, dispose };
}
