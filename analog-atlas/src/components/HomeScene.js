import * as THREE from 'three';

/**
 * Earth with the Moon on a smooth, tidally locked orbit. Every few seconds the Earth turns to a
 * documented field site and a tether runs from it to the lunar target that site rehearsed.
 * Blue end = Earth, red end = target: the same visual language as the rest of the app.
 *
 * Performance: one WebGL context, ~25k triangles, capped pixel ratio, adaptive resolution when
 * frames run long, and the loop stops when the canvas is off-screen or the tab is hidden.
 */
const DEG = Math.PI / 180;
const MOON_R = 0.2727; // true Moon/Earth radius ratio
const ORBIT_R = 3.15; // not to scale (true ≈ 60 Earth radii)
const PERIOD = 42; // seconds per orbit
const PAIR_MS = 6200;

export function surfacePoint(lat, lon, r = 1) {
  const la = lat * DEG, lo = lon * DEG;
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class HomeScene {
  constructor(canvas, { pairs, onPair, onSlowFrames, reduced = false, base = '/' }) {
    this.canvas = canvas;
    this.pairs = pairs;
    this.onPair = onPair;
    this.onSlowFrames=onSlowFrames;
    this.reduced = reduced;
    this.running = false;
    this.visible = true;
    this.dprCap = Math.min(window.devicePixelRatio || 1, 1.75);
    this.dpr = this.dprCap;
    this.frameTimes = [];

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.dpr < 1.5, alpha: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.camera.position.set(0, 1.25, 8.8);
    this.camera.lookAt(0, -0.15, 0);

    scene.add(new THREE.AmbientLight(0x6f86b8, 0.16));
    const sun = new THREE.DirectionalLight(0xfff4e6, 3.4);
    sun.position.set(-7, 2.2, 5.5);
    scene.add(sun);

    const loader = new THREE.TextureLoader();
    const tex = (name) => {
      const t = loader.load(base + 'textures/' + name, () => this.requestFrame());
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };

    // Earth
    this.earth = new THREE.Group();
    this.earth.rotation.z = 23.44 * DEG * 0.35; // a hint of axial tilt
    scene.add(this.earth);
    this.earthSpin = new THREE.Group();
    this.earth.add(this.earthSpin);
    const earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshPhongMaterial({ map: tex('earth.jpg'), shininess: 9, specular: new THREE.Color(0x1d2c4a) }),
    );
    this.earthSpin.add(earthMesh);

    // Atmosphere rim (fresnel), blue: Earth's colour in this app.
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.012, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending,
        uniforms: { c: { value: new THREE.Color(0x4c8dff) } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.5); gl_FragColor = vec4(c * f * 1.4, f); }',
      }),
    );
    this.earth.add(atmo);

    // Moon orbit, inclined ~5.1°
    this.orbit = new THREE.Group();
    this.orbit.rotation.z = 5.1 * DEG;
    this.orbit.rotation.x = -3 * DEG;
    scene.add(this.orbit);
    const pts = [];
    for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * ORBIT_R, 0, Math.sin(a) * ORBIT_R)); }
    const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x9cc2ff, transparent: true, opacity: 0.28, dashSize: 0.06, gapSize: 0.07 }));
    orbitLine.computeLineDistances();
    this.orbit.add(orbitLine);

    this.moonPivot = new THREE.Group();
    this.orbit.add(this.moonPivot);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 64, 48), new THREE.MeshPhongMaterial({ map: tex('moon.jpg'), shininess: 2 }));
    this.moonPivot.add(this.moon);

    // Stars: static points, no per-frame cost.
    const n = 1400, sp = new Float32Array(n * 3), sc = new Float32Array(n * 3);
    const rnd = mulberry(11);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = 70;
      sp[i * 3] = Math.sqrt(1 - u * u) * Math.cos(th) * rr; sp[i * 3 + 1] = u * rr; sp[i * 3 + 2] = Math.sqrt(1 - u * u) * Math.sin(th) * rr;
      const w = 0.55 + rnd() * 0.45, b = rnd() < 0.15 ? 1 : 0.85 + rnd() * 0.15;
      sc[i * 3] = w * b * 0.92; sc[i * 3 + 1] = w * b * 0.95; sc[i * 3 + 2] = w;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));

    // Tether: a curve with a blue → red gradient, plus a pin at each end.
    this.SEG = 72;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((this.SEG + 1) * 3), 3));
    const cols = new Float32Array((this.SEG + 1) * 3);
    const cA = new THREE.Color(0x4c8dff), cB = new THREE.Color(0xfc3d21), tmp = new THREE.Color();
    for (let i = 0; i <= this.SEG; i++) { tmp.copy(cA).lerp(cB, i / this.SEG); cols.set([tmp.r, tmp.g, tmp.b], i * 3); }
    tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.tether = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }));
    this.tether.frustumCulled = false;
    scene.add(this.tether);
    const pin = (c) => new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0 }));
    this.pinE = pin(0x9cc2ff); this.pinM = pin(0xff8a73);
    this.earthSpin.add(this.pinE); this.moon.add(this.pinM);
    this.pinM.scale.setScalar(0.75);

    this.t0 = performance.now();
    this.pairIdx = 0;
    this.pairStart = this.t0;
    this.spin = { from: 0, to: 0, start: this.t0 };
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.setPair(0, this.t0, true);

    this.onVis = () => { this.visible = !document.hidden; this.visible && !this.reduced ? this.start() : this.stop(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.io = new IntersectionObserver(([e]) => { e.isIntersecting && !this.reduced ? this.start() : this.stop(); }, { threshold: 0.02 });
    this.io.observe(canvas);
    this.onMove = (e) => { this.mouse.x = (e.clientX / innerWidth) * 2 - 1; this.mouse.y = (e.clientY / innerHeight) * 2 - 1; };
    if (!reduced) addEventListener('pointermove', this.onMove, { passive: true });
  }

  setPair(i, now, instant = false) {
    this.pairIdx = (i + this.pairs.length) % this.pairs.length;
    this.pairStart = now;
    const p = this.pairs[this.pairIdx];
    this.pinE.position.copy(surfacePoint(p.earth.lat, p.earth.lon, 1.006));
    this.pinM.position.copy(surfacePoint(p.moon.lat, p.moon.lon, MOON_R * 1.02));
    // Turn the Earth so the site faces the camera (slightly offset toward the Moon side).
    const want = -Math.PI / 2 - p.earth.lon * DEG + 0.55;
    const cur = this.earthSpin.rotation.y;
    let delta = ((want - cur) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    this.spin = { from: cur, to: cur + delta, start: now, dur: instant ? 0 : 1600 };
    if (instant) this.earthSpin.rotation.y = cur + delta;
    this.onPair?.(this.pairIdx);
  }

  next(dir = 1) { this.setPair(this.pairIdx + dir, performance.now()); this.requestFrame(); }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Push the planets right of centre on wide screens so the copy owns the left.
    const wide = w / h > 1.15;
    this.camera.setViewOffset(w, h, wide ? -w * 0.2 : 0, 0, w, h);
    this.camera.updateProjectionMatrix();
    this.requestFrame();
  }

  start() {
    if (this.running || !this.visible) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  requestFrame() { if (!this.running) requestAnimationFrame((t) => this.frame(t)); }

  frame(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const reduced = this.reduced;

    if (!reduced && now - this.pairStart > PAIR_MS) this.setPair(this.pairIdx + 1, now);

    // Earth: eased turn toward the active site, then a slow drift.
    const s = this.spin;
    const k = s.dur ? Math.min(1, (now - s.start) / s.dur) : 1;
    const drift = reduced ? 0 : (now - s.start - (s.dur || 0)) / 1000 * 0.012;
    this.earthSpin.rotation.y = s.from + (s.to - s.from) * easeInOut(k) + Math.max(0, drift);

    // Moon: steady circular orbit, tidally locked (near side always faces Earth).
    const th = reduced ? 0.95 : (t / PERIOD) * Math.PI * 2 + 0.95;
    this.moonPivot.position.set(Math.cos(th) * ORBIT_R, 0, Math.sin(th) * ORBIT_R);
    this.moon.rotation.y = Math.PI - th;
    this.moon.rotation.x = 0;

    // Gentle parallax, spring-smoothed.
    if (!reduced) {
      this.mouse.sx += (this.mouse.x - this.mouse.sx) * Math.min(1, dt * 2.5);
      this.mouse.sy += (this.mouse.y - this.mouse.sy) * Math.min(1, dt * 2.5);
      this.camera.position.x = this.mouse.sx * 0.35;
      this.camera.position.y = 1.25 - this.mouse.sy * 0.2;
      this.camera.lookAt(0, -0.15, 0);
    }

    // Tether reveal: grow 0 → 1 over 900 ms, hold, then fade before the next pair.
    const age = reduced ? 2000 : now - this.pairStart;
    const grow = easeOut(Math.min(1, Math.max(0, (age - 500) / 900)));
    const fade = reduced ? 1 : 1 - Math.min(1, Math.max(0, (age - (PAIR_MS - 700)) / 600));
    this.updateTether(grow);
    const op = Math.min(grow * 1.4, 1) * fade;
    this.tether.material.opacity = 0.95 * op;
    this.pinE.material.opacity = Math.min(1, age / 400) * fade;
    this.pinM.material.opacity = grow * fade;

    this.renderer.render(this.scene, this.camera);
    this.adapt(dt);
  }

  updateTether(grow) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.pinE.getWorldPosition(a);
    this.pinM.getWorldPosition(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const lift = mid.clone().normalize().multiplyScalar(0.9 + a.distanceTo(b) * 0.18);
    const ctrl = mid.add(lift).add(new THREE.Vector3(0, 0.5, 0));
    const pos = this.tether.geometry.attributes.position;
    const n = this.SEG, upto = Math.max(1, Math.round(n * grow));
    const p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = Math.min(i, upto) / n;
      p.set(0, 0, 0)
        .addScaledVector(a, (1 - u) * (1 - u))
        .addScaledVector(ctrl, 2 * (1 - u) * u)
        .addScaledVector(b, u * u);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.tether.geometry.setDrawRange(0, upto + 1);
  }

  /** Drop resolution when frames run long (weak GPUs), restore when there is headroom. */
  adapt(dt) {
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 30) return;
    const avg = ft.reduce((x, y) => x + y, 0) / ft.length;
    ft.length = 0;
    if(this.running && this.dpr<=0.5 && avg>1/35 && this.onSlowFrames){
      const pause=this.onSlowFrames;this.onSlowFrames=null;pause();return;
    }
    let next = this.dpr;
    if (avg > 1 / 45) next = Math.max(0.5, this.dpr - 0.25);
    else if (avg < 1 / 58 && this.dpr < this.dprCap) next = Math.min(this.dprCap, this.dpr + 0.25);
    if (next !== this.dpr) { this.dpr = next; this.renderer.setPixelRatio(next); this.resize(); }
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVis);
    removeEventListener('pointermove', this.onMove);
    this.io.disconnect();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) { m.map?.dispose?.(); m.dispose?.(); } });
    this.renderer.dispose();
  }
}

function mulberry(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
