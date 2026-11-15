import { useSyncExternalStore } from 'react';
import { encodeState, hydrateFromUrl } from './store.js';

const ls = new Set();
const emit = () => ls.forEach((f) => f());
addEventListener('popstate', () => { hydrateFromUrl(); emit(); });

export function usePath() {
  return useSyncExternalStore((f) => { ls.add(f); return () => ls.delete(f); }, () => location.pathname);
}

/** Navigate inside the app, carrying the whole mission state in the query string. */
export function go(path, { keepScroll = false } = {}) {
  const url = path + '?' + encodeState();
  if (url === location.pathname + location.search) return;
  history.pushState(null, '', url);
  emit();
  if (!keepScroll) window.scrollTo(0, 0);
}

export function Link({ to, children, ...rest }) {
  return (
    <a href={to} {...rest} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault(); go(to);
    }}>{children}</a>
  );
}
