import { useEffect, useRef, useState } from 'react';
import { cellLatLon, mercY, MERC_MAX } from '../lib/geo.js';
import { WEBGL_HELP } from '../lib/webgl.js';

/**
 * No-WebGL fallback for the Earth map: a flat Mercator canvas with the bundled Blue Marble,
 * the same suitability raster, top candidates and the selection. Click anywhere to inspect.
 */
export default function FlatMap({ imageryOnly, result, layerImage, sel, onPick }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [bg, setBg] = useState(null);
  const yMax = mercY(MERC_MAX);

  useEffect(() => {
    const im = new Image();
    im.onload = () => setBg(im);
    im.src = import.meta.env.BASE_URL + 'textures/earth_3857.jpg';
  }, []);

  useEffect(() => {
    const c = canvas.current, w = wrap.current;
    const draw = () => {
      const size = Math.min(w.clientWidth, w.clientHeight * 1.0) || 600;
      const W = w.clientWidth, H = w.clientHeight;
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#03060d'; ctx.fillRect(0, 0, W, H);
      const s = Math.min(W, H) * 1.0, ox = (W - s) / 2, oy = (H - s) / 2;
      if (bg) { ctx.globalAlpha = imageryOnly ? 1 : 0.55; ctx.drawImage(bg, ox, oy, s, s); ctx.globalAlpha = 1; }
      const img = layerImage || result?.raster;
      if (!imageryOnly && img) {
        const off = document.createElement('canvas'); off.width = img.width; off.height = img.height;
        off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(off, ox, oy, s, s);
      }
      const px = (lat, lon) => [ox + ((lon + 180) / 360) * s, oy + ((yMax - mercY(lat)) / (2 * yMax)) * s];
      if (!imageryOnly && result?.points) {
        const p = result.points;
        for (let k = 0; k < Math.min(400, p.length / 4); k++) {
          const [x, y] = px(p[k * 4 + 1], p[k * 4]);
          ctx.fillStyle = k < 20 ? '#ffffff' : '#9cc2ff'; ctx.beginPath(); ctx.arc(x, y, k < 20 ? 3 : 2, 0, 7); ctx.fill();
        }
      }
      if (!imageryOnly && sel != null) {
        const [la, lo] = cellLatLon(sel); const [x, y] = px(la, lo);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 6, 12, 12);
      }
      c.dataset.geom = JSON.stringify([ox, oy, s]);
      void size;
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(w);
    return () => ro.disconnect();
  }, [bg, result, layerImage, sel, imageryOnly]);

  const click = (e) => {
    const r = canvas.current.getBoundingClientRect();
    const [ox, oy, s] = JSON.parse(canvas.current.dataset.geom || '[0,0,1]');
    const u = (e.clientX - r.left - ox) / s, v = (e.clientY - r.top - oy) / s;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const my = yMax - v * 2 * yMax;
    onPick?.({ lat: (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * (180 / Math.PI), lon: u * 360 - 180 });
  };

  return (
    <div className="earth-map" ref={wrap}>
      <canvas ref={canvas} onClick={click} style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }} role="img" aria-label="Flat map of suitability. Use the ranked list for keyboard access." />
      <div className="map-note small" role="status">Flat map: {WEBGL_HELP}</div>
    </div>
  );
}
