import { useState } from 'react';
import { PlaneLanding, Box, ChevronDown, RotateCcw, Plus, Trash2, Car, Shirt, Pickaxe, Home as HomeIcon, Microscope, Lock, Unlock, SlidersHorizontal, Filter } from 'lucide-react';
import { systems, tests, targets, T, F, features, baseRole } from '../lib/catalog.js';
import { useStore, setState, selectTest, selectTarget, resetDefaults } from '../lib/store.js';
import { useResult } from '../lib/results.js';
import { fmt } from '../lib/format.js';
import { Term } from './ui.jsx';

const ICONS = { ltv: Car, eva: Shirt, isru: Pickaxe, hab: HomeIcon, sci: Microscope, land: PlaneLanding };

/**
 * Mission first, then nothing else unless asked. Two choices are required (where, and what
 * hardware); everything else has a sensible default and lives behind a disclosure.
 */
export default function MissionPanel() {
  return (
    <div className="mission">
      <TargetPicker />
      <TestPicker />
      <Summary />
      <Disclosure id="adv-weights" icon={SlidersHorizontal} title="Adjust weights & limits" hint="Optional: defaults are already set for this test" tour="weights"><Weights /></Disclosure>
      <Disclosure id="adv-more" icon={Filter} title="More options" hint="Region, evidence, ranking source, extra requirements"><Filters /><Requirements /></Disclosure>
    </div>
  );
}

function Section({ id, step, title, children, tour }) {
  return (
    <section className="m-sec" aria-labelledby={id} data-tour={tour}>
      <h2 id={id} className="m-step"><span className="m-step-n" aria-hidden="true">{step}</span>{title}</h2>
      {children}
    </section>
  );
}

function Disclosure({ id, icon: I, title, hint, children, tour }) {
  const open = useStore((s) => s.openPanels?.includes(id));
  const toggle = () => setState((s) => ({ openPanels: open ? (s.openPanels || []).filter((x) => x !== id) : [...(s.openPanels || []), id] }));
  return (
    <section className={'m-disc' + (open ? ' open' : '')} data-tour={tour}>
      <button className="m-disc-h" aria-expanded={!!open} aria-controls={id} onClick={toggle}>
        <I size={15} aria-hidden="true" /><span className="grow">{title}</span>
        <ChevronDown size={15} className="chev" aria-hidden="true" />
      </button>
      {!open && hint && <p className="tiny faint m-hint">{hint}</p>}
      {open && <div id={id} className="m-disc-b">{children}</div>}
    </section>
  );
}

