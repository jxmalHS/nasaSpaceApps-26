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
import { VERDICT_KIND, strengthFromChance, chanceRandomMedian, topFromPercentile, stabilityStrength, median } from '../lib/verdict.js';

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
      <h3 id="t-lim">Limits and their sources</h3>
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
              {hard.length > 0 && <div tabIndex={0} data-tooltip={hard.join(', ')}><Status kind="fail" size={11}>Strict</Status> {hard.length} test{hard.length > 1 ? 's' : ''}</div>}
              {soft.length > 0 && <div tabIndex={0} data-tooltip={soft.join(', ')} style={{ marginTop: 4 }}><Status kind="warn" size={11}>Soft</Status> {soft.length} test{soft.length > 1 ? 's' : ''}</div>}
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
              ? srcOf(c).map((id) => <div key={id} style={{ marginBottom: 4 }}><a href={S[id].url} target="_blank" rel="noreferrer" data-tooltip={S[id].cite}>{shortCite(S[id].cite)}</a></div>)
              : <span className="faint">—</span>}</td>
            <td className="small">
              {checked === 0 ? <span className="faint">No NASA site for this test yet</span>
                : exceptions.length === 0 ? <Status kind="met" size={11}>All {checked} pass</Status>
                : <details><summary style={{ listStyle: 'none', cursor: 'pointer' }} data-tooltip="Click to see which NASA sites"><Status kind="warn" size={11}>{exceptions.length} of {checked} exceptions ▾</Status></summary>
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
              <td key={f} className="num" tabIndex={0} data-tooltip={v?.src || ''}>{v?.v == null ? '—' : v.v}{F[f]?.unit ? ` ${F[f].unit}` : ''}
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

  const setLabel = (v) => `${tests[v.test_id]?.label || v.test_id} · ${T[v.target_id]?.name || v.target_id}`;

  // ---- one verdict scale for every check (src/lib/verdict.js) ----
  const ruleRows = (rules || []).map((t) => {
    const ps = t.sites.filter((x) => x.representative && x.percentile != null).map((x) => x.percentile);
    const med = median(ps);
    return { t, n: ps.length, med, strength: med == null ? null : strengthFromChance(chanceRandomMedian(med, ps.length)) };
  });
  const engineRows = loo.filter((v) => isNum(v.median_percentile)).map((v) => ({ v, strength: strengthFromChance(v.chance_random_does_as_well) }));
  const stab = (ml?.validation || []).filter((v) => /stability/i.test(v.name || '')).map((v) => {
    const m = /unchanged in (\d+) of (\d+)/.exec(v.result || '');
    return m ? { v, kept: +m[1], total: +m[2], strength: stabilityStrength(+m[1], +m[2]) } : null;
  }).filter(Boolean);
  const Badge = ({ s }) => (s ? <Status kind={VERDICT_KIND[s]}>{s}</Status> : <span className="faint">—</span>);
  const count = (rows, s) => rows.filter((r) => r.strength === s).length;

  return (
    <main id="main" className="doc trust">
      <header className="stack">
        <h1>References</h1>
        <p>How far you can trust the ranking, and where every number comes from. Each check gets the same verdict:
          <Status kind="met">Strong</Status> <Status kind="warn">Moderate</Status> <Status kind="notmet">Weak</Status>.
          The data are real, the method is open, and missing data is never counted as a pass.</p>
      </header>

      <section aria-labelledby="t-r">
        <h2 id="t-r">1. Does it find NASA’s own test sites?</h2>
        <p>The system is never told where NASA tests. We then check where NASA’s own field sites land among all {summary ? summary.n.toLocaleString() : '~79,000'} places on Earth.
          The verdict asks how often places picked at random would do as well: rarely means <b>Strong</b>.</p>
        <div className="table-scroll"><table className="dt">
          <thead><tr><th>Test</th><th className="num">NASA sites</th><th>NASA’s sites land in</th><th>Verdict</th></tr></thead>
          <tbody>
            {!rules && <tr><td colSpan={4}><div className="skeleton" style={{ height: 120 }} /></td></tr>}
            {ruleRows.map(({ t, n, med, strength }) => (
              <tr key={t.testId}>
                <td><b>{tests[t.testId].label}</b> <span className="tiny faint">{T[t.targetId]?.body === 'mars' ? 'Mars' : 'Moon'}</span></td>
                <td className="num">{n || '—'}</td>
                <td>{med == null ? <span className="faint">No usable NASA site for this test</span> : <b className="num">{topFromPercentile(med)}</b>}{med != null && <span className="tiny faint"> of Earth (typical site)</span>}</td>
                <td><Badge s={strength} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {rules && <p className="small">{count(ruleRows, 'Strong')} strong, {count(ruleRows, 'Moderate')} moderate, {count(ruleRows, 'Weak')} weak. Most tests have only a few NASA sites, so even a good result rarely reaches “Strong”: there are too few sites to prove more.</p>}

        {engineRows.length > 0 && (<>
          <h3 className="small" style={{ marginTop: 12 }}>Checked again by the detailed model</h3>
          <p className="small">The model looks closer (5 km squares on the Moon, 20 km on Mars) but at fewer places: the {(() => { const ns = engineRows.map(({ v }) => v.engine_held_out?.[0]?.of).filter(isNum); return ns.length ? `${Math.min(...ns)} to ${Math.max(...ns)}` : 'few'; })()} sites it analysed for each test, not all of Earth.</p>
          <div className="table-scroll"><table className="dt">
            <thead><tr><th>Test</th><th className="num">NASA sites</th><th>NASA’s sites beat</th><th>Verdict</th></tr></thead>
            <tbody>{engineRows.map(({ v, strength }) => (
              <tr key={`${v.test_id}/${v.target_id}`}>
                <td><b>{tests[v.test_id]?.label || v.test_id}</b> <span className="tiny faint">{T[v.target_id]?.name || v.target_id}</span></td>
                <td className="num">{v.engine_held_out?.length || '—'}</td>
                <td><b className="num">{v.median_percentile.toFixed(0)}%</b><span className="tiny faint"> of the {v.engine_held_out?.[0]?.of ?? ''} sites analysed (typical site)</span></td>
                <td><Badge s={strength} /></td>
              </tr>))}</tbody>
          </table></div>
          <p className="small faint">Where it is weak: NASA chooses field sites for road access, safety and nearness to its teams as well as terrain. The model measures terrain only, and we did not tune it to push NASA’s sites up.</p>
        </>)}
      </section>

      {stab.length > 0 && (
        <section aria-labelledby="t-st">
          <h2 id="t-st">2. Is the ranking stable?</h2>
          <p>We nudge the inputs (weights ±20%, coarser pixels, shifted squares) and see whether the #1 site stays #1.</p>
          <div className="table-scroll"><table className="dt">
            <thead><tr><th>Test</th><th>#1 site stays #1</th><th>Verdict</th></tr></thead>
            <tbody>{stab.map(({ v, kept, total, strength }) => (
              <tr key={`${v.test_id}/${v.target_id}`}>
                <td><b>{tests[v.test_id]?.label || v.test_id}</b> <span className="tiny faint">{T[v.target_id]?.name || v.target_id}</span></td>
                <td><b className="num">{kept} of {total}</b> <span className="tiny faint">small changes</span></td>
                <td><Badge s={strength} /></td>
              </tr>))}</tbody>
          </table></div>
          <p className="small faint">For the website’s own ranking, use the Stability button in <Link to="/explore">Explore</Link>: it re-runs any setup with jittered weights.</p>
        </section>
      )}

      <div className="stack">
        <h2 style={{ marginBottom: 0 }}>3. Where do the numbers come from?</h2>
        <LimitSources />
        <details>
          <summary><b>Moon and Mars target values</b> <span className="small faint">(measured, published or estimated)</span></summary>
          <TargetSources />
        </details>
      </div>

      <section aria-labelledby="t-why">
        <h2 id="t-why">4. What it cannot do</h2>
        <ul className="stack">
          <li><b>Big squares hide small sites.</b> Rankings use 55 km squares; the 2 km check in Explore catches the worst cases.</li>
          <li><b>Rocks, soil strength, ground ice and salts have no Earth map yet.</b> They show as unknown, never as a pass.</li>
          <li><b>Some Moon and Mars conditions exceed anything on Earth</b> (gravity, vacuum, the lunar day–night swing). The ranking finds Earth’s closest, and the site report says what needs a lab or chamber.</li>
          <li><b>Terrain is not the only reason NASA picks a site.</b> Roads, safety and permits are not measured.</li>
        </ul>
      </section>

      <details>
        <summary><h2 style={{ display: 'inline' }}>Technical details</h2> <span className="small faint">every NASA site, model card, data sources</span></summary>
        <div className="stack" style={{ marginTop: 16 }}>
          <section aria-labelledby="t-sites">
            <h3 id="t-sites">Every NASA site, test by test</h3>
            <div className="table-scroll"><table className="dt">
              <thead><tr><th>Test</th><th>NASA site</th><th>Website rank</th><th>Model</th><th>Limits at 55 km</th></tr></thead>
              <tbody>{(rules || []).flatMap((t) => t.sites.map((x, k) => {
                const mv = mlVal[`${t.testId}/${t.targetId}`]?.held_out?.find((h) => h.site === x.id);
                return (
                  <tr key={t.testId + x.id}>
                    <td>{k === 0 ? <b>{tests[t.testId].label}</b> : ''}</td>
                    <td>{x.name}{!x.representative && <div className="tiny" style={{ color: 'var(--warn)' }}>nearest square is {Math.round(x.offsetKm)} km away: not counted</div>}</td>
                    <td className="num">{x.percentile == null ? '—' : topFromPercentile(x.percentile)}</td>
                    <td className="num">{mv?.percentile == null ? '—' : `beats ${mv.percentile.toFixed(0)}%`}</td>
                    <td>{x.status === 0 ? <Status kind="met">Passes</Status> : x.status === 2 ? <Status kind="notmet">Fails a limit</Status> : <Status kind="unknown">Unverified</Status>}
                      {x.representative && exceptionsFor(t.testId, x.id).map((e) => (
                        <div key={e.feature} className="tiny" style={{ marginTop: 4 }}><ExceptionTag kind={e.kind} /> {F[e.feature]?.short || e.feature}: {exceptionText(e)}</div>
                      ))}
                    </td>
                  </tr>
                );
              }))}</tbody>
            </table></div>
          </section>

          {loo.some((v) => v.engine_held_out?.length) && (
            <section aria-labelledby="t-ml">
              <h3 id="t-ml">Detailed model: each NASA site</h3>
              {loo.filter((v) => v.engine_held_out?.length).map((v) => (
                <div key={`${v.test_id}/${v.target_id}`} className="stack" style={{ marginTop: 12 }}>
                  <h4 className="small" style={{ margin: 0 }}>{setLabel(v)}</h4>
                  <div className="table-scroll"><table className="dt">
                    <thead><tr><th>NASA site</th><th className="num">Rank</th><th className="num">Beats</th></tr></thead>
                    <tbody>{v.engine_held_out.map((h) => (
                      <tr key={h.site}><td>{h.name || h.site}</td><td className="num">{isNum(h.rank) ? `${h.rank} of ${h.of}` : '—'}</td><td className="num">{isNum(h.percentile) ? `${h.percentile.toFixed(0)}%` : '—'}</td></tr>
                    ))}</tbody>
                  </table></div>
                  {v.agreement_note && <p className="tiny faint" style={{ margin: 0 }}>{v.agreement_note}</p>}
                </div>
              ))}
            </section>
          )}

          {covs.length > 0 && (
            <section aria-labelledby="t-cov">
              <h3 id="t-cov">Detailed model: which sites cover which requirements</h3>
              <p className="small">One site rarely covers everything. Sites are added one at a time, each covering the most requirements still open; whatever no site covers needs a lab or a chamber.</p>
              {covs.map((v) => (
                <div key={`${v.test_id}/${v.target_id}`} className="stack" style={{ marginTop: 8 }}>
                  <h4 className="small" style={{ margin: 0 }}>{setLabel(v)} <span className="faint">· {v.result}</span></h4>
                  <ol className="small" style={{ margin: 0 }}>
                    {v.steps.map((s) => <li key={s.site}><b>{s.site}</b> <span className="faint">({s.role === 'baseline' ? 'NASA site' : 'candidate'})</span> adds {s.adds.join('; ')}</li>)}
                  </ol>
                  {v.not_covered?.length > 0 && <p className="tiny" style={{ margin: 0, color: 'var(--warn)' }}>No site covers: {v.not_covered.join('; ')}.</p>}
                </div>
              ))}
            </section>
          )}

          {ml?.model && (
            <section aria-labelledby="t-m">
              <h3 id="t-m">Model card</h3>
              <table className="dt"><tbody>
                {['name', 'version', 'kind', 'trained_on', 'inputs', 'limits', 'score_definition', 'confidence_definition', 'small_change_definition', 'low_evidence_rule']
                  .filter((k) => ml.model[k] != null)
                  .map((k) => <tr key={k}><th style={{ width: 170, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</th><td className="small">{String(ml.model[k])}</td></tr>)}
                <tr><th>Score sets</th><td className="small">{ml.sets.length} sets{ml.created ? ` · built ${ml.created.slice(0, 10)}` : ''}</td></tr>
              </tbody></table>
            </section>
          )}

          <section aria-labelledby="t-d">
            <h3 id="t-d">Data sources for each map layer</h3>
            <div className="table-scroll"><table className="dt">
              <thead><tr><th>Layer</th><th>Source</th><th>Resolution</th><th>Status</th></tr></thead>
              <tbody>{features.map((f) => <tr key={f.id}><td><Term id={f.id}>{f.label}</Term></td><td className="small">{f.source}</td><td className="small">{f.res}</td><td>{f.pending ? <Status kind="unknown">Planned</Status> : <Status kind="met">Live</Status>}</td></tr>)}</tbody>
            </table></div>
            <p className="small faint">Earth index: {summary ? `${summary.n.toLocaleString()} land squares at 0.5°, build ${summary.fingerprint}` : '…'}. NASA field sites: {Object.values(A).map((a) => `${a.name} (${a.campaigns})`).join('; ')}.</p>
          </section>
        </div>
      </details>
    </main>
  );
}
