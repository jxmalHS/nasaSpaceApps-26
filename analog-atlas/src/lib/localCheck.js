import { useEffect, useState } from 'react';
import { loadPatch } from './patch.js';
import { scaleMismatch } from './scale.js';
import { STATUS } from './scoring.js';

/** One verdict per site, for the results list.
 *  Good match  = passes every strict limit, no warnings, and at least one 2 km spot matches the target.
 *  Check first = promising but not confirmed (2 km check not run, unverified data, or a soft-limit warning).
 *  Poor        = fails a strict limit, or no 2 km spot matches the target. */
export function siteVerdict(x, check) {
  if (x.status === STATUS.FAIL) return { kind: 'notmet', text: 'Poor: fails a limit', order: 2 };
  if (check && !check.ok) return { kind: 'notmet', text: 'Poor up close', order: 2 };
  if (x.status === STATUS.PASS && check?.ok && !x.warn) return { kind: 'met', text: 'Good match', order: 0 };
  return { kind: 'warn', text: 'Check first', order: 1 };
}

/** Plain-text details for a row's tooltip: everything the verdict is built from. */
export function verdictDetails(x, check, topText) {
  return [topText ? `${topText} of Earth places on what we measure (55 km)` : 'Not ranked',
    check ? check.text : '2 km check not run (only the top 10 are checked)',
    x.status === STATUS.FAIL ? 'Fails a strict limit' : x.status === STATUS.UNKNOWN ? 'Unverified: missing data for a limit' : x.warn ? `${x.warn} soft-limit warning(s)` : 'Passes every limit',
    x.beatsBaseline ? 'Scores above NASA’s best usual site (55 km)' : null].filter(Boolean).join(' · ');
}

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

/** Good match first, then Check first, then Poor; the original order is kept inside each group. */
export function orderByCheck(list, checks) {
  const group = (x) => siteVerdict(x, checks[x.id]).order;
  return list.map((x, k) => [x, k]).sort((a, b) => group(a[0]) - group(b[0]) || a[1] - b[1]).map(([x]) => x);
}

const latest = new Map();
/** The 2 km check result for a cell, if the results list has run it. */
export const getLocalCheck = (id) => latest.get(id) || null;

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
            if (label) { latest.set(x.id, label); setChecks((c) => ({ ...c, [x.id]: label })); }
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
