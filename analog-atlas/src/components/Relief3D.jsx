import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { rampColor } from '../lib/patch.js';

/**
 * Both patches in 3D with ONE renderer and two scissored viewports sharing one camera:
 * same scale, same exaggeration, same light, same angle. Renders only on interaction.
 */
import { hasWebGL, WEBGL_HELP } from '../lib/webgl.js';

export default function Relief3D(props) {
  return hasWebGL() ? <Relief3DGL {...props} /> : <p className="small dim callout">3D view unavailable. {WEBGL_HELP}</p>;
}

function Relief3DGL({ a, b, domain, exaggeration = 2, flicker = null }) {
  const box = useRef(null);
  const st = useRef({});
  useEffect(() => {
    const el = box.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setScissorTest(true);
    el.prepend(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 20000);
    const mk = () => { const s = new THREE.Scene(); s.add(new THREE.AmbientLight(0xffffff, 0.35)); const l = new THREE.DirectionalLight(0xffffff, 1.9); l.position.set(-1500, 1200, 900); s.add(l); return s; };
    const scenes = [mk(), mk()];
    let yaw = 0.7, pitch = 0.62, dist = 3300;
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(0, 0, 0);
      const single = st.current.single;
      const views = single != null ? [[single, 0, w]] : [[0, 0, w / 2], [1, w / 2, w / 2]];
      for (const [k, x, vw] of views) {
        camera.aspect = vw / h; camera.updateProjectionMatrix();
        renderer.setViewport(x, 0, vw, h); renderer.setScissor(x, 0, vw, h);
        renderer.render(scenes[k], camera);
      }
    };
    let drag = null;
    const down = (e) => { drag = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); };
    const move = (e) => { if (!drag) return; yaw -= (e.clientX - drag[0]) * 0.008; pitch = Math.min(1.45, Math.max(0.15, pitch + (e.clientY - drag[1]) * 0.006)); drag = [e.clientX, e.clientY]; draw(); };
    const up = () => { drag = null; };
    const wheel = (e) => { e.preventDefault(); dist = Math.min(7000, Math.max(1200, dist + e.deltaY * 2)); draw(); };
    const key = (e) => { const d = { ArrowLeft: 0.12, ArrowRight: -0.12 }[e.key]; if (d) { e.preventDefault(); yaw += d; draw(); } };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('keydown', key);
    const ro = new ResizeObserver(draw); ro.observe(el);
    st.current = { renderer, scenes, draw, single: null };
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); renderer.dispose(); scenes.forEach((s) => s.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); })); renderer.domElement.remove(); };
  }, []);

  useEffect(() => {
    const { scenes, draw } = st.current;
    if (!scenes || !a || !b) return;
    [a, b].forEach((p, k) => {
      const s = scenes[k];
      const old = s.getObjectByName('terrain'); if (old) { s.remove(old); old.geometry.dispose(); old.material.dispose(); }
      const n = p.n, geo = new THREE.PlaneGeometry(p.size_m, p.size_m, n - 1, n - 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const rel = p.z[i] - p.stats.mean;
        pos.setY(i, rel * exaggeration);
        const c = rampColor((rel - domain[0]) / (domain[1] - domain[0]));
        col.set([c[0] / 255, c[1] / 255, c[2] / 255], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.name = 'terrain'; s.add(m);
    });
    draw();
  }, [a, b, domain, exaggeration]);

  useEffect(() => { if (st.current.draw) { st.current.single = flicker; st.current.draw(); } }, [flicker]);

  return (
    <div ref={box} className="relief3d" tabIndex={0} role="img" aria-label="Both patches in 3D at the same scale and exaggeration. Drag or use arrow keys to orbit.">
      <div className="r-labels">
        {flicker == null ? <><span className="row"><span className="tag-ab a">A</span> Earth</span><span className="row"><span className="tag-ab b">B</span> Target</span></>
          : <span className="row"><span className={'tag-ab ' + (flicker === 0 ? 'a' : 'b')}>{flicker === 0 ? 'A' : 'B'}</span></span>}
      </div>
    </div>
  );
}
