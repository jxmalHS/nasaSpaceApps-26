import { recommendation } from '../lib/recommendation.js';
import { useEffect, useState } from 'react';
import { Printer, ArrowLeft, Link2 } from 'lucide-react';
import { tests, T, F, limits, A } from '../lib/catalog.js';
import { useStore, scoringConfig, getState, shareUrl } from '../lib/store.js';
import { useScoring, useResult } from '../lib/results.js';
import { call } from '../lib/engine.js';
import { go } from '../lib/router.jsx';
import { fmt, fmtDiff, latlon, score100, pct, isNum } from '../lib/format.js';
import { Bullet, SiteStatus, Status, toast } from '../components/ui.jsx';
import { verdict, EvidenceTag, RankScore } from '../components/Inspector.jsx';

export default function Report() {
  useScoring();
  const s = useStore((x) => x);
  const r = useResult((x) => x);
  const [d, setD] = useState(null);
  const [stab, setStab] = useState(null);
  const test = tests[s.testId], tg = T[s.targetId];
  const id = s.sel ?? r.data?.list?.[0]?.id;

  useEffect(() => {
    if (id == null) return;
    let alive = true;
    (async () => {
      const i = await call('byId', { id });
      const cfg = scoringConfig(getState());
      const [det, st] = await Promise.all([call('detail', { cfg, i }), call('stability', { cfg, trials: 24, jitter: 0.3 })]);
      if (alive) { setD(det); setStab(st); }
    })();
    return () => { alive = false; };
  }, [id, r.data]);

  if (!d) return <main id="main" className="doc"><div className="skeleton" style={{ height: 380 }} /></main>;
  const v = verdict(d);
  const lim = limits[tg.body].filter((l) => test.limits.includes(l.id));
  const env = r.data?.envelope || [];
  const inTop = stab?.ref?.find((x) => x.i === d.i);

  return (
    <main id="main" className="doc report">
      <div className="row no-print">
        <button className="btn btn-ghost btn-sm" onClick={() => go('/explore')}><ArrowLeft size={14} /> Back to Explore</button>
        <span className="grow" />
        <button className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl()); toast('Report link copied'); } catch { /* ignore */ } }}><Link2 size={14} /> Copy link</button>
        <button className="btn btn-primary btn-sm" onClick={() => print()}><Printer size={14} /> Print / PDF</button>
      </div>

      <header className="stack">
        <div className="doc-meta"><span>Analog Atlas site report</span><span>{new Date().toISOString().slice(0, 10)}</span><span>Cell {d.id}</span></div>
        <h1>{d.place ? `Near ${d.place}` : 'Earth cell'}, {d.country}</h1>
        <div className="doc-meta"><span>{latlon(d.lat, d.lon)}</span><span>Test: {test.label}</span><span>Target: {tg.name} ({tg.body === 'moon' ? 'Moon' : 'Mars'})</span><span>Mode: {s.mode === 'stress' ? 'Stress (meet or exceed)' : 'Realism (closest match)'}</span></div>
      </header>

      <section className={'verdict v-' + v.tone} aria-labelledby="r-v">
        <RankScore d={d} />
        <div className="grow">
          <h2 id="r-v" className="verdict-head" style={{ fontSize: 22, margin: 0 }}>{v.head}</h2>
          <p><b>Recommendation</b> · {recommendation(d)}</p>
          <p className="small">{d.rankFiltered ? `Rank ${d.rankFiltered.toLocaleString()} of ${d.scoredTotal.toLocaleString()} listed Earth cells.` : 'Not in the ranking.'}
            {d.baseline ? ` Closer to the target than ${d.baseline.name} on ${v.closer} of ${v.of} measured target features (baseline score ${score100(d.baseline.score)}).` : ' No documented NASA field site exists for this test.'}
            {stab?.trials === 0 ? ' Ranking stability: no eligible sites to test.' : stab ? ` Ranking stability: the winner held in ${Math.round(stab.winnerKept * 100)}% of 24 runs with weights jittered ±30%${inTop ? `; this site stayed in the top 5 in ${Math.round(inTop.freq * 100)}% of runs` : ''}.` : ''}</p>
          <div className="row wrap"><SiteStatus status={d.status} warn={d.warn} />{d.beatsBaseline && <Status kind="beats">Above NASA’s best site (55 km)</Status>}<EvidenceTag d={d} /></div>
        </div>
      </section>

      <section aria-labelledby="r-t">
        <h2 id="r-t">Target conditions, in real units</h2>
        <div className="table-scroll">
          <table className="dt">
            <thead><tr><th>Feature</th><th className="num">Weight</th><th className="num">This site</th><th className="num">Target</th><th className="num">Difference</th><th className="num">{d.baseline ? d.baseline.name.split(',')[0] : 'Baseline'}</th><th style={{ width: '24%' }}>On one axis</th><th>Status</th></tr></thead>
            <tbody>
              {d.rows.map((row) => {
                const e = env.find((x) => x.fid === row.fid);
                return (
                  <tr key={row.fid}>
                    <td><b>{F[row.fid].label}</b><div className="tiny faint">{test.target[row.fid]?.why}</div></td>
                    <td className="num">{Math.round(row.w)}</td>
                    <td className="num earth-c">{fmt(row.x, row.fid)}</td>
                    <td className="num target-c">{row.assumed ? 'Earth max' : fmt(row.tv, row.fid)}<div className="tiny faint">{tg.f[row.fid]?.s}</div></td>
                    <td className="num">{fmtDiff(row.diff, row.fid)}{row.beyond ? <div className="tiny target-c">beyond Earth</div> : null}</td>
                    <td className="num">{fmt(d.baseline?.values?.[row.fid], row.fid)}</td>
                    <td><Bullet fid={row.fid} x={row.x} t={row.tv} b={d.baseline?.values?.[row.fid]} min={e?.min} max={e?.max} /></td>
                    <td>{row.state === 'scored' ? <Status kind={row.sim > 0.8 ? 'met' : 'warn'}>{row.sim > 0.8 ? 'Close' : 'Gap'}</Status> : <Status kind="unknown">{row.state === 'no-earth-layer' ? 'No Earth layer' : row.state === 'no-target-value' ? 'Target unknown' : 'No data'}</Status>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="r-c">
        <h2 id="r-c">Requirements and interference</h2>
        {d.checks.length === 0 ? <p>No limits set for this test.</p> : (
          <table className="dt">
            <thead><tr><th>Condition</th><th className="num">This site</th><th className="num">Limit</th><th>Type</th><th>Result</th><th>Why it matters</th></tr></thead>
            <tbody>
              {d.checks.map((c) => (
                <tr key={c.fid}>
                  <td>{F[c.fid].label}</td><td className="num">{fmt(c.x, c.fid)}</td><td className="num">{c.op === '<=' ? '≤' : '≥'} {fmt(c.v, c.fid)}</td><td>{c.hard ? 'Strict' : 'Soft'}</td>
                  <td><Status kind={c.ok === null ? 'unknown' : c.ok ? 'met' : c.hard ? 'notmet' : 'warn'}>{c.ok === null ? 'Unknown' : c.ok ? 'Met' : c.hard ? 'Not met' : 'Warning'}</Status></td>
                  <td className="small dim">{test.interference[c.fid]?.why || 'User requirement'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small">Unknown is never treated as a pass.</p>
      </section>

      <section aria-labelledby="r-l">
        <h2 id="r-l">What this site cannot reproduce</h2>
        <table className="dt"><tbody>{lim.map((l) => <tr key={l.id}><td style={{ width: 180 }}><b>{l.title}</b><div className="tiny">Earth: {l.earth}</div></td><td>{l.text}<div className="small dim">Cover with: {l.lab}</div></td></tr>)}</tbody></table>
        <p className="callout small"><b>Recommended pairing.</b> {test.lab}</p>
      </section>

      <section aria-labelledby="r-s">
        <h2 id="r-s">Sources and method</h2>
        <table className="dt">
          <thead><tr><th>Feature</th><th>Earth source</th><th>Resolution</th></tr></thead>
          <tbody>{d.rows.concat(d.checks).filter((x, k, arr) => arr.findIndex((y) => y.fid === x.fid) === k).map((x) => <tr key={x.fid}><td>{F[x.fid].label}</td><td className="small">{F[x.fid].source}</td><td className="small">{F[x.fid].res}</td></tr>)}</tbody>
        </table>
        <p className="small">Target values for {tg.name}: {tg.sources.join('; ')}. Values marked “estimate” are placeholders pending extraction at matched scale.
          Scores compare Earth percentiles of each value (0.5° cells, 78,993 land cells); weights shown above; day–night swing here is {d.lstMeasured ? 'MODIS-measured' : 'modelled from NASA POWER'}.
          {d.ml != null && !Number.isNaN(d.ml) ? ` Model score ${score100(d.ml)} (rules ${score100(d.rules)}).` : ''}</p>
        {d.baselineAll?.length > 0 && <p className="small">Baselines: {d.baselineAll.map((b) => `${b.name} (${A[b.id].campaigns})`).join('; ')}.</p>}
      </section>
      <p className="print-only small">Reopen this exact view: {shareUrl()}</p>
    </main>
  );
}
