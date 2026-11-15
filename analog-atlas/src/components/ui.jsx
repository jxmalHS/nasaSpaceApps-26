import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, X, HelpCircle, AlertTriangle, Trophy } from 'lucide-react';
import { F } from '../lib/catalog.js';
import { fmt, isNum } from '../lib/format.js';
import { STATUS } from '../lib/scoring.js';

/** Brand mark: Earth (blue disc) meeting its target world (red ring) on one axis. */
/** Analog Atlas logo: Earth matched against a target world (public/logo.png, transparent background). */
export function Mark({ size = 30 }) {
  return <img src={`${import.meta.env.BASE_URL}logo.png`} height={size} width={Math.round(size * 1.114)} alt="" aria-hidden="true" style={{ display: 'block' }} />;
}

/** Plain-language tooltip on a technical term. Hover or keyboard focus. */
export function Term({ id, children, text }) {
  const tip = text || F[id]?.tip;
  return tip ? <span className="term" tabIndex={0} data-tooltip={tip}>{children}</span> : children;
}

/** Status is always icon + word + colour, never colour alone. */
export function Status({ kind, children, size = 13 }) {
  const map = {
    met: [Check, 'Met'], notmet: [X, 'Not met'], unknown: [HelpCircle, 'Unknown'], warn: [AlertTriangle, 'Warning'],
    beats: [Trophy, 'Beats baseline'], pass: [Check, 'Passes'], fail: [X, 'Fails'],
  };
  const [Icon, word] = map[kind] || [HelpCircle, kind];
  const cls = kind === 'pass' ? 'met' : kind === 'fail' ? 'notmet' : kind;
  return <span className={'status ' + cls}><Icon size={size} strokeWidth={2.4} aria-hidden="true" />{children ?? word}</span>;
}

export function SiteStatus({ status, warn }) {
  if (status === STATUS.FAIL) return <Status kind="fail">Fails a requirement</Status>;
  if (status === STATUS.UNKNOWN) return <Status kind="unknown">Unverified</Status>;
  if (warn) return <Status kind="warn">{warn} warning{warn > 1 ? 's' : ''}</Status>;
  return <Status kind="pass">Passes</Status>;
}

/**
 * Real-unit bullet: Earth's range (blue band), the Earth site (blue dot), the target (red tick),
 * an optional baseline (white ring). If the target sits beyond Earth's range, the axis stretches
 * to include it and the gap is labelled.
 */
export function Bullet({ fid, x, t, b, min, max, label }) {
  const vals = [min, max, x, t, b].filter(isNum);
  if (!vals.length) return <div className="bullet" role="img" aria-label="No data"><div className="unk" /></div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.04;
  lo -= pad; hi += pad;
  const p = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const desc = `${F[fid]?.label}: Earth site ${fmt(x, fid)}, target ${fmt(t, fid)}${isNum(b) ? `, baseline ${fmt(b, fid)}` : ''}`;
  return (
    <div className="bullet" role="img" aria-label={label || desc}>
      <div className="axis" />
      {isNum(min) && isNum(max) && <div className="earth-range" style={{ left: p(min), width: `calc(${p(max)} - ${p(min)})` }} tabIndex={0} data-tooltip="Range found on Earth" />}
      {isNum(b) && <div className="mk b" style={{ left: p(b) }} tabIndex={0} data-tooltip={`Baseline ${fmt(b, fid)}`} />}
      {isNum(t) && <div className="mk t" style={{ left: p(t) }} tabIndex={0} data-tooltip={`Target ${fmt(t, fid)}`} />}
      {isNum(x) ? <div className="mk e" style={{ left: p(x) }} tabIndex={0} data-tooltip={`Earth site ${fmt(x, fid)}`} /> : <div className="unk" />}
    </div>
  );
}

export function ScoreBar({ v, ml }) {
  return <div className={'sbar' + (ml ? ' ml' : '')} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, v || 0)) * 100}%` }} /></div>;
}

/* ---------- tiny toast ---------- */
let toasts = [], tl = new Set();
export function toast(msg) {
  const id = Math.random();
  toasts = [...toasts, { id, msg }]; tl.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); tl.forEach((f) => f()); }, 2600);
}
export function Toaster() {
  const list = useSyncExternalStore((f) => { tl.add(f); return () => tl.delete(f); }, () => toasts);
  return <div className="toast-wrap" role="status" aria-live="polite">{list.map((t) => <div className="toast" key={t.id}><Check size={15} />{t.msg}</div>)}</div>;
}

export function useMedia(q) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');
