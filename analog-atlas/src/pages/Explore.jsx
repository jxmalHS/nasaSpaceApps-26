import EarthLayerSelect from '../components/EarthLayerSelect.jsx';
import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, ListOrdered } from 'lucide-react';
import { T, targets, F, features, tests } from '../lib/catalog.js';
import { useStore, setState, scoringConfig, getState } from '../lib/store.js';
import { useScoring, useResult } from '../lib/results.js';
import { call } from '../lib/engine.js';
import { cellLatLon } from '../lib/geo.js';
import { fmt } from '../lib/format.js';
import EarthMap from '../components/EarthMap.jsx';
import PlanetGlobe from '../components/PlanetGlobe.jsx';
import MissionPanel from '../components/MissionPanel.jsx';
import Results from '../components/Results.jsx';
import Inspector from '../components/Inspector.jsx';
import { useMedia } from '../components/ui.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { LITE, setLite } from '../lib/perf.js';
import { Feather } from 'lucide-react';

export default function Explore() {
  useScoring();
  const s = {
    sel: useStore((x) => x.sel), layer: useStore((x) => x.layer), view: useStore((x) => x.view),
    targetId: useStore((x) => x.targetId), pins: useStore((x) => x.pins), uploads: useStore((x) => x.uploads),
  };
  const cfgKey = useStore((x) => JSON.stringify(scoringConfig(x)));
  const rows=useStore(st=>st.uploadRows);
  useEffect(()=>{
    if(!rows.length||getState().uploadKey===cfgKey)return;
    let active=true;
    call('scoreSites',{cfg:JSON.parse(cfgKey),sites:rows}).then(uploads=>{
      if(active&&getState().uploadRows===rows&&JSON.stringify(scoringConfig(getState()))===cfgKey)setState({uploads,uploadKey:cfgKey});
    }).catch(()=>{if(active)setState({uploadMessage:'Uploaded sites could not be scored. Re-import the CSV to retry.'})});
    return ()=>{active=false};
  },[cfgKey,rows]);
  const r = useResult((x) => x);
  const mobile = useMedia('(max-width: 1023px)');
  const [sheet, setSheet] = useState('results');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [layerImg, setLayerImg] = useState(null);
  const [fly, setFly] = useState(null);
  const [pinGeo, setPinGeo] = useState([]);
  const tg = T[s.targetId];

  // Selected site → detail (refreshes whenever the configuration changes).
  useEffect(() => {
    let alive = true;
    if (s.sel == null) { setDetail(null); return; }
    setLoadingDetail(true);
    (async () => {
      const i = await call('byId', { id: s.sel });
      if (i < 0) { if (alive) { setDetail(null); setLoadingDetail(false); } return; }
      const d = await call('detail', { cfg: scoringConfig(getState()), i });
      if (alive) { setDetail(d); setLoadingDetail(false); }
    })().catch(() => alive && setLoadingDetail(false));
    return () => { alive = false; };
  }, [s.sel, cfgKey, r.data]);

  // Feature layer for "inspect a dimension".
  useEffect(() => {
    let alive = true;
    if (s.layer === 'mask') { call('mask', { cfg: scoringConfig(getState()) }).then((img) => alive && setLayerImg(img)); return () => { alive = false; }; }
    if (s.layer === 'suit' || !F[s.layer]) { setLayerImg(null); return; }
    call('layer', { fid: s.layer }).then((img) => alive && setLayerImg(img));
    return () => { alive = false; };
  }, [s.layer, r.summary, s.layer === 'mask' ? cfgKey : 0]);

  useEffect(() => {
    setPinGeo(s.pins.map((id) => { const [lat, lon] = cellLatLon(id); return { lat, lon, i: null, name: 'Shortlisted' }; }));
  }, [s.pins.join('.')]);

  const open = async (x) => {
    let id = x.id;
    if (id == null && x.i != null) { const row = (await call('rows', { indices: [x.i] }))[0]; id = row.id; x = { ...x, lat: row.lat, lon: row.lon }; }
    if (id == null) return;
    setState({ sel: id });
    const [lat, lon] = cellLatLon(id);
    setFly({ lat, lon, zoom: 4.2, t: Date.now() });
    if (mobile) setSheet('results');
  };
  const pick = async (p) => {
    if(p.uploadIndex!=null){setState({sel:null,selectedUpload:p.uploadIndex});if(mobile)setSheet('results');return}
    if (p.i != null) return open({ i: p.i });
    const nn = await call('nearest', { lat: p.lat, lon: p.lon });
    if (nn && nn.km < 80) open({ i: nn.i });
  };

  const bodyTargets = useMemo(() => targets.filter((t) => t.body === tg.body), [tg.body]);
  const dimFid = F[s.layer] ? s.layer : null;
  const layerQ = layerImg?.q;

  const earth = (
    <div className="map-wrap side-earth" data-tour="map">
      <div className="map-label"><span className="tag-ab a">A</span> Earth</div>
      <ErrorBoundary><EarthMap key={s.view==='linked'?'linked':'single'} paired={s.view==='linked'} defaultProjection={s.view==='linked'?'globe':undefined} result={r.data} imageryOnly={s.layer === 'imagery'} layerImage={layerImg} sel={s.sel} pins={pinGeo} uploads={s.uploads} onPick={pick} flyTo={fly} /></ErrorBoundary>
      <Legend layer={s.layer} q={layerQ} />
    </div>
  );
  const planet = (
    <div className="map-wrap side-target planet-wrap">
      <div className="map-label"><span className="tag-ab b">B</span> {tg.body === 'moon' ? 'Moon' : 'Mars'}</div>
      <ErrorBoundary><PlanetGlobe body={tg.body} targets={bodyTargets} selected={s.targetId} height="100%"
        onSelect={(id) => setState({ targetId: id, sel: null })}
        valueOf={dimFid ? (t) => fmt(t.f[dimFid]?.v ?? NaN, dimFid) : null} /></ErrorBoundary>
      <div className="planet-note small">
        <b>{tg.name}</b> · {tg.region}
        {dimFid && <div className="dim">{F[dimFid].label}: <b className="target-c">{tg.f[dimFid]?.v == null ? 'unknown' : fmt(tg.f[dimFid].v, dimFid)}</b>{tg.f[dimFid]?.s ? ` (${tg.f[dimFid].s})` : ''}. Target values come from the profile; no global {tg.body} raster is loaded yet.</div>}
      </div>
    </div>
  );

  const toolbar = (
    <div className="view-bar" role="toolbar" aria-label="Map view">
      <div className="seg" role="radiogroup" aria-label="View">
        {[['earth', 'Earth map'], ['split', 'Side by side'],['linked','Linked Earth views'], ['target', tg.body === 'moon' ? 'Moon globe' : 'Mars globe']].map(([k, l]) => (
          <button key={k} role="radio" aria-checked={s.view === k} onClick={() => setState({ view: k })}>{l}</button>
        ))}
      </div>
      <button className="btn btn-sm" aria-pressed={LITE} onClick={() => setLite(!LITE)}
        title={LITE ? 'Lite mode is on: flat map, still homepage. Click to turn it off.' : 'Turn on lite mode for slower computers: flat map, still homepage.'}>
        <Feather size={14} aria-hidden="true" /> Lite {LITE ? 'on' : 'off'}
      </button>
      <div className="row small dim">
        <span>Earth layer</span><EarthLayerSelect />
      </div>
    </div>
  );

  const stage = (
    <div className={'stage view-' + (s.view==='linked'?'split':s.view)}>
      {toolbar}
      <div className="stage-maps">
        {s.view !== 'target' && earth}
        {s.view==='linked'?<div className="map-wrap side-target"><div className="map-label">Earth · flat map</div><ErrorBoundary><EarthMap paired defaultProjection="mercator" result={r.data} imageryOnly={s.layer === 'imagery'} layerImage={layerImg} sel={s.sel} pins={pinGeo} uploads={s.uploads} onPick={pick} flyTo={fly}/></ErrorBoundary></div>:s.view !== 'earth' && planet}
      </div>
    </div>
  );

  const [welcome, setWelcome] = useState(() => { try { return !localStorage.getItem('aa-welcomed'); } catch { return false; } });
  const closeWelcome = () => { setWelcome(false); try { localStorage.setItem('aa-welcomed', '1'); } catch { /* ignore */ } };
  const welcomeBox = welcome && (
    <div className="welcome" role="note">
      <b>New here?</b> <span className="dim small">Pick where your hardware goes and what you are testing. Results update on their own.</span>
      <div className="row"><button className="btn btn-primary btn-sm" onClick={() => { closeWelcome(); setState({ tourStep: 0 }); }}>Show me (4 steps)</button>
        <button className="btn btn-ghost btn-sm" onClick={closeWelcome}>Dismiss</button></div>
    </div>
  );
  const right = s.sel != null
    ? <Inspector d={detail} loading={loadingDetail} onBack={() => setState({ sel: null })} />
    : <>{welcomeBox}<Results onOpen={open} /></>;

  if (mobile) {
    return (
      <main id="main" className="explore mobile">
        {stage}
        <div className="sheet">
          <div className="seg full sheet-tabs" role="tablist" aria-label="Panels">
            <button role="tab" aria-selected={sheet === 'mission'} aria-pressed={sheet === 'mission'} onClick={() => setSheet('mission')}><SlidersHorizontal size={14} /> Mission</button>
            <button role="tab" aria-selected={sheet === 'results'} aria-pressed={sheet === 'results'} onClick={() => setSheet('results')}><ListOrdered size={14} /> Results</button>
          </div>
          <div className="sheet-body" role="tabpanel">{sheet === 'mission' ? <MissionPanel /> : right}</div>
        </div>
      </main>
    );
  }
  return (
    <main id="main" className="explore">
      <aside className="col-left" aria-label="Mission configuration"><MissionPanel /></aside>
      {stage}
      <aside className="col-right" aria-label="Results">{right}</aside>
    </main>
  );
}

