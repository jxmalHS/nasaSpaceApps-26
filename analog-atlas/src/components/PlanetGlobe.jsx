import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BODY } from '../lib/catalog.js';
import { surfacePoint } from './HomeScene.js';
import { useReducedMotion } from './ui.jsx';
import { hasWebGL } from '../lib/webgl.js';

const R_MOON_M = 1737400, POLAR_EXTENT_M = 457440;

/**
 * Moon / Mars globe for choosing a target. Renders on demand only (no idle loop).
 * Each body gets its own radius from BODY explicitly; nothing relies on an Earth default.
 * The lunar south pole uses LOLA polar-stereographic imagery on a cap with exact UVs,
 * because equirectangular textures smear exactly where the Artemis sites are.
 */
export default function PlanetGlobe(props) {
  return hasWebGL() ? <Globe3D {...props} /> : <FlatPlanet {...props} />;
}

/** No-WebGL fallback: the equirectangular map with clickable target pins. */
function FlatPlanet({ body, targets, selected, onSelect, height = 320 }) {
  return (
    <div className="planet-globe" style={{ height, display: 'grid', placeItems: 'center', cursor: 'default' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 900, aspectRatio: '2 / 1' }}>
        <img src={import.meta.env.BASE_URL + 'textures/' + (body === 'mars' ? 'mars.jpg' : 'moon.jpg')} alt={`${BODY[body].label} map`} style={{ width: '100%', height: '100%', display: 'block', opacity: 0.85 }} />
        {targets.map((t) => (
          <button key={t.id} className={'pg-label' + (t.id === selected ? ' on' : '')} aria-pressed={t.id === selected} onClick={() => onSelect?.(t.id)}
            style={{ left: `${((t.lon + 180) / 360) * 100}%`, top: `${((90 - t.lat) / 180) * 100}%`, transform: 'translate(0, -50%)', margin: 0, opacity: 1, zIndex: 2 }}>
            {t.name.replace('Shackleton–de Gerlache ', '')}
          </button>
        ))}
      </div>
    </div>
  );
}

