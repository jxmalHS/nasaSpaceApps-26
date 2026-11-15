import { useEffect, useState } from 'react';
import { loadPatch } from './patch.js';
import { scaleMismatch } from './scale.js';

/** How many of the top results get the 2 km check, and how many spots per 55 km cell. */
export const LOCAL_CHECK_TOP = 10;
export const SPOT_OFFSET_KM = 15;

/** Centre plus 4 spots 15 km north, south, east and west, inside the ~55 km cell. */
export function spotsAround(lat, lon, km = SPOT_OFFSET_KM) {
  const dLat = km / 111.32, dLon = km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return [[lat, lon], [lat + dLat, lon], [lat - dLat, lon], [lat, lon + dLon], [lat, lon - dLon]]
    .map(([a, b]) => [r(Math.max(-89.9, Math.min(89.9, a))), r(((b + 540) % 360) - 180)]);
}

/** Combine the spots of one cell: OK if ANY spot matches the target ('2 of 5 spots match'). */
export function combineSpots(spotStats, targetStats) {
  const got = spotStats.filter((s) => s && Number.isFinite(s.slopeMean));
  if (!got.length || !targetStats) return null;
  const matches = got.filter((s) => !scaleMismatch(s, targetStats)).length;
  const n = got.length;
  if (matches > 0) return { ok: true, matches, n, text: `2 km: ${matches} of ${n} spots match` };
  const median = [...got].sort((a, b) => a.slopeMean - b.slopeMean)[Math.floor(n / 2)];
  const m = scaleMismatch(median, targetStats);
  const how = m.steeper ? (Number.isFinite(m.ratio) ? `${m.ratio.toFixed(1)}× steeper` : 'much steeper')
    : m.ratio > 0 ? `${(1 / m.ratio).toFixed(1)}× flatter` : 'much flatter';
  return { ok: false, matches: 0, n, text: `2 km: 0 of ${n} spots match (${how})` };
}

/** Checked-OK sites first, then unchecked ones, then sites where no spot matches; order kept inside each group. */
export function orderByCheck(list, checks) {
  const group = (x) => (checks[x.id] ? (checks[x.id].ok ? 0 : 2) : 1);
  return list.map((x, k) => [x, k]).sort((a, b) => group(a[0]) - group(b[0]) || a[1] - b[1]).map(([x]) => x);
}

/** Run the 2 km check (5 spots per cell) on the top results: {cellId: {ok, matches, n, text}}. */
export function useLocalChecks(rows, target) {
  const [checks, setChecks] = useState({});
  const ids = rows.map((x) => x.id).join(',');
  useEffect(() => {
    if (!target || !rows.length) return undefined;
    const ctrl = new AbortController();
    setChecks({});
    (async () => {
      const tp = await loadPatch({ body: target.body, key: target.id, lat: target.lat, lon: target.lon, signal: ctrl.signal });
      if (!tp || ctrl.signal.aborted) return;
      const jobs = rows.flatMap((x) => spotsAround(x.lat, x.lon).map(([lat, lon], s) => ({ x, s, lat, lon })));
      const stats = Object.fromEntries(rows.map((x) => [x.id, []]));
      const left = Object.fromEntries(rows.map((x) => [x.id, 5]));
      let next = 0;
      const worker = async () => {                      // 8 fetches at a time
        while (next < jobs.length && !ctrl.signal.aborted) {
          const { x, s, lat, lon } = jobs[next++];
          const key = s === 0 ? String(x.id) : null;      // only the centre has a pre-built patch file
          const p = await loadPatch({ body: 'earth', key, lat, lon, signal: ctrl.signal });
          stats[x.id][s] = p?.stats || null;
          if (--left[x.id] === 0 && !ctrl.signal.aborted) {
            const label = combineSpots(stats[x.id], tp.stats);
            if (label) setChecks((c) => ({ ...c, [x.id]: label }));
          }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
    })();
    return () => ctrl.abort();
  }, [ids, target?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  return checks;
}

// Kept for older callers and tests: single-patch label.
export function localCheckLabel(earthStats, targetStats) {
  if (!earthStats || !targetStats) return null;
  const m = scaleMismatch(earthStats, targetStats);
  if (!m) return { ok: true, text: '2 km check OK' };
  const how = m.steeper ? (Number.isFinite(m.ratio) ? `${m.ratio.toFixed(1)}× steeper` : 'much steeper')
    : m.ratio > 0 ? `${(1 / m.ratio).toFixed(1)}× flatter` : 'much flatter';
  return { ok: false, text: `2 km: ${how} than target` };
}
