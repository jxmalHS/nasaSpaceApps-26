import { recommendation } from '../lib/recommendation.js';
import Coordinates from './Coordinates.jsx';
import { ArrowLeft, Columns2, FileText, Pin, PinOff, Download } from 'lucide-react';
import { tests, T, F, limits } from '../lib/catalog.js';
import { useStore, setState, togglePin } from '../lib/store.js';
import { useResult } from '../lib/results.js';
import { go } from '../lib/router.jsx';
import { fmt, fmtDiff, latlon, score100, pct, isNum } from '../lib/format.js';
import { toCsv, download } from '../lib/csv.js';
import { Bullet, SiteStatus, Status, Term } from './ui.jsx';
import { STATUS } from '../lib/scoring.js';
import { exceptionFor, ExceptionTag, exceptionText } from '../lib/limitChecks.jsx';

/** One-glance verdict for a site, used by the inspector and the report. */
export function verdict(d) {
  const scored = d.rows.filter((r) => r.state === 'scored');
  const closer = d.baseline ? scored.filter((r) => { const b = d.baseline.rows.find((x) => x.fid === r.fid); return b && isNum(b.sim) && r.sim > b.sim + 0.005; }).length : null;
  const failed = d.checks.filter((c) => c.hard && c.ok === false);
  const unknownHard = d.checks.filter((c) => c.hard && c.ok === null);
  let head, tone;
  if (d.status === STATUS.FAIL) { head = `Not suitable: fails ${failed.map((c) => F[c.fid].short.toLowerCase()).join(', ')}`; tone = 'fail'; }
  else if (d.status === STATUS.UNKNOWN) { head = unknownHard.length ? `Unverified: no data for ${unknownHard.map((c) => F[c.fid].short.toLowerCase()).join(', ')}` : `Unverified: only ${pct(d.evidence)} of the target weight has Earth data`; tone = 'unknown'; }
  else if (d.rules >= 0.85) { head = 'Strong rules match'; tone = 'pass'; }
  else if (d.rules >= 0.65) { head = 'Partial rules match'; tone = 'pass'; }
  else { head = 'Weak rules match'; tone = 'warn'; }
  return { head, tone, closer, of: scored.length };
}

/** Share of the target weight that has no Earth layer yet (pending features). */
export function noLayerShare(d) {
  const total = d.rows.reduce((a, r) => a + (r.w || 0), 0);
  const none = d.rows.filter((r) => r.state === 'no-earth-layer').reduce((a, r) => a + (r.w || 0), 0);
  return total > 0 ? none / total : 0;
}

/** "Evidence 65% · 35% has no Earth layer yet": the gap is the same for every site. */
export function EvidenceTag({ d }) {
  const none = noLayerShare(d);
  const tag = <Status kind="plain">Evidence {pct(d.evidence)}{none > 0 ? ` · ${pct(none)} unmapped` : ''}</Status>;
  return none > 0
    ? <Term text={`${pct(none)} of this test's weight is on features with no Earth layer yet (shown as No Earth layer). Every site has the same gap, so it lowers evidence everywhere but does not change the order.`}>{tag}</Term>
    : tag;
}

/** When the detailed model analysed this site, say so up front: its result is the stronger evidence. */
function ModelVerdict({ d }) {
  const m = d.mlDetail || {};
  if (d.mlStatus !== 'scored' || !isNum(m.score_percentile)) return null;
  const p = m.score_percentile;
  const stable = isNum(m.stable_runs) && isNum(m.total_runs) ? ` · stable in ${m.stable_runs}/${m.total_runs} runs` : '';
  return (
    <div className={'verdict ' + (p >= 75 ? 'v-pass' : 'v-warn')} style={{ marginTop: 8 }}>
      <div className="verdict-score"><b className="num">{p.toFixed(0)}</b><span className="tiny">model percentile</span></div>
      <div className="grow">
        <div className="verdict-head">Detailed model: beats {p.toFixed(0)}% of the sites it analysed</div>
        <p className="small dim">{m.site_name ? <>Analysed site: <b>{m.site_name}</b>{stable}. </> : stable ? stable.slice(3) + '. ' : ''}
          The model checks this site in 5 km squares; the rules score above uses one 55 km cell, which can hide a crater or a mountain.</p>
      </div>
    </div>
  );
}