function Legend({ layer, q }) {
  if (layer === 'imagery') return null;
  if (layer === 'mask') {
    return (
      <div className="legend">
        <div className="tiny faint">Strict limits for this test</div>
        <div className="row tiny"><span className="sw" style={{ background: 'rgba(76,141,255,0.8)' }} /> Passes all <span className="sw" style={{ background: 'rgba(252,61,33,0.45)' }} /> Fails one <span className="hatch-swatch" /> Unknown</div>
      </div>
    );
  }
  if (layer === 'suit') {
    return (
      <div className="legend">
        <div className="tiny faint">Suitability rank among passing cells</div>
        <div className="legend-ramp" />
        <div className="row tiny faint"><span>lower</span><span className="grow" /><span>top 1%</span></div>
        <div className="row tiny faint"><span className="hatch-swatch" /> Unverified <span className="fail-swatch" /> Fails a limit <span className="site-swatch" /> NASA field site</div>
      </div>
    );
  }
  const f = F[layer];
  return (
    <div className="legend">
      <div className="tiny faint">{f.label} · Earth percentile</div>
      <div className="legend-ramp" />
      <div className="row tiny faint num"><span>{q ? fmt(q[0], layer) : ''}</span><span className="grow" style={{ textAlign: 'center' }}>{q ? fmt(q[50], layer) : ''}</span><span>{q ? fmt(q[100], layer) : ''}</span></div>
      <div className="tiny faint">{f.source}</div>
    </div>
  );
}
