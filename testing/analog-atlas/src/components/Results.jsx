import { useEffect, useRef, useState } from 'react';
import { Upload, Download, Activity, Pin, X } from 'lucide-react';
import { tests, F, features } from '../lib/catalog.js';
import { useStore, setState, scoringConfig, getState, togglePin } from '../lib/store.js';
import { useResult } from '../lib/results.js';
import { call } from '../lib/engine.js';
import { parseCsv, toCsv, download } from '../lib/csv.js';
import { latlon, score100, pct } from '../lib/format.js';
import { ScoreBar, SiteStatus, Status, Term, toast } from './ui.jsx';
import { STATUS } from '../lib/scoring.js';

export default function Results({ onOpen }) {
  const r = useResult((x) => x);
  const testId = useStore((s) => s.testId);
  const rankBy = useStore((s) => s.rankBy);
  const sel = useStore((s) => s.sel);
  const filters = useStore((s) => s.filters);
  const uploads = useStore((s) => s.uploads);
  const d = r.data;
  const list = d ? (filters.beatsBaseline ? d.list.filter((x) => x.beatsBaseline) : d.list) : [];
  const listRef = useRef(null);

  const onKey = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const items = [...listRef.current.querySelectorAll('.site-row')];
    const k = items.indexOf(document.activeElement);
    const n = items[Math.max(0, Math.min(items.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) { e.preventDefault(); n.focus(); }
  };

  return (
    <div className="results">
      <div className="res-head" data-tour="results">
        <div>
          <h2 className="res-title">{tests[testId].label}</h2>
          <div className="small dim" aria-live="polite">
            {r.status === 'loading' && 'Loading 78,993 Earth cells…'}
            {d && <>{d.counts[0].toLocaleString()} pass · {d.counts[1].toLocaleString()} unverified · {d.counts[2].toLocaleString()} fail{r.status === 'updating' ? ' · updating' : ''}</>}
            {r.status === 'error' && <span className="target-c">Could not score: {r.error}</span>}
          </div>
        </div>
        <Stability />
      </div>
      {d && <Baseline d={d} onOpen={onOpen} />}
      {d && <Coverage onOpen={onOpen} />}
      {d?.agreement != null && rankBy !== 'rules' && (
        <p className="tiny faint res-agree">
          <Term text="Share of the top five distinct sites that the rules and the model have in common. Agreement is not accuracy: both can be wrong the same way.">Rules–model agreement</Term>: {Math.round(d.agreement * 100)}% of top 5{rankBy !== 'rules' ? ` · ranking by ${rankBy === 'ml' ? 'model' : 'blend'}` : ''}
        </p>
      )}
      {d && rankBy === 'ml' && d.mlSparse && <p className="tiny faint res-agree">The model analysed {d.mlCount.toLocaleString()} cells in detail. Only those that also pass the strict limits are ranked here; the rest are listed below with their status.</p>}
      {d?.mlTop?.length > 0 && <ModelAnalysed rows={d.mlTop} onOpen={onOpen} />}
      <ol className="site-list" ref={listRef} onKeyDown={onKey} aria-label="Ranked Earth sites. Arrow keys move, Enter opens.">
        {!d && r.status !== 'error' && Array.from({ length: 6 }, (_, k) => <li key={k} className="skeleton" style={{ height: 58, margin: '6px 0' }} />)}
        {d && list.length === 0 && <li className="empty">No site passes every strict requirement. Relax a limit, lower the evidence threshold, or show unverified sites.</li>}
        {list.map((x, k) => (
          <li key={x.id}>
            <button className={'site-row' + (sel === x.id ? ' on' : '')} onClick={() => onOpen(x)} aria-current={sel === x.id ? 'true' : undefined}
              aria-label={`Rank ${x.rank}: ${x.place ? 'near ' + x.place + ', ' : ''}${x.country}. Score ${score100(x.score)}.`}>
              <span className="rank num">{k + 1}</span>
              <span className="grow site-main">
                <span className="site-name ellipsis">{x.place ? `Near ${x.place}` : latlon(x.lat, x.lon)}</span>
                <span className="tiny faint ellipsis">{x.country} · {latlon(x.lat, x.lon)}{rankBy === 'blend' && x.mlScored === false ? ' · rules only' : ''}{rankBy !== 'rules' && x.mlScored ? ' · model-analysed' : ''}</span>
                <span className="row site-badges">
                  {x.beatsBaseline ? <Status kind="beats">Beats NASA site</Status> : <SiteStatus status={x.status} warn={x.warn} />}
                </span>
              </span>
              <span className="site-score">
                <b className="num">{score100(x.score)}</b>
                <ScoreBar v={x.score} ml={rankBy === 'ml'} />
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Shortlist onOpen={onOpen} />
      <Uploads uploads={uploads} onOpen={onOpen} />
      <div className="res-actions">
        <ExportTop list={list} />
        <ImportCsv />
      </div>
    </div>
  );
}

function ModelAnalysed({ rows, onOpen }) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, 5);
  return (
    <section className="shortlist" aria-labelledby="ma-h">
      <div className="row"><h3 id="ma-h" className="label grow">Analysed in detail by the model · {rows.length}</h3></div>
      {shown.map((x) => (
        <div key={x.id} className="sl-row">
          <button className="link-btn grow ellipsis" onClick={() => onOpen(x)}>{x.place ? `Near ${x.place}` : latlon(x.lat, x.lon)}, {x.country}</button>
          <SiteStatus status={x.status} warn={x.warn} />
          <b className="num small" title="Model score">{score100(x.ml)}</b>
        </div>
      ))}
      {rows.length > 5 && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </section>
  );
}

function Baseline({ d, onOpen }) {
  const base = d.baseline;
  if (!base.length) return <div className="baseline-card"><span className="small dim">No documented field site for this test yet: every result here is new ground.</span></div>;
  return (
    <div className="baseline-card" data-tour="baseline">
      <div className="label">NASA’s usual site{base.length > 1 ? 's' : ''}</div>
      {base.map((b) => (
        <button key={b.id} className="base-row" onClick={() => onOpen({ i: b.index, id: null, lat: null })} disabled={b.index == null}>
          <span className="grow ellipsis"><b>{b.name}</b> <span className="faint small">{b.place}</span></span>
          <span className="small num">{Number.isNaN(b.score) || b.score == null ? '—' : score100(b.score)}</span>
          <span className="tiny faint num">{b.rank ? `#${b.rank.toLocaleString()}` : b.status === STATUS.FAIL ? 'fails' : 'unranked'}</span>
          {!b.representative && <span className="tiny" title={`Nearest index cell is ${b.offsetKm} km away`} style={{ color: 'var(--warn)' }}>cell {Math.round(b.offsetKm)} km off</span>}
        </button>
      ))}
      <p className="tiny faint">Scored on the same 55 km cells as every candidate. A small field site inside a wetter or icier cell can fail here; see Trust.</p>
    </div>
  );
}

function Stability() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useStore((s) => JSON.stringify(scoringConfig(s)));
  const run = async () => {
    setBusy(true);
    try { setSt({ key, ...(await call('stability', { cfg: scoringConfig(getState()), trials: 30, jitter: 0.3 })) }); } finally { setBusy(false); }
  };
  const fresh = st && st.key === key;
  return (
    <div className="stab">
      <button className="btn btn-sm" onClick={run} disabled={busy} title="Jitter every weight by ±30% thirty times and see whether the winner holds">
        {busy ? <span className="spinner" /> : <Activity size={14} />} Stability
      </button>
      {fresh && (
        <div className="stab-out tiny" role="status">
          Winner holds in <b className="num">{Math.round(st.winnerKept * 100)}%</b> of runs · top 5 overlap <b className="num">{Math.round(st.meanOverlap * 100)}%</b>
        </div>
      )}
    </div>
  );
}

/** Multi-site coverage: which requirements each additional site covers, and what none covers. */
function Coverage({ onOpen }) {
  const [cv, setCv] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useStore((s) => JSON.stringify(scoringConfig(s)));
  const run = async () => {
    setBusy(true);
    try { setCv({ key, ...(await call('coverage', { cfg: scoringConfig(getState()) })) }); } finally { setBusy(false); }
  };
  const fresh = cv && cv.key === key;
  const name = (fid) => F[fid]?.label || fid;
  return (
    <section className="coverage" aria-labelledby="cov-h">
      <div className="row">
        <h3 id="cov-h" className="label grow">
          <Term text="One site rarely reproduces everything. A site covers a requirement when it is within 12 Earth-percentile points of the target on that measurement AND passes every strict limit there, so conditions needed together are present together. Each step adds the site that covers the most requirements still open (sites at least 250 km apart).">Multi-site coverage</Term>
        </h3>
        <button className="btn btn-sm" onClick={run} disabled={busy} title="Pick sites one at a time until every requirement an Earth site can meet is covered">
          {busy ? <span className="spinner" /> : null} {fresh ? 'Recompute' : 'Cover requirements'}
        </button>
      </div>
      {fresh && (
        <div className="tiny" role="status">
          {cv.steps.length === 0 && <p className="dim">No site that passes every strict limit is close to the target on any measurement.</p>}
          <ol className="cov-steps">
            {cv.steps.map((s) => (
              <li key={s.i}>
                <button className="link-btn cov-link" onClick={() => onOpen({ i: s.i })}>{s.place ? `near ${s.place}, ` : ''}{s.country}</button>
                {' '}adds {s.adds.map(name).join(', ')} <span className="faint num">· {s.coveredSoFar}/{cv.nRequirements}</span>
              </li>
            ))}
          </ol>
          {cv.notCovered.length > 0 && (
            <p><b>No Earth site covers:</b> {cv.notCovered.map((x) => name(x.fid) + (x.beyond ? ` (target ${x.beyond} anything on Earth)` : '')).join('; ')}. These need a lab, chamber or engineered test bed.</p>
          )}
          {cv.beyondEarth.length > 0 && <p className="faint">Beyond Earth's range, so "covered" means Earth's most extreme cells: {cv.beyondEarth.map((x) => name(x.fid)).join(', ')}.</p>}
          {cv.unmeasurable.length > 0 && <p className="faint">Not checked (no {cv.unmeasurable.some((x) => x.why === 'no-earth-layer') ? 'Earth layer' : 'target value'} yet): {cv.unmeasurable.map((x) => name(x.fid)).join(', ')}.</p>}
        </div>
      )}
    </section>
  );
}

function Shortlist({ onOpen }) {
  const pins = useStore((s) => s.pins);
  const [rows, setRows] = useState({});
  const load = async () => {
    const idx = await Promise.all(pins.map((id) => call('byId', { id })));
    const r = await call('rows', { indices: idx.filter((i) => i >= 0) });
    setRows(Object.fromEntries(r.map((x) => [x.id, x])));
    return r;
  };
  useEffect(() => { if (pins.some((p) => !rows[p])) load(); }, [pins.join('.')]);
  if (!pins.length) return null;
  return (
    <section className="shortlist" aria-labelledby="sl-h">
      <div className="row"><h3 id="sl-h" className="label grow">Shortlist · {pins.length}</h3>
        <button className="btn btn-ghost btn-sm" onClick={async () => {
          const r = await load();
          const cols = features.filter((f) => !f.pending).map((f) => f.id);
          download('analog-atlas-shortlist.csv', toCsv(['cell_id', 'name', 'country', 'lat', 'lon', ...cols], r.map((x) => ({ cell_id: x.id, name: x.place, country: x.country, lat: x.lat, lon: x.lon, ...x.values }))));
        }}><Download size={13} /> CSV</button>
      </div>
      {pins.map((id) => {
        const x = rows[id];
        return (
          <div key={id} className="sl-row">
            <Pin size={13} className="earth-c" aria-hidden="true" />
            <button className="link-btn grow ellipsis" onClick={() => x && onOpen({ i: x.i, id })}>{x ? `Near ${x.place}, ${x.country}` : `Cell ${id}`}</button>
            <button className="btn btn-ghost btn-sm icon-btn" onClick={() => togglePin(id)} aria-label="Remove from shortlist"><X size={13} /></button>
          </div>
        );
      })}
    </section>
  );
}

function Uploads({ uploads, onOpen }) {
  if (!uploads.length) return null;
  return (
    <section className="shortlist" aria-labelledby="up-h">
      <div className="row"><h3 id="up-h" className="label grow">Your sites · {uploads.length}</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => setState({ uploads: [] })}>Clear</button></div>
      {uploads.map((u, k) => (
        <div key={k} className="sl-row">
          <span className="up-dot" aria-hidden="true" />
          <button className="link-btn grow ellipsis" onClick={() => u.cell != null && onOpen({ i: u.cell })}>{u.name}</button>
          <SiteStatus status={u.status} warn={u.warn} />
          <b className="num small">{score100(u.score)}</b>
        </div>
      ))}
    </section>
  );
}

function ExportTop({ list }) {
  return (
    <button className="btn btn-sm" disabled={!list.length} onClick={async () => {
      const r = await call('rows', { indices: list.map((x) => x.i) });
      const cols = features.filter((f) => !f.pending).map((f) => f.id);
      const by = Object.fromEntries(list.map((x) => [x.i, x]));
      download(`analog-atlas-${getState().testId}-${getState().targetId}.csv`, toCsv(['rank', 'cell_id', 'name', 'country', 'lat', 'lon', 'score', 'status', 'evidence', ...cols],
        r.map((x, k) => ({ rank: k + 1, cell_id: x.id, name: x.place, country: x.country, lat: x.lat.toFixed(2), lon: x.lon.toFixed(2), score: by[x.i].score?.toFixed(3),
          status: ['pass', 'unverified', 'fail'][by[x.i].status], evidence: by[x.i].evidence.toFixed(2), ...x.values }))));
    }}><Download size={14} /> Export ranked CSV</button>
  );
}

function ImportCsv() {
  const input = useRef(null);
  return (
    <>
      <button className="btn btn-sm" onClick={() => input.current.click()} title="CSV with lat, lon and optional name plus any feature columns (e.g. slope_deg)"><Upload size={14} /> Score your CSV</button>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const { header, records } = parseCsv(await file.text());
        const latK = header.find((h) => ['lat', 'latitude'].includes(h)), lonK = header.find((h) => ['lon', 'lng', 'long', 'longitude'].includes(h));
        if (!latK || !lonK) { toast('The CSV needs lat and lon columns'); return; }
        const sites = records.slice(0, 500).map((r, k) => ({
          name: r.name || r.site || `Site ${k + 1}`, lat: Number(r[latK]), lon: Number(r[lonK]),
          values: Object.fromEntries(features.filter((f) => r[f.id] !== undefined && r[f.id] !== '').map((f) => [f.id, Number(r[f.id])])),
        })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
        const scored = await call('scoreSites', { cfg: scoringConfig(getState()), sites });
        setState({ uploads: scored });
        toast(`Scored ${scored.length} of your sites. Missing columns were filled from the nearest index cell.`);
      }} />
    </>
  );
}
