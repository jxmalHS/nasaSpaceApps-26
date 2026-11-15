import { useEffect, useState } from 'react';
import { loadPatch } from './patch.js';
import { scaleMismatch } from './scale.js';

/** How many of the top results get the 2 km check (each needs one ~1 s terrain fetch). */
export const LOCAL_CHECK_TOP = 10;

/** Badge text for one site: null while loading or when there is no terrain to compare. */
export function localCheckLabel(earthStats, targetStats) {
  if (!earthStats || !targetStats) return null;
  const m = scaleMismatch(earthStats, targetStats);
  if (!m) return { ok: true, text: '2 km check OK' };
  const how = m.steeper ? (Number.isFinite(m.ratio) ? `${m.ratio.toFixed(1)}× steeper` : 'much steeper')
    : m.ratio > 0 ? `${(1 / m.ratio).toFixed(1)}× flatter` : 'much flatter';
  return { ok: false, text: `2 km: ${how} than target` };
}

/** Run the Compare page's 2 km terrain check on the top results: {cellId: {ok, text}}. */
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
      let next = 0;
      const worker = async () => {                    // 4 fetches at a time
        while (next < rows.length && !ctrl.signal.aborted) {
          const x = rows[next++];
          const ep = await loadPatch({ body: 'earth', key: String(x.id), lat: x.lat, lon: x.lon, signal: ctrl.signal });
          const label = localCheckLabel(ep?.stats, tp.stats);
          if (label && !ctrl.signal.aborted) setChecks((c) => ({ ...c, [x.id]: label }));
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })();
    return () => ctrl.abort();
  }, [ids, target?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  return checks;
}
