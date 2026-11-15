import { useEffect, useSyncExternalStore } from 'react';
import { useStore, scoringConfig, getState } from './store.js';
import { scoreLatest, ready } from './engine.js';

/** Shared scoring result: one worker run per configuration change, consumed by map, list and panels. */
let R = { status: 'idle', data: null, error: null, summary: null };
const ls = new Set();
const set = (p) => { R = { ...R, ...p }; ls.forEach((f) => f()); };
export const useResult = (sel = (r) => r) => useSyncExternalStore((f) => { ls.add(f); return () => ls.delete(f); }, () => sel(R));
export const getResult = () => R;

/**
 * Throttled scoring: at most one worker run every 180 ms while sliders move, plus a final run
 * when they stop. Keeps the main thread free so dragging stays smooth on slow laptops.
 */
let timer = 0, lastRun = 0;
async function runNow() {
  lastRun = performance.now();
  set({ status: R.data ? 'updating' : 'loading' });
  try {
    const data = await scoreLatest(scoringConfig(getState()));
    if (data) set({ status: 'ready', data, error: null });
  } catch (e) { set({ status: 'error', error: e.message }); }
}
export function useScoring() {
  const key = useStore((s) => JSON.stringify(scoringConfig(s)));
  useEffect(() => {
    if (!R.summary) ready().then((summary) => set({ summary })).catch((e) => set({ status: 'error', error: e.message }));
  }, []);
  useEffect(() => {
    clearTimeout(timer);
    const since = performance.now() - lastRun;
    timer = setTimeout(runNow, since > 180 ? 0 : 180 - since);
  }, [key]);
}
