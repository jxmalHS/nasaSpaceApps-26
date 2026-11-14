import { readFileSync } from 'node:fs';
import { percentile } from '../src/lib/scoring.js';
const J = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
export function loadAll() {
  const features = J('src/config/features.json').features;
  const missions = J('src/config/missions.json');
  const targets = J('src/config/targets.json').targets;
  const F = Object.fromEntries(features.map((f) => [f.id, f]));
  const tests = Object.fromEntries(missions.systems.flatMap((s) => s.tests.map((t) => [t.id, t])));
  const T = Object.fromEntries(targets.map((t) => [t.id, t]));
  const meta = J('public/data/earth_index.meta.json');
  const buf = readFileSync(new URL('../public/data/earth_index.bin', import.meta.url));
  const n = meta.n; let off = 4 * n;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const X = [], QX = [], cols = {}, quant = {};
  meta.columns.forEach((c, j) => {
    const q = new Uint16Array(ab, off, n); off += 2 * n;
    const x = new Float32Array(n), qx = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = q[i] === 65535 ? NaN : c.min + (q[i] / 65534) * (c.max - c.min); qx[i] = percentile(x[i], c.q); }
    X.push(x); QX.push(qx); cols[c.id] = j; quant[c.id] = c.q;
  });
  const ids = new Uint32Array(ab, 0, n);
  return { catalog: { F, tests, T }, tests, T, meta, X, QX, cols, quant, n, ids };
}
