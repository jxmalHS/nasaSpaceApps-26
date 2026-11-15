import GlobePair from '../components/GlobePair.jsx';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Repeat, Box, Sun, ArrowLeft } from 'lucide-react';
import { T, F, targets, tests } from '../lib/catalog.js';
import { useStore, setState, scoringConfig, getState } from '../lib/store.js';
import { useScoring, useResult } from '../lib/results.js';
import { call } from '../lib/engine.js';
import { go } from '../lib/router.jsx';
import { loadPatch, sharedDomain, renderPatch, profile, slopeAt, hashStr, PATCH_M, aspectAt, localRms, compass } from '../lib/patch.js';
import { fmt, fmtDiff, latlon } from '../lib/format.js';
import { toCsv, download } from '../lib/csv.js';
import { Term, Bullet, useReducedMotion } from '../components/ui.jsx';
import Relief3D from '../components/Relief3D.jsx';

import SiteEvidence from '../components/SiteEvidence.jsx';



export default function Compare() {
  useScoring();
  const s = useStore((x) => x);
  const r = useResult((x) => x);
  const tg = T[s.targetId];
  const reduced = useReducedMotion();
  const [earth, setEarth] = useState(null);
  const [pa, setPa] = useState(null);
  const [pb, setPb] = useState(null);
  const [hover, setHover] = useState(null);
  const line=s.profileLine, setLine=value=>setState(st=>({profileLine:typeof value==="function"?value(st.profileLine):value}));
  const flick=s.flick, setFlick=value=>setState(st=>({flick:typeof value==="function"?value(st.flick):value}));
  const flickSide=s.flickSide,setFlickSide=fn=>setState(st=>({flickSide:fn(st.flickSide)}));
  const show3d=s.relief, setShow3d=value=>setState(st=>({relief:typeof value==="function"?value(st.relief):value}));
  const layer=s.patchLayer, setLayer=patchLayer=>setState({patchLayer});
  const globes=s.globePair,setGlobes=globePair=>setState({globePair});
  const sun=s.sun, setSun=value=>setState(st=>({sun:typeof value==="function"?value(st.sun):value}));
  const exag=s.exaggeration, setExag=value=>setState(st=>({exaggeration:typeof value==="function"?value(st.exaggeration):value}));

  const earthId = s.compareId ?? s.sel ?? r.data?.list?.[0]?.id ?? null;

  useEffect(() => {
    setEarth(null);setPa(null);
    if (earthId == null) return;
    let alive = true;
    (async () => {
      const i = await call('byId', { id: earthId });
      if (i < 0) return;
      const d = await call('detail', { cfg: scoringConfig(getState()), i });
      if (!alive) return;
      setEarth(d);
      const patch=await loadPatch({ body: 'earth', key: String(d.id), seed: d.id, slopeDeg: d.values.slope_deg, roughM: d.values.rough_m });
      if(alive)setPa(patch);
    })();
    return () => { alive = false; };
  }, [earthId, r.data]);

  useEffect(() => {
    let alive=true;setPb(null);
    loadPatch({ body: tg.body, key: tg.id, seed: hashStr(tg.id), slopeDeg: tg.f.slope_deg?.v, roughM: tg.f.rough_m?.v }).then(p=>{if(alive)setPb(p)});
    return ()=>{alive=false};
  }, [tg.id]);

  // Flicker: alternate A/B at the same frame. Manual (space/button) when reduced motion is on.
  useEffect(() => {
    if (!flick || reduced) return;
    const t = setInterval(() => setFlickSide((v) => 1 - v), 750);
    return () => clearInterval(t);
  }, [flick, reduced]);
  useEffect(() => {
    if (!flick) return;
    const k = (e) => { if (e.code === 'Space' && !/input|select|textarea|button/i.test(e.target.tagName)) { e.preventDefault(); setFlickSide((v) => 1 - v); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [flick]);

  const domain = useMemo(() => (pa && pb ? sharedDomain(pa, pb) : [-1, 1]), [pa, pb]);
  const options = useMemo(() => {
    const o = new Map();
    for (const x of r.data?.list?.slice(0, 12) || []) o.set(x.id, `#${x.rank} · Near ${x.place || '—'}, ${x.country}`);
    if (earth && !o.has(earth.id)) o.set(earth.id, `Near ${earth.place}, ${earth.country}`);
    return [...o];
  }, [r.data, earth]);

  const exportCsv = () => {
    const rows = [['Mean slope', 'slopeMean', '°'], ['90th pct slope', 'slopeP90', '°'], ['RMS roughness (detrended)', 'rms', 'm'], ['Relief (2–98%)', 'relief', 'm'], ['Share steeper than 15°', 'steepShare', '']]
      .map(([label, k, u]) => ({ metric: label, unit: u, earth_A: pa?.stats[k]?.toFixed(3), target_B: pb?.stats[k]?.toFixed(3), A_source: pa?.source, B_source: pb?.source }));
    download(`patch-${earth?.id}-vs-${tg.id}.csv`, toCsv(['metric', 'unit', 'earth_A', 'target_B', 'A_source', 'B_source'], rows));
  };

  const prof = pa && pb ? [profile(pa, line[0], line[1]), profile(pb, line[0], line[1])] : null;
  const panels = [
    { side: 0, p: pa, title: earth ? `Near ${earth.place}, ${earth.country}` : 'Loading…', sub: earth ? latlon(earth.lat, earth.lon) : '', cls: 'a' },
    { side: 1, p: pb, title: tg.name, sub: `${tg.region} · ${tg.body === 'moon' ? 'Moon' : 'Mars'}`, cls: 'b' },
  ];
  const visible = flick ? [panels[flickSide]] : panels;

  return (
    <main id="main" className="compare">
      <div className="cmp-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => go('/explore')}><ArrowLeft size={14} /> Explore</button>
        <label className="row small"><span className="tag-ab a">A</span>
          <select className="select sm" value={earthId ?? ''} onChange={(e) => setState({ compareId: Number(e.target.value) })} aria-label="Earth site (A)">
            {options.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </label>
        <label className="row small"><span className="tag-ab b">B</span>
          <select className="select sm" value={tg.id} onChange={(e) => setState({ targetId: e.target.value })} aria-label="Target site (B)">
            {targets.filter((t) => tests[s.testId].bodies.includes(t.body)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Dimension <select className="select sm" value={layer} onChange={e=>setLayer(e.target.value)}><option value="height">Relative height (m)</option><option value="slope">Slope (0–90°)</option></select></label><span className="grow" />
        <button className={'btn btn-sm'} aria-pressed={flick} onClick={() => setFlick((v) => !v)} title="Show A and B alternately in the same frame (Space to switch)"><Repeat size={14} /> Flicker</button>
        <button className="btn btn-sm" aria-pressed={show3d} onClick={() => setShow3d((v) => !v)}><Box size={14} /> 3D</button>
        <label className="row small" title="Sun elevation for the hillshade. Drop it to see the lunar south pole’s grazing light.">
          <Sun size={14} aria-hidden="true" /><span className="hide-sm">Sun</span>
          <input className="range" style={{ width: 90, '--fill': `${((sun - 2) / 58) * 100}%`, '--c': 'var(--warn)' }} type="range" min="2" max="60" value={sun} onChange={(e) => setSun(Number(e.target.value))} aria-label="Sun elevation" />
          <span className="num">{sun}°</span>
        </label>
        <button className="btn btn-sm" onClick={exportCsv} disabled={!pa || !pb}><Download size={14} /> Patch CSV</button>
      </div>

      <div className="cmp-body">
        <div className="cmp-stage">
          <SiteEvidence earth={earth?.id===earthId?earth:null} target={tg} state={s}
            viewerControl={<button className="btn btn-sm" aria-expanded={globes} onClick={()=>setGlobes(!globes)}>{globes?'Close':'Open'} linked planetary viewers</button>}
            viewer={globes&&<GlobePair earth={earth?.id===earthId?earth:null} target={tg}/>}/>
          <h2 className="terrain-heading">Matched terrain patches</h2>
          <p className="small dim">Both patches are {PATCH_M / 1000} × {PATCH_M / 1000} km, north up, sampled the same way, on one colour scale: {layer==="slope"?"slope from 0° to 90°":"height relative to each patch mean (±"+fmt(domain[1],"rough_m")+")"}. Drag across either patch to draw the profile line.</p>
          <div className={'cmp-pair' + (flick ? ' flicker' : '')}>
            {visible.map((v) => (
              <PatchView key={flick ? 'f' : v.side} {...v} domain={domain} layer={layer} sun={sun} hover={hover} setHover={setHover} line={line} setLine={setLine} exag={1} />
            ))}
          </div>
          <Readout hover={hover} pa={pa} pb={pb} earthElev={earth?.values?.elev_m} />
          {prof && <Profile a={prof[0]} b={prof[1]} body={tg.body} length={PATCH_M*Math.hypot(line[1][0]-line[0][0],line[1][1]-line[0][1])} />}
          {show3d && pa && pb && (
            <div className="stack">
              <div className="row small"><span className="dim">Vertical exaggeration (same for both)</span>
                <input className="range" style={{ width: 140, '--fill': `${((exag - 1) / 4) * 100}%` }} type="range" min="1" max="5" step="0.5" value={exag} onChange={(e) => setExag(Number(e.target.value))} aria-label="Vertical exaggeration" />
                <b className="num">{exag}×</b></div>
              <Relief3D a={pa} b={pb} domain={domain} exaggeration={exag} flicker={flick ? flickSide : null} />
            </div>
          )}
        </div>
        <aside className="cmp-side" aria-label="Comparison numbers">
          <section>
            <h2 className="terrain-heading">Terrain measurements</h2><p className="small dim">2 × 2 km at each location</p>
            <table className="stats-t">
              <thead><tr><th scope="col">Metric</th><th scope="col" className="earth-c">A · Earth<small>{pa?.synthetic?"Illustrative":pa?"Measured":"Loading"}</small></th><th scope="col" className="target-c">B · {tg.body==="moon"?"Moon":"Mars"}<small>{pb?.synthetic?"Illustrative":pb?"Measured":"Loading"}</small></th></tr></thead>
              <tbody>
                {[['Mean slope', 'slopeMean', 'slope_deg'], ['Slope, 90th pct', 'slopeP90', 'slope_deg'], ['RMS roughness', 'rms', 'rough_m'], ['Relief', 'relief', 'rough_m']].map(([l, k, fid]) => (
                  <tr key={k}><td>{l}</td><td className="num">{fmt(pa?.stats[k], fid, { dp: 1 })}</td><td className="num">{fmt(pb?.stats[k], fid, { dp: 1 })}</td></tr>
                ))}
              </tbody>
            </table>
            {(pa?.synthetic || pb?.synthetic) && <p className="tiny" style={{ color: 'var(--warn)', marginTop: 8 }}>Illustrative terrain · Values marked illustrative are calculated from a surface generated using regional slope and roughness.</p>}
          </section>
          {earth && (
            <button className="btn btn-sm" onClick={() => { setState({ sel: earth.id }); go('/report'); }}>Open the site report</button>
          )}
        </aside>
      </div>
    </main>
  );
}

function PatchView({ side, p, title, sub, cls, domain, layer, sun, hover, setHover, line, setLine }) {
  const canvas = useRef(null);
  const drag = useRef(null);
  useEffect(() => { if (p) renderPatch(canvas.current, p, domain, { sunAlt: sun, layer }); }, [p, domain, sun, layer]);
  const pos = (e) => { const b = e.currentTarget.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
  return (
    <div className={'patch side-' + (cls === 'a' ? 'earth' : 'target')}>
      <div className="patch-h"><span className={'tag-ab ' + cls}>{cls.toUpperCase()}</span><span className="grow ellipsis">{title}</span><span className="tiny faint">{sub}</span></div>
      <div className="patch-canvas" tabIndex={0} role="group" aria-label={title+". Arrow keys inspect terrain. Shift and arrows move the end of the elevation profile."} onKeyDown={e=>{
          const move={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]}[e.key];if(!move)return;e.preventDefault();
          const pos=e.shiftKey?line[1]:(hover||[.5,.5]);const next=pos.map((v,i)=>Math.max(0,Math.min(1,v+move[i])));setHover(next);if(e.shiftKey)setLine([line[0],next]);
        }}
        onPointerDown={(e) => { drag.current = pos(e); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const q = pos(e); setHover(q); if (drag.current && Math.hypot(q[0] - drag.current[0], q[1] - drag.current[1]) > 0.03) setLine([drag.current, q]); }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => setHover(null)}>
        <canvas ref={canvas} role="img" aria-label={`${cls === 'a' ? 'Earth' : 'Target'} terrain patch, ${title}`} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1={line[0][0] * 100} y1={line[0][1] * 100} x2={line[1][0] * 100} y2={line[1][1] * 100} stroke={cls === 'a' ? '#9cc2ff' : '#ff8a73'} strokeWidth="0.6" vectorEffect="non-scaling-stroke" strokeDasharray="2 1.5" />
          {hover && <><line x1={hover[0] * 100} x2={hover[0] * 100} y1="0" y2="100" stroke="#fff" strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke" /><line y1={hover[1] * 100} y2={hover[1] * 100} x1="0" x2="100" stroke="#fff" strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke" /></>}
        </svg>
        <div className="scale-bar"><i /><span>500 m</span></div>
        {p?.synthetic && <span className="synth-note">illustrative</span>}
      </div>
    </div>
  );
}

function Readout({ hover, pa, pb, earthElev }) {
  if (!pa || !pb) return null;
  const at = (p) => {
    if (!hover) return null;
    const x = Math.round(hover[0] * (p.n - 1)), y = Math.round(hover[1] * (p.n - 1));
    const asp = aspectAt(p, x, y);
    return { h: p.z[y * p.n + x] - p.stats.mean, s: slopeAt(p, x, y), a: asp, r: localRms(p, x, y) };
  };
  const a = at(pa), b = at(pb);
  const rows = [
    ['Height vs patch mean', (v) => fmtDiff(v.h, 'rough_m')],
    ['Local slope', (v) => fmt(v.s, 'slope_deg')],
    ['Faces (downhill)', (v) => (Number.isNaN(v.a) ? 'flat' : `${compass(v.a)} · ${Math.round(v.a)}°`)],
    ['Roughness, 80 m window', (v) => fmt(v.r, 'rough_m', { dp: 1 })],
  ];
  return (
    <div className="readout" aria-live="off">
      <span className="h">{hover ? `Point ${Math.round(hover[0] * PATCH_M)} m E · ${Math.round(hover[1] * PATCH_M)} m S of the NW corner` : 'Hover a patch to read both sides at the same point'}</span>
      <span className="h earth-c">A · Earth</span><span className="h target-c">B · Target</span>
      {rows.map(([l, f]) => (
        <Fragment key={l}><span className="dim">{l}</span><span className="num">{a ? f(a) : '—'}</span><span className="num">{b ? f(b) : '—'}</span></Fragment>
      ))}
      {earthElev != null && <><span className="dim">Elevation (A)</span><span className="num">{a ? fmt(earthElev + a.h, 'elev_m') : fmt(earthElev, 'elev_m') + ' mean'}</span><span className="num faint">not comparable</span></>}
    </div>
  );
}

function Profile({ a, b, body, length }) {
  const all = [...a, ...b];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
  const W = 600, H = 160, P = 42;
  const path = (arr) => arr.map((v, k) => `${k ? 'L' : 'M'}${P + (k / (arr.length - 1)) * (W - P - 6)},${6 + (1 - (v - lo) / (hi - lo)) * (H - 36)}`).join('');
  return (
    <figure className="profile panel" style={{ margin: 0, padding: 12 }}>
      <figcaption className="row small"><b>Elevation profile</b><span className="dim">Height change from start (m)</span><span className="grow" />
        <span className="row tiny"><i style={{ width: 14, height: 2, background: 'var(--earth-2)', display: 'inline-block' }} /> A · Earth</span>
        <span className="row tiny"><i style={{ width: 14, height: 2, borderTop: '2px dashed var(--target-2)', display: 'inline-block' }} /> B · {body==='moon'?'Moon':'Mars'}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Profile: A spans ${fmt(Math.max(...a) - Math.min(...a), 'rough_m')}, B spans ${fmt(Math.max(...b) - Math.min(...b), 'rough_m')}`}>
        {[lo, (lo + hi) / 2, hi].map((v, k) => {
          const y = 6 + (1 - (v - lo) / (hi - lo)) * (H - 36);
          return <g key={k}><line x1={P} x2={W - 6} y1={y} y2={y} stroke="rgba(160,188,255,0.12)" /><text x={P - 4} y={y + 3} fontSize="12" textAnchor="end" fill="#8795b1">{Math.round(v)}</text></g>;
        })}
        <text x={P} y={H-4} fontSize="12" fill="#b3c0d8">0 m</text><text x={W/2} y={H-4} fontSize="12" textAnchor="middle" fill="#b3c0d8">Distance along profile</text><text x={W-6} y={H-4} fontSize="12" textAnchor="end" fill="#b3c0d8">{Math.round(length)} m</text>
        <path d={path(a)} fill="none" stroke="#9cc2ff" strokeWidth="2" />
        <path d={path(b)} fill="none" stroke="#ff8a73" strokeDasharray="6 3" strokeWidth="2" />
      </svg>
    </figure>
  );
}
