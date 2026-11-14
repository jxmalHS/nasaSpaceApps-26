import { useEffect, useLayoutEffect, useState } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import { useStore, setState, selectTest, getState } from '../lib/store.js';
import { getResult } from '../lib/results.js';
import { useReducedMotion } from './ui.jsx';

/**
 * Four steps that operate the real interface: each step performs the action it explains,
 * then spotlights the result. Escape closes; arrow keys move.
 */
const STEPS = [
  { sel: '[data-tour="test"]', title: 'Start from the hardware', body: 'Pick the system, then the specific test. We just chose rover wheel traction for the lunar south pole.',
    run: () => { selectTest('ltv.wheels'); setState({ targetId: 'mons-mouton-plateau', view: 'earth', sel: null }); } },
  { sel: '[data-tour="weights"]', title: 'Defaults you can override', body: 'Defaults are already set. Open this panel only if you want to: each feature is matched, used as a limit, or ignored, with a reason. We raised roughness so bumpy ground counts more.',
    run: () => setState((s) => ({ openPanels: [...new Set([...(s.openPanels || []), 'adv-weights'])], weights: { ...s.weights, rough_m: 55 } })) },
  { sel: '[data-tour="map"]', title: 'Every land cell, scored', body: 'White is the top 1% for this test. Hatching means unverified, never a pass. White rings are NASA’s documented field sites. We opened the best site.',
    run: () => { const l = getResult().data?.list?.[0]; if (l) setState({ sel: l.id }); } },
  { sel: '.col-right, .sheet', title: 'Answer first, evidence on demand', body: 'The verdict comes first, then each condition in real units against the target and NASA’s usual site. From here: compare side by side, or export a report with sources and limits.', run: () => {} },
];

export default function Tour() {
  const step = useStore((s) => s.tourStep);
  const reduced = useReducedMotion();
  const [rect, setRect] = useState(null);
  const st = STEPS[step];

  useEffect(() => { st?.run(); }, [step]);
  useLayoutEffect(() => {
    if (!st) return;
    let raf, n = 0;
    const measure = () => {
      const el = [...document.querySelectorAll(st.sel)].find((e) => e.offsetParent !== null);
      if (el) { el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); const r = el.getBoundingClientRect(); setRect({ x: r.left, y: r.top, w: r.width, h: Math.min(r.height, innerHeight - r.top - 8) }); }
      if (n++ < 20) raf = setTimeout(measure, 120);
    };
    measure();
    return () => clearTimeout(raf);
  }, [step]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') setState({ tourStep: null });
      if (e.key === 'ArrowRight') next(1);
      if (e.key === 'ArrowLeft') next(-1);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [step]);
  if (!st) return null;
  const next = (d) => { const n = getState().tourStep + d; setState({ tourStep: n < 0 ? 0 : n >= STEPS.length ? null : n }); };
  const cardW = Math.min(360, innerWidth - 24);
  let left = 12, top = 80;
  if (rect) {
    left = rect.x + rect.w + 16 + cardW < innerWidth ? rect.x + rect.w + 16 : rect.x - cardW - 16 > 0 ? rect.x - cardW - 16 : Math.max(12, Math.min(innerWidth - cardW - 12, rect.x));
    top = Math.max(70, Math.min(innerHeight - 260, rect.y));
    if (innerWidth < 700) { left = 12; top = innerHeight - 250; }
  }
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="tour-h">
      {rect && <div className="tour-hole" style={{ left: rect.x - 4, top: rect.y - 4, width: rect.w + 8, height: rect.h + 8 }} />}
      <div className="tour-card" style={{ left, top, width: cardW }}>
        <div className="row"><div className="tour-dots" aria-hidden="true">{STEPS.map((_, k) => <i key={k} className={k <= step ? 'on' : ''} />)}</div>
          <span className="tiny faint">Step {step + 1} of {STEPS.length}</span><span className="grow" />
          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => setState({ tourStep: null })} aria-label="Close tour"><X size={15} /></button></div>
        <h2 id="tour-h">{st.title}</h2>
        <p className="small dim" aria-live="polite">{st.body}</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => next(-1)} disabled={step === 0}><ArrowLeft size={14} /> Back</button>
          <span className="grow" />
          <button className="btn btn-primary btn-sm" onClick={() => next(1)} autoFocus>{step === STEPS.length - 1 ? 'Done' : 'Next'} <ArrowRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}