export default function Inspector({ d, loading, onBack }) {
  const s = useStore((x) => x);
  const env = useResult((r) => r.data?.envelope);
  const test = tests[s.testId], tg = T[s.targetId];
  if (loading && !d) return <div className="inspector"><button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> All results</button><div className="skeleton" style={{ height: 300, marginTop: 12 }} /></div>;
  if (!d) return null;
  // Is this cell the index cell of a NASA field site used for the current test?
  const nasaSite = (d.baselineAll || []).find((b) => b.representative && b.index === d.i) || null;
  const v = verdict(d);
  const pinned = s.pins.includes(d.id);
  const envOf = (fid) => env?.find((e) => e.fid === fid);
  const lim = (limits[tg.body] || []).filter((l) => test.limits.includes(l.id));

  return (
    <article className="inspector" aria-labelledby="ins-h">
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> All results</button>
        <span className="grow" />
        <button className="btn btn-ghost btn-sm icon-btn" onClick={() => togglePin(d.id)} aria-pressed={pinned} aria-label={pinned ? 'Remove from shortlist' : 'Add to shortlist'} title="Shortlist">{pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>
      </div>
      <header className="ins-head">
        <div className="row"><span className="tag-ab a">A</span><h2 id="ins-h">{d.place ? `Near ${d.place}` : 'Earth cell'}, {d.country}</h2></div>
        <div className="small faint"><Coordinates key={d.id} lat={d.lat} lon={d.lon} label="Selected Earth index cell center"/>0.5° cell {d.id} · {d.continent}</div>
        <div className={'verdict v-' + v.tone}>
          <div className="verdict-score"><b className="num">{score100(d.score)}</b><span className="tiny">match out of 100</span></div>
          <div className="grow">
            <div className="verdict-head">{v.head}</div>
            <p className="small"><b>Recommendation</b> · {recommendation(d)}</p>
            <div className="small dim">
              {d.rankFiltered ? `Rank ${d.rankFiltered.toLocaleString()} of ${d.scoredTotal.toLocaleString()} listed cells` : d.rankAll ? `Would rank ${d.rankAll.toLocaleString()} overall` : 'Not ranked'}
              {v.closer != null && d.baseline ? ` · closer than ${d.baseline.name.split(',')[0]} on ${v.closer} of ${v.of} targets` : ''}
            </div>
            <div className="row wrap" style={{ marginTop: 6 }}>
              <SiteStatus status={d.status} warn={d.warn} />
              {d.beatsBaseline && <Status kind="beats" />}
              <EvidenceTag d={d} />
            </div>
          </div>
        </div>
        <ModelVerdict d={d} />
        <div className="row wrap">
          <button className="btn btn-primary btn-sm" onClick={() => { setState({ compareId: d.id }); go('/compare'); }}><Columns2 size={14} /> Compare with target</button>
          <button className="btn btn-sm" onClick={() => { setState({ sel: d.id }); go('/report'); }}><FileText size={14} /> Site report</button>
          <button className="btn btn-sm" onClick={() => download(`cell-${d.id}.csv`, toCsv(['feature', 'unit', 'earth', 'target', 'difference', 'role'],
            Object.keys(d.values).map((fid) => { const row = d.rows.find((r) => r.fid === fid); return { feature: F[fid].label, unit: F[fid].unit, earth: d.values[fid]?.toFixed(3), target: tg.f[fid]?.v, difference: row && isNum(row.diff) ? row.diff.toFixed(3) : '', role: row ? 'target' : d.checks.find((c) => c.fid === fid) ? 'limit' : 'ignored' }; })))}><Download size={14} /> CSV</button>
        </div>
      </header>

      <section aria-labelledby="ins-t">
        <h3 id="ins-t" className="ins-h3">Targets in real units <span className="tiny faint">A = this site · <span className="target-c">B = {tg.name}</span></span></h3>
        <div className="legend-line tiny faint"><i className="lg-e" /> this site <i className="lg-t" /> target <i className="lg-b" /> {d.baseline ? d.baseline.name.split(',')[0] : 'baseline'} <i className="lg-r" /> Earth range</div>
        <table className="ft">
          <tbody>
            {d.rows.map((r) => {
              const e = envOf(r.fid);
              const b = d.baseline?.values?.[r.fid];
              return (
                <tr key={r.fid} className={'st-' + r.state}>
                  <th scope="row">
                    <Term id={r.fid}>{F[r.fid].short}</Term>
                    <div className="tiny faint">{Math.round(r.w)} pts{r.dir !== 'match' ? (r.dir === 'high' ? ' · more is fine' : ' · less is fine') : ''}</div>
                  </th>
                  <td className="ft-vals num">
                    {r.state === 'scored' && <><span className="earth-c">{fmt(r.x, r.fid)}</span> <span className="faint">vs</span> <span className="target-c">{r.assumed ? 'Earth max' : fmt(r.tv, r.fid)}</span>
                      <div className="tiny faint">{r.assumed ? 'no target value: aiming for Earth’s extreme' : `${fmtDiff(r.diff, r.fid)}${r.beyond ? ' · target beyond Earth' : ''}`}</div></>}
                    {r.state === 'no-earth-layer' && <Status kind="unknown">No Earth layer</Status>}
                    {r.state === 'no-target-value' && <Status kind="unknown">Target unknown</Status>}
                    {r.state === 'missing' && <Status kind="unknown">No data here</Status>}
                  </td>
                  <td className="ft-bullet"><Bullet fid={r.fid} x={r.x} t={r.tv} b={b} min={e?.min} max={e?.max} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {d.checks.length > 0 && (
        <section aria-labelledby="ins-c">
          <h3 id="ins-c" className="ins-h3">Limits and interference</h3>
          {nasaSite && <p className="tiny faint" style={{ margin: '0 0 6px' }}>NASA field site for this test: <b>{nasaSite.name}</b>. Limits stay strict; where NASA's own site breaks one, it is tagged as an exception (see the Trust page).</p>}
          <ul className="checks">
            {d.checks.map((c) => {
              const preset = test.interference?.[c.fid];
              const matchesPreset = preset && preset.op === c.op && preset.v === c.v && Boolean(preset.hard) === c.hard;
              const ex = nasaSite && matchesPreset ? exceptionFor(s.testId, c.fid, nasaSite.id) : null;
              return (
                <li key={c.fid}>
                  <Status kind={c.ok === null ? 'unknown' : c.ok ? 'met' : c.hard ? 'notmet' : 'warn'}>{c.ok === null ? 'Unknown' : c.ok ? 'Met' : c.hard ? 'Not met' : 'Warning'}</Status>
                  <span className="grow small"><Term id={c.fid}>{F[c.fid].short}</Term> <span className="num">{fmt(c.x, c.fid)}</span> <span className="faint">must be {c.op === '<=' ? '≤' : '≥'} {fmt(c.v, c.fid)}{c.hard ? '' : ' (soft)'}</span>
                    {ex && <div className="tiny" style={{ marginTop: 2 }}><ExceptionTag kind={ex.kind} /> {exceptionText(ex)}{ex.reason ? `. ${ex.reason}` : ''}</div>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ModelSection d={d} />

      <section aria-labelledby="ins-l">
        <h3 id="ins-l" className="ins-h3">What this site cannot test</h3>
        <ul className="lims">{lim.map((l) => <li key={l.id}><b>{l.title}.</b> <span className="dim">{l.text}</span></li>)}</ul>
        <p className="small"><b>Pair with:</b> <span className="dim">{test.lab}</span></p>
      </section>

      <section className="ins-notes tiny faint">
        Day–night swing here is {d.lstMeasured ? 'measured by MODIS' : 'modelled from NASA POWER (no MODIS coverage)'}. All values describe the 55 km cell, not a single outcrop; confirm on site before a campaign.
      </section>
    </article>
  );
}

/** What the trained model says about this cell, or plainly that it did not analyse it. */
function ModelSection({ d }) {
  const card = useResult((r) => r.summary?.ml?.model);
  if (d.mlStatus === 'no-model') return null;
  if (d.mlStatus === 'not-analysed') {
    return (
      <section className="ins-ml small" aria-label="Model">
        <span className="label">Model</span>
        <Status kind="unknown">Not analysed in detail</Status>
        <span className="tiny faint">The detailed model only scored selected sites. This cell is ranked by the rules score above; it is not a 0.</span>
      </section>
    );
  }
  const m = d.mlDetail || {};
  const list = (k) => (m[k] && m[k].length ? m[k].join(', ') : null);
  const stable = isNum(m.stable_runs) && isNum(m.total_runs)
    ? `Stable in ${m.stable_runs}/${m.total_runs} runs`
    : isNum(m.confidence) ? `Stable in ${pct(m.confidence)} of runs` : null;
  return (
    <section className="ins-ml small" aria-label="Model">
      <div className="row wrap" style={{ width: '100%' }}>
        <span className="label">Model</span> <Term text={card?.score_definition}><b className="num">{score100(d.ml)}/100</b></Term>
        {isNum(m.score_percentile) && <Term text={card?.score_comparability}><span className="dim">better than {m.score_percentile.toFixed(0)}% of analysed sites</span></Term>}
        <span className="faint">vs rules {score100(d.rules)}/100</span>
        {m.low_evidence && <Term text={card?.low_evidence_rule}><Status kind="warn">Low evidence</Status></Term>}
      </div>
      {m.site_name && <div className="tiny">Analysed site: <b>{m.site_name}</b>{m.sites_in_cell ? ` (+${m.sites_in_cell - 1} more in this cell, ${m.aggregation === 'mean' ? 'averaged' : 'best kept'})` : ''}</div>}
      {stable && <div className="tiny"><Term text={card?.confidence_definition}>{stable}</Term></div>}
      {list('req_met') && <div className="tiny"><Status kind="met" size={11}>Met</Status> {list('req_met')}</div>}
      {list('req_not_met') && <div className="tiny"><Status kind="notmet" size={11}>Not met</Status> {list('req_not_met')}</div>}
      {list('req_unknown') && <div className="tiny"><Status kind="unknown" size={11}>Unknown</Status> {list('req_unknown')}</div>}
      {list('flags') && <div className="tiny"><Status kind="warn" size={11}>Flags</Status> {list('flags')}</div>}
      {isNum(m.spot_lat) && isNum(m.spot_lon) && <div className="tiny">Recommended 5 km test spot: <Coordinates key={m.spot_lat+","+m.spot_lon} lat={m.spot_lat} lon={m.spot_lon} label="Model test spot"/></div>}
      {m.note && <div className="tiny dim">{m.note}</div>}
      <span className="tiny faint">Strict limits above still come from the rules; the model never overrides them.</span>
    </section>
  );
}
