import { useSyncExternalStore } from 'react';
import { tests, T, DEFAULT } from './catalog.js';

/**
 * One store for the whole app. Everything that defines a view lives here and in the URL:
 * reload or share the link and the exact mission view comes back.
 */
const initial = () => ({
  targetId: DEFAULT.targetId,
  testId: DEFAULT.testId,
  mode: 'stress',            // 'stress' (meet or exceed) | 'realism' (closest match)
  weights: {},               // overrides of test defaults: fid → 0..100
  roles: {},                 // overrides: fid → 'target' | 'ignore' | 'interference'
  thresholds: {},            // overrides / user requirements: fid → { op, v, hard, user?, off? }
  filters: { minEvidence: 0.5, region: 'all', includeUnknown: true, beatsBaseline: false },
  rankBy: 'rules',           // 'rules' | 'ml' | 'blend'
  sel: null,                 // selected Earth cell id
  pins: [],                  // shortlisted cell ids
  layer: 'suit',             // map layer: 'suit' or a feature id
  view: 'earth',             // 'earth' | 'split' | 'target'
  compareId: null,           // Earth cell in Compare
  uploads: [],               // user CSV sites (not in URL; too big)
  tourStep: null,
  openPanels: [],            // which advanced panels are open (not in URL)
});

let state = initial();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export function getState() { return state; }

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  emit();
  scheduleUrl();
}

export function useStore(selector) {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => selector(state));
}

/* ---------- actions ---------- */

export function selectTest(testId) {
  const t = tests[testId];
  if (!t) return;
  const target = T[state.targetId];
  const targetId = t.bodies.includes(target.body) ? state.targetId : (t.bodies[0] === 'moon' ? 'connecting-ridge' : 'jezero');
  // Smart defaults: a new test loads its own weights, roles and thresholds.
  setState({ testId, targetId, weights: {}, roles: {}, thresholds: {}, sel: null });
}

export function selectTarget(targetId) {
  const tg = T[targetId];
  if (!tg) return;
  const t = tests[state.testId];
  if (t.bodies.includes(tg.body)) return setState({ targetId, sel: null });
  const alt = Object.values(tests).find((x) => x.system === t.system && x.bodies.includes(tg.body)) || Object.values(tests).find((x) => x.bodies.includes(tg.body));
  setState({ targetId, testId: alt.id, weights: {}, roles: {}, thresholds: {}, sel: null });
}

export function resetDefaults() { setState({ weights: {}, roles: {}, thresholds: {} }); }

export function togglePin(id) {
  setState((s) => ({ pins: s.pins.includes(id) ? s.pins.filter((x) => x !== id) : [...s.pins, id].slice(-12) }));
}

/** Everything the scoring worker needs. Stable JSON so results cache cleanly. */
export function scoringConfig(s = state) {
  return {
    testId: s.testId, targetId: s.targetId, mode: s.mode, weights: s.weights, roles: s.roles,
    thresholds: s.thresholds, filters: s.filters, rankBy: s.rankBy,
  };
}

export const isCustomised = (s = state) => Object.keys(s.weights).length + Object.keys(s.roles).length + Object.keys(s.thresholds).length > 0;

/* ---------- URL encoding ---------- */

const b64 = {
  enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))),
};

export function encodeState(s = state) {
  const p = new URLSearchParams();
  p.set('target', s.targetId);
  p.set('test', s.testId);
  if (s.mode !== 'stress') p.set('mode', s.mode);
  if (s.rankBy !== 'rules') p.set('rank', s.rankBy);
  const o = {};
  if (Object.keys(s.weights).length) o.w = s.weights;
  if (Object.keys(s.roles).length) o.r = s.roles;
  if (Object.keys(s.thresholds).length) o.t = s.thresholds;
  const f = s.filters, d = initial().filters;
  const fd = Object.fromEntries(Object.entries(f).filter(([k, v]) => d[k] !== v));
  if (Object.keys(fd).length) o.f = fd;
  if (Object.keys(o).length) p.set('cfg', b64.enc(o));
  if (s.sel != null) p.set('site', String(s.sel));
  if (s.pins.length) p.set('pins', s.pins.join('.'));
  if (s.layer !== 'suit') p.set('layer', s.layer);
  if (s.view !== 'earth') p.set('view', s.view);
  if (s.compareId != null) p.set('cmp', String(s.compareId));
  return p.toString();
}

export function decodeState(search) {
  const p = new URLSearchParams(search);
  const s = initial();
  if (p.get('target') && T[p.get('target')]) s.targetId = p.get('target');
  if (p.get('test') && tests[p.get('test')]) s.testId = p.get('test');
  if (!tests[s.testId].bodies.includes(T[s.targetId].body)) s.targetId = tests[s.testId].bodies[0] === 'moon' ? 'connecting-ridge' : 'jezero';
  if (p.get('mode') === 'realism') s.mode = 'realism';
  if (['ml', 'blend'].includes(p.get('rank'))) s.rankBy = p.get('rank');
  try {
    if (p.get('cfg')) {
      const o = b64.dec(p.get('cfg'));
      s.weights = o.w || {}; s.roles = o.r || {}; s.thresholds = o.t || {};
      s.filters = { ...s.filters, ...(o.f || {}) };
    }
  } catch { /* a mangled link falls back to defaults */ }
  const num = (k) => (p.get(k) && /^\d+$/.test(p.get(k)) ? Number(p.get(k)) : null);
  s.sel = num('site');
  s.compareId = num('cmp');
  if (p.get('pins')) s.pins = p.get('pins').split('.').filter((x) => /^\d+$/.test(x)).map(Number).slice(0, 12);
  if (p.get('layer')) s.layer = p.get('layer');
  if (['split', 'target'].includes(p.get('view'))) s.view = p.get('view');
  return s;
}

export function hydrateFromUrl() {
  state = { ...decodeState(location.search), uploads: state.uploads };
  emit();
}

let urlTimer = 0;
function scheduleUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const q = encodeState();
    const url = location.pathname + (q ? '?' + q : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
  }, 120);
}

export function shareUrl(path = location.pathname) {
  return location.origin + path + '?' + encodeState();
}
