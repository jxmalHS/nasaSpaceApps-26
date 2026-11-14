/**
 * ML ranking provider. Three sources, tried in this order:
 *   1. Live API  (VITE_ML_API set)        POST {api}/rank → base64 uint8 scores
 *   2. Static bundle  public/data/ml/      manifest.json + one uint8 file per (test, target)
 *   3. none                                the app ranks with rules only and says so
 * Any bundle built for another index build is refused (fingerprint mismatch).
 */
export async function mlProvider({ base, fingerprint, n, apiBase }) {
  const cache = new Map(), detailCache = new Map();
  let manifest = null, status = 'none', reason = 'No model bundle found in /data/ml.';
  try {
    const r = await fetch(base + 'data/ml/manifest.json', { cache: 'no-cache' });
    if (r.ok) {
      manifest = await r.json();
      if (manifest.index_fingerprint !== fingerprint) {
        status = 'stale';
        reason = `Model bundle was built for index ${manifest.index_fingerprint}; this site serves ${fingerprint}. Re-run ml/export_scores.py.`;
        manifest = { ...manifest, sets: [] };
      } else {
        status = 'bundle';
        reason = null;
      }
    }
  } catch { /* offline or absent: rules only */ }

  let api = null;
  if (apiBase) {
    try {
      const h = await fetch(apiBase.replace(/\/$/, '') + '/health').then((r) => r.json());
      if (h.index_fingerprint === fingerprint) { api = apiBase.replace(/\/$/, ''); status = 'api'; reason = null; }
      else { reason = `Live model serves index ${h.index_fingerprint}; expected ${fingerprint}.`; }
    } catch (e) { reason = 'Live model API unreachable; using the static bundle.'; }
  }

  const decode = (u8) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = u8[i] === 255 ? NaN : u8[i] / 254;
    return out;
  };

  return {
    summary: () => ({ status, reason, model: manifest?.model ?? null, validation: manifest?.validation ?? [],
      sets: (manifest?.sets ?? []).map(({ test_id, target_id, coverage }) => ({ test_id, target_id, coverage })), created: manifest?.created ?? null }),
    async get(testId, targetId) {
      const key = testId + '|' + targetId;
      if (cache.has(key)) return cache.get(key);
      let arr = null;
      if (api) {
        try {
          const r = await fetch(api + '/rank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test_id: testId, target_id: targetId }) });
          const j = await r.json();
          if (j.index_fingerprint === fingerprint) {
            const bin = atob(j.scores_b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            if (u8.length === n) arr = decode(u8);
          }
        } catch { /* fall through to bundle */ }
      }
      if (!arr && manifest) {
        const set = manifest.sets.find((s) => s.test_id === testId && s.target_id === targetId) || manifest.sets.find((s) => s.test_id === testId && s.target_id === 'any');
        if (set) {
          const r = await fetch(base + 'data/' + set.file);
          if (r.ok) {
            const u8 = new Uint8Array(await r.arrayBuffer());
            if (u8.length === n) arr = decode(u8);
          }
        }
      }
      cache.set(key, arr);
      return arr;
    },
    /** Per-cell detail the model exported (confidence, requirements, recommended spot…), or null. */
    async details(testId, targetId) {
      const key = testId + '|' + targetId;
      if (detailCache.has(key)) return detailCache.get(key);
      let out = null;
      const set = manifest?.sets.find((s) => s.test_id === testId && s.target_id === targetId) || manifest?.sets.find((s) => s.test_id === testId && s.target_id === 'any');
      if (set?.details_file) {
        try { const r = await fetch(base + 'data/' + set.details_file); if (r.ok) out = await r.json(); } catch { /* none */ }
      }
      detailCache.set(key, out);
      return out;
    },
  };
}
