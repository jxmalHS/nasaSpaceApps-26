import { useEffect, useState } from 'react';
import { tests, A, T, features, F, systems } from '../lib/catalog.js';
import missionsJson from '../config/missions.json';
import targetsJson from '../config/targets.json';
import { limitChecks as checks, exceptionsFor, ExceptionTag, exceptionText } from '../lib/limitChecks.jsx';

/** Precedent-site checks from ml/validate_limits.py, keyed "testId|featureId". */
const CHECK = Object.fromEntries((checks.checks || []).map((c) => [`${c.test_id}|${c.feature}`, c]));
import { distanceKm } from '../lib/geo.js';
import { isNum, pct } from '../lib/format.js';
import { useResult, useScoring } from '../lib/results.js';
import { call, ready } from '../lib/engine.js';
import { Status, Term } from '../components/ui.jsx';
import { Link } from '../lib/router.jsx';

const OP = { '<=': '≤', '>=': '≥', '<': '<', '>': '>' };
const unitOf = (fid) => (F[fid]?.unit && F[fid].unit !== 'NDVI' ? ` ${F[fid].unit}` : '');
/** "NASA Earth Observatory" from 'NASA Earth Observatory, "Measuring Vegetation…", 30 Aug 2000'. */
const shortCite = (cite = '') => { const t = cite.split(/[,:;]/)[0].trim(); return t.length > 48 ? t.slice(0, 46) + '…' : t; };
const firstSentence = (txt = '') => { const m = txt.match(/^.*?[.!?](\s|$)/); return m ? m[0].trim() : txt; };

/**
 * Every pass/fail limit, one row per distinct rule, with its source and the NASA-site check.
 * Read from src/config/missions.json (each limit's `src` and `basis`, and the `sources` catalogue),
 * so this table cannot drift from the numbers the scorer uses. Details fold away for a clean read.
 */
