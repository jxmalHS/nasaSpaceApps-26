/** Main-thread client for the scoring worker. One worker, promise-based RPC, latest-wins for scoring. */
import Worker from './worker.js?worker';

let worker, seq = 0, readyPromise = null;
const pending = new Map();

function ensure() {
  if (worker) return worker;
  worker = new Worker();
  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error));
  };
  return worker;
}

export async function call(type, payload) {
  if (type !== 'init') await ready();
  return send(type, payload);
}

function send(type, payload) {
  ensure();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

export function ready() {
  if (!readyPromise) {
    readyPromise = send('init', { base: import.meta.env.BASE_URL, mlApi: import.meta.env.VITE_ML_API || '' });
    readyPromise.catch(() => { readyPromise = null; });
  }
  return readyPromise;
}

let scoreTicket = 0;
/** Scores with a ticket so slider drags never apply a stale result. */
export async function scoreLatest(cfg) {
  const t = ++scoreTicket;
  await ready();
  const r = await call('score', cfg);
  if (t !== scoreTicket) return null;
  return r;
}