function TargetPicker() {
  const targetId = useStore((s) => s.targetId);
  const tg = T[targetId];
  return (
    <Section id="m-target" step="1" title="Where will it go?" tour="target">
      <div className="seg full" role="radiogroup" aria-label="World">
        {['moon', 'mars'].map((b) => (
          <button key={b} role="radio" aria-checked={tg.body === b} onClick={() => selectTarget(targets.find((t) => t.body === b).id)}>
            <i className={'dot ' + b} aria-hidden="true" /> {b === 'moon' ? 'Moon' : 'Mars'}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="sr-only">Target site on {tg.body === 'moon' ? 'the Moon' : 'Mars'}</span>
        <select className="select" value={targetId} onChange={(e) => selectTarget(e.target.value)}>
          {targets.filter((t) => t.body === tg.body).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
    </Section>
  );
}

function TestPicker() {
  const testId = useStore((s) => s.testId);
  const body = useStore((s) => T[s.targetId].body);
  const [open, setOpen] = useState(() => tests[testId].system);
  return (
    <Section id="m-test" step="2" title="What are you testing?" tour="test">
      <div className="checklist">
        {systems.map((s) => {
          const I = ICONS[s.id] || Box;
          const isOpen = open === s.id;
          const active = tests[testId].system === s.id;
          return (
            <div key={s.id} className={'sys' + (isOpen ? ' open' : '') + (active ? ' active' : '')}>
              <button className="sys-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                <I size={16} aria-hidden="true" /><span className="grow">{s.label}</span>
                {!isOpen && active && <span className="tiny earth-c ellipsis sys-cur">{tests[testId].label}</span>}
                <ChevronDown size={15} className="chev" aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="sys-tests" role="radiogroup" aria-label={`${s.label} tests`}>
                  {s.tests.map((t) => {
                    const ok = t.bodies.includes(body);
                    return (
                      <button key={t.id} role="radio" aria-checked={t.id === testId} disabled={!ok} className="test-opt"
                        onClick={() => selectTest(t.id)} title={ok ? t.question : `Not applicable on ${body === 'moon' ? 'the Moon' : 'Mars'}`}>
                        <span className="radio" aria-hidden="true" />
                        <span className="grow">{t.label}</span>
                        {!ok && <span className="tiny faint">{body === 'moon' ? 'Mars only' : 'Moon only'}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Plain-language summary of what the current test cares about. Answer first. */
function Summary() {
  const testId = useStore((s) => s.testId);
  const weights = useStore((s) => s.weights);
  const roles = useStore((s) => s.roles);
  const thresholds = useStore((s) => s.thresholds);
  const test = tests[testId];
  const role = (fid) => roles[fid] ?? baseRole(test, fid);
  const tgt = Object.keys({ ...test.target, ...roles }).filter((f) => role(f) === 'target');
  const total = tgt.reduce((a, f) => a + (weights[f] ?? test.target[f]?.w ?? 20), 0) || 1;
  const lims = Object.keys({ ...test.interference, ...thresholds }).filter((f) => role(f) === 'interference');
  return (
    <section className="m-summary" aria-label="What this test scores">
      <p className="small">{test.question}</p>
      <div className="sum-row"><span className="tiny faint">Matches on</span>
        <span className="small">{tgt.map((f) => `${F[f].short} ${Math.round(((weights[f] ?? test.target[f]?.w ?? 20) / total) * 100)}%`).join(' · ')}</span></div>
      {lims.length > 0 && <div className="sum-row"><span className="tiny faint">Rules out</span>
        <span className="small">{lims.map((f) => { const t = { ...test.interference[f], ...thresholds[f] }; return `${F[f].short} ${t.op === '<=' ? 'over' : 'under'} ${fmt(t.v, f)}`; }).join(' · ')}</span></div>}
    </section>
  );
}

function Weights() {
  const testId = useStore((s) => s.testId);
  const targetId = useStore((s) => s.targetId);
  const weights = useStore((s) => s.weights);
  const roles = useStore((s) => s.roles);
  const thresholds = useStore((s) => s.thresholds);
  const mode = useStore((s) => s.mode);
  const custom = Object.keys(weights).length + Object.keys(roles).length + Object.keys(thresholds).length > 0;
  const test = tests[testId];
  const tg = T[targetId];
  const role = (fid) => roles[fid] ?? baseRole(test, fid);
  const active = [...new Set([...Object.keys(test.target), ...Object.keys(test.interference), ...Object.keys(roles)])].filter((f) => role(f) !== 'ignore');
  const ignored = features.map((f) => f.id).filter((f) => !active.includes(f));
  const [showIgnored, setShowIgnored] = useState(false);
  const totalW = active.filter((f) => role(f) === 'target').reduce((a, f) => a + (weights[f] ?? test.target[f]?.w ?? 20), 0);

  const row = (fid) => {
    const f = F[fid];
    const r = role(fid);
    const spec = test.target[fid];
    const w = weights[fid] ?? spec?.w ?? 20;
    const th = { ...(test.interference[fid] || { op: '<=', v: 0, hard: false }), ...(thresholds[fid] || {}) };
    const why = spec?.why || test.interference[fid]?.why || test.ignore?.[fid];
    const tv = tg.f[fid]?.v;
    return (
      <div key={fid} className={'w-row role-' + r}>
        <div className="w-top">
          <Term id={fid}><span className="w-name">{f.label}</span></Term>
          {f.pending && <span className="pending-tag" title="No Earth layer yet: always Unknown">no data yet</span>}
        </div>
        <div className="role" role="group" aria-label={`Role of ${f.label}`}>
          {[['target', 'Match'], ['interference', 'Limit'], ['ignore', 'Ignore']].map(([k, l]) => (
            <button key={k} className={'r-' + k} aria-pressed={r === k}
              onClick={() => setState((st) => ({ roles: { ...st.roles, [fid]: k }, ...(k === 'interference' && !test.interference[fid] ? { thresholds: { ...st.thresholds, [fid]: { op: '<=', v: round(tv ?? 0), hard: false, user: true } } } : {}) }))}>{l}</button>
          ))}
        </div>
        {r === 'target' && (
          <>
            <div className="w-ctl">
              <input className="range" type="range" min="0" max="100" step="5" value={w} aria-label={`Importance of ${f.label}`}
                style={{ '--fill': `${w}%`, '--c': 'var(--earth)' }}
                onChange={(e) => setState((st) => ({ weights: { ...st.weights, [fid]: Number(e.target.value) } }))} />
              <span className="num w-val">{totalW ? Math.round((w / totalW) * 100) : 0}%</span>
            </div>
            <div className="tiny faint">Target {tv == null ? <b className="target-c">unknown</b> : <b className="target-c">{fmt(tv, fid)}</b>}{spec?.dir && spec.dir !== 'match' && mode === 'stress' ? ` · ${spec.dir === 'high' ? 'more is fine' : 'less is fine'}` : ''}</div>
          </>
        )}
        {r === 'interference' && (
          <div className="w-ctl">
            <span className="small dim">Keep</span>
            <select className="select sm op" value={th.op} aria-label={`Comparison for ${f.label}`} onChange={(e) => setState((st) => ({ thresholds: { ...st.thresholds, [fid]: { ...th, op: e.target.value } } }))}>
              <option value="<=">≤</option><option value=">=">≥</option>
            </select>
            <input className="input num" type="number" step="any" value={th.v} aria-label={`Limit for ${f.label} in ${f.unit}`}
              onChange={(e) => setState((st) => ({ thresholds: { ...st.thresholds, [fid]: { ...th, v: Number(e.target.value) } } }))} />
            <span className="small dim">{f.unit}</span>
            <button className={'btn btn-sm hard-btn' + (th.hard ? ' on' : '')} aria-pressed={!!th.hard}
              onClick={() => setState((st) => ({ thresholds: { ...st.thresholds, [fid]: { ...th, hard: !th.hard } } }))}
              title={th.hard ? 'Strict: sites that break this are excluded' : 'Soft: sites that break this lose points and get a warning'}>
              {th.hard ? <Lock size={13} aria-hidden="true" /> : <Unlock size={13} aria-hidden="true" />}{th.hard ? 'Strict' : 'Soft'}
            </button>
          </div>
        )}
        {why && <p className="tiny dim why">{why}</p>}
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="row">
        <div className="seg grow" role="radiogroup" aria-label="Scoring mode" style={{ display: 'flex' }}>
          <button role="radio" aria-checked={mode === 'stress'} onClick={() => setState({ mode: 'stress' })} style={{ flex: 1 }}>
            <Term text="Stress test: a site may meet or exceed the target in the direction that stresses hardware (colder, rougher, dustier is fine).">Stress test</Term>
          </button>
          <button role="radio" aria-checked={mode === 'realism'} onClick={() => setState({ mode: 'realism' })} style={{ flex: 1 }}>
            <Term text="Closest match: the site nearest the target value, in either direction.">Closest match</Term>
          </button>
        </div>
        {custom && <button className="btn btn-ghost btn-sm" onClick={resetDefaults}><RotateCcw size={13} aria-hidden="true" /> Reset</button>}
      </div>
      <div className="w-list">{active.map(row)}</div>
      <button className="btn btn-ghost btn-sm" onClick={() => setShowIgnored((v) => !v)} aria-expanded={showIgnored}>
        <Plus size={13} aria-hidden="true" /> {showIgnored ? 'Hide' : 'Show'} {ignored.length} ignored features
      </button>
      {showIgnored && <div className="w-list">{ignored.map(row)}</div>}
    </div>
  );
}

const round = (v) => Math.round(v * 100) / 100;

function Requirements() {
  const thresholds = useStore((x) => x.thresholds);
  const user = Object.entries(thresholds).filter(([, t]) => t.user && !t.off);
  const [fid, setFid] = useState('remote_km');
  const measured = features.filter((f) => !f.pending);
  return (
    <div className="stack m-sub">
      <h3 className="label">Extra strict requirement</h3>
      <p className="tiny dim">For logistics or safety, e.g. at most 300 km from a town.</p>
      {user.map(([k, t]) => (
        <div key={k} className="req">
          <span className="grow small">{F[k].label} {t.op === '<=' ? '≤' : '≥'} <b className="num">{fmt(t.v, k)}</b></span>
          <button className="btn btn-ghost btn-sm icon-btn" aria-label={`Remove ${F[k].label} requirement`}
            onClick={() => setState((st) => { const th = { ...st.thresholds }; delete th[k]; const roles = { ...st.roles }; if (roles[k] === 'interference') delete roles[k]; return { thresholds: th, roles }; })}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ))}
      <div className="row">
        <select className="select grow" value={fid} onChange={(e) => setFid(e.target.value)} aria-label="Feature for a new requirement">
          {measured.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <button className="btn btn-sm" onClick={() => setState((st) => ({
          roles: { ...st.roles, [fid]: 'interference' },
          thresholds: { ...st.thresholds, [fid]: { op: '<=', v: fid === 'remote_km' ? 300 : 0, hard: true, user: true } },
        }))}><Plus size={13} aria-hidden="true" /> Add</button>
      </div>
    </div>
  );
}

function Filters() {
  const f = useStore((s) => s.filters);
  const rankBy = useStore((s) => s.rankBy);
  const summary = useResult((r) => r.summary);
  const mlAvail = useResult((r) => r.data?.mlAvailable);
  const set = (p) => setState((s) => ({ filters: { ...s.filters, ...p } }));
  return (
    <div className="stack m-sub" data-tour="filters">
      <label className="field">
        <span className="small">Region</span>
        <select className="select" value={f.region} onChange={(e) => set({ region: e.target.value })}>
          <option value="all">Whole Earth</option>
          {(summary?.continents || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="small row"><Term text="Share of the matched features that have real Earth data at a site. Below this, a site is Unverified, never a pass.">Minimum evidence</Term><span className="grow" /><b className="num">{Math.round(f.minEvidence * 100)}%</b></span>
        <input className="range" type="range" min="0" max="1" step="0.05" value={f.minEvidence} style={{ '--fill': `${f.minEvidence * 100}%`, '--c': 'var(--text-2)' }}
          onChange={(e) => set({ minEvidence: Number(e.target.value) })} aria-label="Minimum evidence" />
      </label>
      <label className="check"><input type="checkbox" checked={f.includeUnknown} onChange={(e) => set({ includeUnknown: e.target.checked })} /> Show unverified sites</label>
      <label className="check"><input type="checkbox" checked={f.beatsBaseline} onChange={(e) => set({ beatsBaseline: e.target.checked })} /> Only sites that beat NASA’s usual site</label>
      <div className="field">
        <span className="small"><Term text="Rules: the transparent scoring you control. Model: the trained ranker. Blend: the average. Strict requirements always come from the rules.">Rank by</Term></span>
        <div className="seg full" role="radiogroup" aria-label="Rank by">
          {[['rules', 'Rules'], ['ml', 'Model'], ['blend', 'Blend']].map(([k, l]) => (
            <button key={k} role="radio" aria-checked={rankBy === k} disabled={k !== 'rules' && !mlAvail} onClick={() => setState({ rankBy: k })}>{l}</button>
          ))}
        </div>
        <span className="tiny faint">{summary?.ml?.model ? `${summary.ml.model.name}${summary.ml.model.demo ? ' (demo)' : ''}` : summary?.ml?.reason || ''}</span>
      </div>
    </div>
  );
}