function LimitSources() {
  const S = missionsJson.sources || {};
  const groups = new Map();
  for (const s of systems) for (const t of s.tests) for (const [fid, c] of Object.entries(t.interference || {})) {
    const key = `${fid}|${c.op}|${c.v}`;
    if (!groups.has(key)) groups.set(key, { fid, c, hard: [], soft: [], changed: [], exceptions: [], checked: 0 });
    const g = groups.get(key);
    g[c.hard ? 'hard' : 'soft'].push(t.label);
    const chk = CHECK[`${t.id}|${fid}`];
    if (chk) {
      g.checked += chk.precedents.filter((p) => p.representative).length;
      for (const e of chk.exceptions) g.exceptions.push({ ...e, test: t.label, hard: chk.hard });
    }
    if (c.was != null) g.changed.push({ label: t.label, was: c.was });
    else if (g.c.was != null) g.c = c; // explain the row with an unchanged limit's basis when there is one
  }
  const rows = [...groups.values()].sort((a, b) => a.fid.localeCompare(b.fid) || a.c.v - b.c.v);
  if (!rows.length) return null;
  const used = [...new Set(rows.flatMap((r) => r.c.src || []))].filter((id) => S[id]);
  const isTeam = (c) => (c.basis || '').startsWith('No NASA dataset sets this number.');
  const nNasa = rows.filter((r) => !isTeam(r.c)).length;
  // the precedent-site check is how a limit is tested, not where its number comes from: it has its own column
  const srcOf = (c) => (c.src || []).filter((id) => S[id] && id !== 'nasa-precedent-check');
  const why = (c) => { const b = (c.basis || '').replace('No NASA dataset sets this number.', '').trim(); return firstSentence(b) || '—'; };
  const typeBadge = (c) => (c.hard ? <Status kind="fail" size={11}>Strict</Status> : <Status kind="warn" size={11}>Soft</Status>);
  return (
    <section aria-labelledby="t-lim">
      <h2 id="t-lim">Limits and their sources</h2>
      <p>Limits are pass/fail rules about things that would <b>spoil a test</b>, such as snow, plants or rain. They do not measure how Moon- or Mars-like a place is: the ranking does that.
        A site that breaks a <Status kind="fail" size={11}>Strict</Status> limit is left out of the ranking. Breaking a <Status kind="warn" size={11}>Soft</Status> limit cuts its score by 25% and shows a warning.</p>
      <p className="small"><b>{nNasa} of {rows.length}</b> limits use a number NASA publishes. The other {rows.length - nNasa} are <b>team values</b>, marked below. Every limit is checked against the places NASA actually used for that kind of test.
        If a NASA site breaks a limit, the limit stays as it is and the site is tagged as an exception: nothing is tuned to make NASA’s sites pass.</p>
      <div className="table-scroll"><table className="dt">
        <thead><tr><th>Limit</th><th>Applies to</th><th>Where the number comes from</th><th>Source</th><th>Checked on NASA field sites</th></tr></thead>
        <tbody>{rows.map(({ fid, c, hard, soft, changed, exceptions, checked }) => (
          <tr key={`${fid}${c.op}${c.v}`}>
            <td style={{ whiteSpace: 'nowrap' }}><b><Term id={fid}>{F[fid]?.label || fid}</Term></b><div className="num">{OP[c.op] || c.op} {c.v}{unitOf(fid)}</div></td>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>
              {hard.length > 0 && <div title={hard.join(', ')}><Status kind="fail" size={11}>Strict</Status> {hard.length} test{hard.length > 1 ? 's' : ''}</div>}
              {soft.length > 0 && <div title={soft.join(', ')} style={{ marginTop: 4 }}><Status kind="warn" size={11}>Soft</Status> {soft.length} test{soft.length > 1 ? 's' : ''}</div>}
            </td>
            <td className="small"><div style={{ marginBottom: 4 }}>{isTeam(c) ? <Status kind="unknown" size={11}>Team value</Status> : <Status kind="met" size={11}>NASA number</Status>}</div>{why(c)}
              {(c.basis && c.basis.length > why(c).length + 40) || changed.length > 0 ? (
                <details><summary className="tiny faint">More</summary>
                  <div className="tiny">{c.basis}</div>
                  {changed.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>Changed from {[...new Set(changed.map((x) => x.was))].join(' / ')}.</div>}
                  <div className="tiny faint">Tests: {[...hard, ...soft].join(', ')}</div>
                </details>) : null}
            </td>
            <td className="small">{srcOf(c).length
              ? srcOf(c).map((id) => <div key={id} style={{ marginBottom: 4 }}><a href={S[id].url} target="_blank" rel="noreferrer" title={S[id].cite}>{shortCite(S[id].cite)}</a></div>)
              : <span className="faint">—</span>}</td>
            <td className="small">
              {checked === 0 ? <span className="faint">No NASA site for this test yet</span>
                : exceptions.length === 0 ? <Status kind="met" size={11}>All {checked} pass</Status>
                : <details><summary style={{ listStyle: 'none', cursor: 'pointer' }} title="Click to see which NASA sites"><Status kind="warn" size={11}>{exceptions.length} of {checked} exceptions ▾</Status></summary>
                    {exceptions.map((e, k) => (
                      <div key={k} className="tiny" style={{ marginTop: 6 }}>
                        <ExceptionTag kind={e.kind} /> <b>{A[e.site]?.name || e.site}</b> ({e.test}): {exceptionText({ ...e, feature: fid })}{e.reason ? `. ${e.reason}` : ''}
                      </div>
                    ))}
                  </details>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <details>
        <summary className="small"><b>Limits test by test</b></summary>
        <div className="table-scroll"><table className="dt">
          <thead><tr><th>Test</th><th>Limits</th></tr></thead>
          <tbody>{systems.flatMap((sys) => sys.tests.map((t) => (
            <tr key={t.id}><td><b>{t.label}</b> <span className="tiny faint">{sys.label}</span></td>
              <td className="small">{Object.entries(t.interference || {}).length
                ? Object.entries(t.interference).map(([fid, c]) => <div key={fid} style={{ marginBottom: 4 }}>{typeBadge(c)} {F[fid]?.label || fid} {OP[c.op] || c.op} {c.v}{unitOf(fid)}</div>)
                : <span className="faint">No limits</span>}</td></tr>)))}</tbody>
        </table></div>
      </details>
      <details>
        <summary className="small"><b>All sources, with the quoted text</b></summary>
        <ol className="small stack" style={{ paddingLeft: 18 }}>
          {used.map((id) => (
            <li key={id} id={`src-${id}`}><a href={S[id].url} target="_blank" rel="noreferrer">{S[id].cite}</a><div className="faint">{S[id].says}</div></li>
          ))}
        </ol>
        {checks.method && <p className="small faint">How the NASA-site check works: {checks.method}</p>}
        <p className="small faint">Exception tags: <ExceptionTag kind="field-site" /> breaks it at the field site itself, <ExceptionTag kind="cell-only" /> only the 55 km cell breaks it, <ExceptionTag kind="cell" /> no finer NASA data exists to check. Weights are team judgement: no NASA dataset publishes analog weights.</p>
      </details>
      <p className="small faint">The detailed model has its own land-cover limits (most trees, crops, water and buildings allowed per 5 km square): team values based on the IGBP land-cover classes, in KNN-Model/config/missions.yaml.</p>
    </section>
  );
}

/** Validation shown plainly: what holds, what does not, and why. */
const STATUS_TEXT = { measured: 'Measured', verify: 'Published', estimate: 'Estimate', TODO: 'Unknown', 'n/a': 'n/a' };
const STATUS_KIND = { measured: 'met', verify: 'met', estimate: 'unknown', TODO: 'unknown', 'n/a': 'unknown' };

/** Where each Moon/Mars target value comes from: measured by our pipeline, published, or still an estimate. */
function TargetSources() {
  const meas = targetsJson.measurement;
  const fids = ['slope_deg', 'rough_m', 'lst_dtr_K', 't_mean_C', 't_range_K'];
  const all = Object.values(T);
  const count = (s) => all.reduce((a, t) => a + Object.values(t.f).filter((v) => v.s === s).length, 0);
  return (
    <section aria-labelledby="t-tg">
      <h2 id="t-tg">Where the Moon and Mars values come from</h2>
      <p>
        Each target value is <b>measured</b> by our pipeline from NASA data, <b>published</b> (a mission or paper value), or still an <b>estimate</b>.
        Across all {all.length} targets: {count('measured')} measured, {count('verify')} published, {count('estimate')} estimates, {count('TODO')} unknown (scored as Unknown, never a pass).
      </p>
      {meas && (
        <p className="small">
          Slope and roughness are measured at the <b>same physical scale as the Earth cells</b> ({meas.cell_km} km cell; {meas.rough_px_km} km roughness pixels) from LOLA (Moon) and MOLA (Mars).
          The method was first checked on {meas.calibration.rough_m.n_cells} Earth cells against the Earth index: roughness tracks it closely (r = {meas.calibration.rough_m.r}) and is scaled by {meas.calibration.rough_m.factor}; slope is looser (r = {meas.calibration.slope_deg.r}, ratio spread {meas.calibration.slope_deg.spread_p10_p90.join('–')}), so treat target slopes as ±40%.
          Moon temperatures are Diviner seasonal maps averaged over the same cell (surface temperature: the Moon has no air, while Earth’s mean temperature is 2 m air temperature).
        </p>
      )}
      <div className="table-scroll"><table className="dt">
        <thead><tr><th>Target</th>{fids.map((f) => <th key={f} className="num">{F[f]?.short || f}</th>)}</tr></thead>
        <tbody>{all.map((t) => (
          <tr key={t.id}><td>{t.name} <span className="faint tiny">{t.body}</span></td>
            {fids.map((f) => { const v = t.f[f]; return (
              <td key={f} className="num" title={v?.src || ''}>{v?.v == null ? '—' : v.v}{F[f]?.unit ? ` ${F[f].unit}` : ''}
                <div><Status kind={STATUS_KIND[v?.s] || 'unknown'}>{STATUS_TEXT[v?.s] || v?.s || '—'}</Status></div></td>); })}
          </tr>))}</tbody>
      </table></div>
    </section>
  );
}

export default function Trust() {
  useScoring();
  const summary = useResult((r) => r.summary);
  const [rules, setRules] = useState(null);
  useEffect(() => { ready().then(() => call('validateRules', { mode: 'stress' })).then(setRules); }, []);
  const ml = summary?.ml;
  // Keyed by test AND target: ltv.wheels is validated against two targets and must not overwrite itself.
  const loo = (ml?.validation || []).filter((v) => v.held_out || v.engine_held_out);
  const covs = (ml?.validation || []).filter((v) => v.status === 'coverage');
  const mlVal = Object.fromEntries(loo.map((v) => [`${v.test_id}/${v.target_id}`, v]));

  const allRules = rules?.flatMap((t) => t.sites.filter((x) => x.representative && x.percentile != null).map((x) => x.percentile)) || [];
  const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const mlP = loo.filter((v) => v.median_percentile != null).map((v) => v.median_percentile);
  const ranked = [...new Set(loo.map((v) => v.engine_held_out?.[0]?.of).filter(isNum))].sort((x, y) => x - y);
  const warned = loo.filter((v) => v.warning).length;
  const setLabel = (v) => `${tests[v.test_id]?.label || v.test_id} · ${T[v.target_id]?.name || v.target_id}`;

  return (
    <main id="main" className="doc trust">
      <header className="stack">
        <h1>Can you trust the ranking?</h1>
        <p>Partly, and this page shows exactly how far. The data are real, the method is open, and missing evidence is never counted as a pass. The tests below measure whether the scorer recognises the places NASA has already used for each kind of test.</p>
      </header>

      <section aria-labelledby="t-sum">
        <h2 id="t-sum">At a glance</h2>
        <table className="dt">
          <tbody>
            <tr><th>Earth index</th><td>{summary ? `${summary.n.toLocaleString()} land cells at 0.5°, 15 measured layers, build ${summary.fingerprint}` : '…'}</td></tr>
            <tr><th>Rules: precedent sites</th><td>{rules ? `Median percentile ${median(allRules)?.toFixed(0)} across ${allRules.length} site–test pairs (100 = ranked first on Earth)` : 'Computing on all 20 tests…'}</td></tr>
            <tr><th>Model</th><td>{ml?.model ? <>{`${ml.model.name} ${ml.model.version}${ml.model.demo ? ' (demo stand-in)' : ''}. Held-out NASA sites: median percentile ${median(mlP)?.toFixed(0) ?? '—'} across ${mlP.length} test–target sets`}{ranked.length > 0 && <>, ranked among only the {ranked.length > 1 ? `${ranked[0]}–${ranked[ranked.length - 1]}` : ranked[0]} Earth sites the model analysed per set (not all {summary?.n?.toLocaleString() ?? ''} land cells)</>}.{warned > 0 && <span style={{ color: 'var(--warn)' }}> {warned} set{warned > 1 ? 's have' : ' has'} too few sites to be strong evidence.</span>}</> : ml?.reason || '…'}</td></tr>
            <tr><th>Stability</th><td>Run it live for any configuration from the Stability button in <Link to="/explore">Explore</Link>: weights are jittered ±30% thirty times and the winner’s survival rate is reported.</td></tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="t-r">
        <h2 id="t-r">Do known NASA field sites score well?</h2>
        <p>For each test, every documented precedent site is scored against a reference target (Shackleton connecting ridge for Moon tests, Jezero for Mars) in Stress mode. A percentile of 90 means the site beats 90% of Earth’s land cells. Rules are not trained on these sites, so this is an independent check. The model column holds each site out and gives its percentile among the few dozen Earth sites the model ranked for the same test and target, a much smaller population than the rules column, so the two are not directly comparable.</p>
        <div className="table-scroll">
          <table className="dt">
            <thead><tr><th>Test</th><th>Precedent site</th><th className="num">Rules</th><th className="num">Model (held out)</th><th style={{ width: 200 }}>0 ─ percentile ─ 100</th><th>Status at cell scale</th></tr></thead>
            <tbody>
              {!rules && <tr><td colSpan={6}><div className="skeleton" style={{ height: 120 }} /></td></tr>}
              {rules?.flatMap((t) => t.sites.map((x, k) => {
                const mv = mlVal[`${t.testId}/${t.targetId}`]?.held_out?.find((h) => h.site === x.id);
                return (
                  <tr key={t.testId + x.id}>
                    <td>{k === 0 ? <b>{tests[t.testId].label}</b> : ''}</td>
                    <td>{x.name}{!x.representative && <div className="tiny" style={{ color: 'var(--warn)' }}>index cell {Math.round(x.offsetKm)} km away: not representative</div>}</td>
                    <td className="num">{x.percentile == null ? '—' : x.percentile.toFixed(0)}</td>
                    <td className="num">{mv?.percentile == null ? '—' : mv.percentile.toFixed(0)}</td>
                    <td><div className="dotplot">{[25, 50, 75].map((g) => <i key={g} className="gl" style={{ left: g + '%' }} />)}{x.percentile != null && <i className="d rules" style={{ left: x.percentile + '%' }} title="Rules" />}{mv?.percentile != null && <i className="d" style={{ left: mv.percentile + '%' }} title="Model" />}</div></td>
                    <td>{x.status === 0 ? <Status kind="met">Passes</Status> : x.status === 2 ? <Status kind="notmet">Fails a limit</Status> : <Status kind="unknown">Unverified</Status>}
                      {x.representative && exceptionsFor(t.testId, x.id).map((e) => (
                        <div key={e.feature} className="tiny" style={{ marginTop: 4 }}><ExceptionTag kind={e.kind} /> {F[e.feature]?.short || e.feature}{e.hard ? '' : ' (soft)'}: {exceptionText(e)}</div>
                      ))}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
        <div className="row tiny faint"><i className="d-key" style={{ width: 10, height: 10, background: 'var(--text)', borderRadius: 2, display: 'inline-block' }} /> Rules <i style={{ width: 10, height: 10, background: 'var(--earth-2)', borderRadius: '50%', display: 'inline-block', marginLeft: 10 }} /> Model</div>
      </section>

      {loo.some((v) => v.engine_held_out?.length) && (
        <section aria-labelledby="t-ml">
          <h2 id="t-ml">Engine held-out sites</h2>
          <p>The model was checked on the NASA field sites in its own site list, each held out in turn. Most of them are not Atlas precedent sites, so they are listed here rather than in the table above. Ranks use similarity alone, before the model’s land-cover ordering, so a site can rank high here yet last in the final list (Buffalo Park’s test spot sits in Flagstaff forest and town).</p>
          {loo.filter((v) => v.engine_held_out?.length).map((v) => (
            <div key={`${v.test_id}/${v.target_id}`} className="stack" style={{ marginTop: 16 }}>
              <h3 className="small" style={{ margin: 0 }}>{setLabel(v)}</h3>
              <p className="small" style={{ margin: 0 }}>
                Median percentile <b className="num">{isNum(v.median_percentile) ? v.median_percentile.toFixed(0) : '—'}</b>{v.median_over ? ` over ${v.median_over}` : ''}
                {isNum(v.top5_rate) && <> · {pct(v.top5_rate)} in the top 5{isNum(v.random_top5_rate) ? ` (random order: ${pct(v.random_top5_rate)})` : ''}</>}
              </p>
              {v.population && <p className="tiny faint" style={{ margin: 0 }}>Population: {v.population}.</p>}
              {v.warning && <p className="tiny" style={{ margin: 0, color: 'var(--warn)' }}>{v.warning}</p>}
              <div className="table-scroll"><table className="dt">
                <thead><tr><th>Engine site</th><th className="num">Rank</th><th className="num">Percentile</th><th>Atlas precedent site</th></tr></thead>
                <tbody>{v.engine_held_out.map((h) => {
                  const a = h.website_id ? A[h.website_id] : null;
                  const km = a && isNum(h.lat) && isNum(h.lon) ? distanceKm(h.lat, h.lon, a.lat, a.lon) : null;
                  return (
                    <tr key={h.site}>
                      <td>{h.name || h.site}</td>
                      <td className="num">{isNum(h.rank) ? `${h.rank} of ${h.of}` : '—'}</td>
                      <td className="num">{isNum(h.percentile) ? h.percentile.toFixed(0) : '—'}</td>
                      <td className="small">{a ? <>{a.name}{km != null && <span className="faint"> · {km.toFixed(0)} km away</span>}</> : h.website_id ? h.website_id : <span className="faint">No Atlas match</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </div>
          ))}
        </section>
      )}

      {covs.length > 0 && (
        <section aria-labelledby="t-cov">
          <h2 id="t-cov">Engine multi-site coverage</h2>
          <p>One Earth site rarely reproduces everything a mission needs. The engine picks sites one at a time: each step adds the site that covers the most requirements still open. A site counts only if a single square free of interference meets them, so conditions needed together are present together. Requirements are the mission’s pass/fail rules plus every weighted measurement inside the target’s own 10–90% range. Whatever no site covers needs a lab, a chamber or an engineered test bed. The same check runs live on the website from <b>Multi-site coverage</b> in <Link to="/explore">Explore</Link>.</p>
          {covs.map((v) => (
            <div key={`${v.test_id}/${v.target_id}`} className="stack" style={{ marginTop: 12 }}>
              <h3 className="small" style={{ margin: 0 }}>{setLabel(v)} <span className="faint">· {v.result}</span></h3>
              <ol className="small" style={{ margin: 0 }}>
                {v.steps.map((s) => <li key={s.site}><b>{s.site}</b> <span className="faint">({s.role === 'baseline' ? 'NASA site' : 'candidate'}, rank {s.rank})</span> adds {s.adds.join('; ')} <span className="faint num">→ {s.covered_so_far}/{v.n_requirements}</span></li>)}
              </ol>
              {v.not_covered?.length > 0 && <p className="tiny" style={{ margin: 0, color: 'var(--warn)' }}>No site covers: {v.not_covered.join('; ')}.</p>}
            </div>
          ))}
        </section>
      )}

      <LimitSources />

      <TargetSources />

      <section aria-labelledby="t-why">
        <h2 id="t-why">Where it falls short, and why</h2>
        <div className="callout stack small">
          <p><b>Cell scale hides field sites.</b> A 55 km cell around McMurdo’s Dry Valleys is mostly ice sheet (12 snow months), and Mauna Kea’s cell includes the wet windward island (over 1,800 mm of rain). The small, dry field site inside fails a limit its surroundings fail. Measured 2 km patches and site-scale overrides are the fix.</p>
          <p><b>Precedent sites disagree.</b> The Dry Valleys and the Atacama were both chosen for cold-and-dry testing, but they share almost nothing numerically. A model that learns from one cannot find the other: the thermal test’s held-out percentile is low for that reason.</p>
          <p><b>Some targets are beyond Earth.</b> No Earth surface reaches the lunar south pole’s day–night swing or its permanent low sun (Earth tops out near 39% of daylight hours under 10°). The ranking then finds Earth’s extreme and the report says to add a chamber test.</p>
          <p><b>Four features have no Earth layer yet</b> (rock abundance, soil strength, ice depth, salts). They count against evidence and show as Unknown everywhere until the planned layers are added. No global NASA Earth dataset measures them directly; they need site surveys.</p>
          <p><b>Target values are only as good as their source.</b> Slope and roughness for all 12 targets, and the Moon south-pole temperatures, are now measured from LOLA, MOLA and Diviner at the Earth cells’ scale. The rest are published mission values or estimates; the table above says which. Target slopes carry about ±40% uncertainty from the cross-check against Earth.</p>
          <p><b>The website and the engine see different scales.</b> The website compares 55 km cells; the engine compares 5 km squares (Moon) or 20 km squares (Mars). NASA’s own Mars landing and rover limits are set at 2 m to 1 km, finer than either, so no Earth map here can check them: that needs a site survey.</p>
        </div>
      </section>

      {ml?.model && (
        <section aria-labelledby="t-m">
          <h2 id="t-m">Model card</h2>
          <table className="dt"><tbody>
            {['name', 'version', 'kind', 'trained_on', 'inputs', 'limits'].map((k) => <tr key={k}><th style={{ width: 160, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</th><td>{String(ml.model[k] ?? '—')}</td></tr>)}
            {['score_definition', 'score_comparability', 'confidence_definition', 'small_change_definition', 'low_evidence_rule', 'aggregation'].filter((k) => ml.model[k] != null).map((k) => <tr key={k}><th style={{ width: 160, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</th><td>{String(ml.model[k])}</td></tr>)}
            {ml.model.metrics && Object.entries(ml.model.metrics).map(([k, v]) => <tr key={k}><th style={{ width: 160 }}>{k.replace(/_/g, ' ')}</th><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>)}
            <tr><th>Score sets</th><td>{ml.sets.length} sets{ml.created ? ` · built ${ml.created.slice(0, 10)}` : ''}</td></tr>
          </tbody></table>
          {ml.validation?.some((v) => !v.held_out && v.status !== 'coverage') && (
            <div className="table-scroll"><table className="dt">
              <thead><tr><th>Validation reported by the model</th><th>Result</th></tr></thead>
              <tbody>{ml.validation.filter((v) => !v.held_out && v.status !== 'coverage').map((v, k) => (
                <tr key={k}><td>{v.name || v.test_id || `check ${k + 1}`}</td>
                  <td className="small">{Object.entries(v).filter(([key]) => !['name', 'test_id'].includes(key)).map(([key, val]) => `${key.replace(/_/g, ' ')}: ${typeof val === 'object' ? JSON.stringify(val) : val}`).join(' · ')}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="small">Swap in the model trained on the separate laptop with <code>python ml/run_model.py --card model_card.json</code>. The site refuses a bundle built for a different index build.</p>
        </section>
      )}

      <section aria-labelledby="t-d">
        <h2 id="t-d">Data provenance</h2>
        <div className="table-scroll"><table className="dt">
          <thead><tr><th>Layer</th><th>Source</th><th>Resolution</th><th>Status</th></tr></thead>
          <tbody>{features.map((f) => <tr key={f.id}><td><Term id={f.id}>{f.label}</Term>{f.caveat && <div className="tiny" style={{ color: 'var(--warn)' }}>{f.caveat}</div>}</td><td className="small">{f.source}</td><td className="small">{f.res}</td><td>{f.pending ? <Status kind="unknown">Planned</Status> : <Status kind="met">Live</Status>}</td></tr>)}</tbody>
        </table></div>
        <p className="small">Precedent sites: {Object.values(A).map((a) => `${a.name} (${a.campaigns})`).join('; ')}.</p>
      </section>
    </main>
  );
}