function Globe3D({ body, targets, selected, onSelect, valueOf, height = 320 }) {
  const box = useRef(null);
  const api = useRef(null);
  const reduced = useReducedMotion();
  const selRef = useRef(onSelect);
  selRef.current = onSelect;

  useEffect(() => {
    const el = box.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, 4.4);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-3, 1.5, 4);
    scene.add(sun);
    const globe = new THREE.Group();
    scene.add(globe);
    const loader = new THREE.TextureLoader();
    const load = (f) => { const t = loader.load(import.meta.env.BASE_URL + 'textures/' + f, () => draw()); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshPhongMaterial({ map: load(body === 'mars' ? 'mars.jpg' : 'moon.jpg'), shininess: 2 })));
    if (body === 'moon') globe.add(polarCap(load('moon_south_polar.jpg')));

    const pins = new THREE.Group();
    globe.add(pins);
    const labels = el.querySelector('.pg-labels');

    let q = new THREE.Quaternion(), qTarget = null, dist = 4.4;
    // North-up turn: yaw the target's longitude to face the camera, then pitch by its latitude.
    // Polar targets keep the pole just below centre so the rim terrain around it stays visible.
    const faceQuat = (lat, lon) => {
      const yaw = -Math.PI / 2 - (lon * Math.PI) / 180;
      const pitch = ((Math.abs(lat) > 70 ? lat * 0.86 : lat) * Math.PI) / 180;
      return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'XYZ'));
    };

    function draw() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.position.z = dist; camera.updateProjectionMatrix();
      globe.quaternion.copy(q);
      renderer.render(scene, camera);
      // HTML labels for visible pins
      const v = new THREE.Vector3();
      for (const c of labels.children) {
        const p = pins.getObjectByName(c.dataset.id);
        if (!p) continue;
        p.getWorldPosition(v);
        const facing = v.z > 0.12; // camera looks down -z from +z: front hemisphere only
        v.project(camera);
        c.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
        c.style.opacity = facing ? 1 : 0;
        c.style.pointerEvents = facing ? 'auto' : 'none';
      }
    }

    let anim = 0;
    function animateTo(target) {
      cancelAnimationFrame(anim);
      if (reduced) { q.copy(target); draw(); return; }
      const from = q.clone(), t0 = performance.now(), dur = 900;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        q.slerpQuaternions(from, target, e); draw();
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    // drag to rotate, wheel to zoom
    let drag = null;
    const onDown = (e) => { if (e.target.closest('.pg-label')) return; drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); cancelAnimationFrame(anim); };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      const r = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.006, dx * 0.006, 0));
      q.premultiply(r); draw();
    };
    const onUp = () => { drag = null; };
    const onWheel = (e) => { e.preventDefault(); dist = Math.min(7, Math.max(2.2, dist + e.deltaY * 0.002)); draw(); };
    const onKey = (e) => {
      const k = { ArrowLeft: [0, -0.15], ArrowRight: [0, 0.15], ArrowUp: [-0.15, 0], ArrowDown: [0.15, 0] }[e.key];
      if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();dist=Math.max(2.2,Math.min(7,dist+(e.key==='-'?.4:-.4)));draw();return}
      if (!k) return;
      e.preventDefault();
      q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(k[0], k[1], 0))); draw();
    };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('keydown', onKey);
    const ro = new ResizeObserver(draw); ro.observe(el);

    api.current = {
      setPins(list, sel) {
        pins.clear();
        for (const t of list) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(t.id === sel ? 0.03 : 0.02, 16, 12), new THREE.MeshBasicMaterial({ color: t.id === sel ? 0xffffff : 0xfc3d21 }));
          m.position.copy(surfacePoint(t.lat, t.lon, 1.005)); m.name = t.id; pins.add(m);
        }
        draw();
      },
      face(lat, lon) { dist = Math.abs(lat) > 70 ? 2.35 : 4.4; animateTo(faceQuat(lat, lon)); },
      draw,
    };
    return () => { cancelAnimationFrame(anim); ro.disconnect(); el.removeEventListener('pointerdown', onDown);el.removeEventListener('pointermove', onMove);el.removeEventListener('pointerup', onUp);el.removeEventListener('keydown',onKey);el.removeEventListener('wheel', onWheel); renderer.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }); renderer.domElement.remove(); };
  }, [body]);

  useEffect(() => {
    api.current?.setPins(targets, selected);
    const t = targets.find((x) => x.id === selected) || targets[0];
    if (t) api.current?.face(t.lat, t.lon);
  }, [targets, selected, body]);

  return (
    <div className="planet-globe" ref={box} style={{ height }} tabIndex={0} role="application"
      aria-label={`${BODY[body].label} globe. Drag or use arrow keys to rotate. Plus and minus zoom. Targets are also listed as buttons.`}>
      <div className="pg-labels">
        {targets.map((t) => (
          <button key={t.id} data-id={t.id} className={'pg-label' + (t.id === selected ? ' on' : '')} onClick={() => selRef.current?.(t.id)} aria-pressed={t.id === selected}>
            {t.name.replace('Shackleton–de Gerlache ', '')}{valueOf ? <span className="num"> · {valueOf(t)}</span> : null}
          </button>
        ))}
      </div>
      <div className="pg-body tiny">{BODY[body].label} · R = {BODY[body].radiusKm.toLocaleString()} km</div>
    </div>
  );
}

/** Spherical cap 75°S–90°S with UVs from the polar stereographic projection of the LOLA mosaic. */
function polarCap(texture) {
  const geo = new THREE.SphereGeometry(1.0015, 128, 24, 0, Math.PI * 2, Math.PI * (165 / 180), Math.PI * (15 / 180));
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const lat = Math.asin(v.y), lon = Math.atan2(-v.z, v.x);
    const rho = 2 * R_MOON_M * Math.tan(Math.PI / 4 + lat / 2);
    const x = rho * Math.sin(lon), y = rho * Math.cos(lon);
    uv.setXY(i, (x + POLAR_EXTENT_M) / (2 * POLAR_EXTENT_M), (y + POLAR_EXTENT_M) / (2 * POLAR_EXTENT_M));
  }
  uv.needsUpdate = true;
  return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ map: texture, color: 0xa9a9a9, shininess: 2 }));
}
