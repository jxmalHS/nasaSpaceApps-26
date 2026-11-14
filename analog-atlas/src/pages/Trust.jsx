import { useEffect, useState } from 'react';
import { tests, A, T, features, F } from '../lib/catalog.js';
import { distanceKm } from '../lib/geo.js';
import { isNum, pct } from '../lib/format.js';
import { useResult, useScoring } from '../lib/results.js';
import { call, ready } from '../lib/engine.js';
import { Status, Term } from '../components/ui.jsx';
import { Link } from '../lib/router.jsx';

/** Validation shown plainly: what holds, what does not, and why. */
export default function Trust() {
  useScoring();
  const summary = useResult((r) => r.summary);
  const [rules, setRules] = useState(null);
  useEffect(() => { ready().then(() => call('validateRules', { mode: 'stress' })).then(setRules); }, []);
  const ml = summary?.ml;
  // Keyed by test AND target: ltv.wheels is validated against two targets and must not overwrite itself.
  const loo = (ml?.validation || []).filter((v) => v.held_out || v.engine_held_out);
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
                    <td>{x.status === 0 ? <Status kind="met">Passes</Status> : x.status === 2 ? <Status kind="notmet">Fails a limit</Status> : <Status kind="unknown">Unverified</Status>}</td>
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

      <section aria-labelledby="t-why">
        <h2 id="t-why">Where it falls short, and why</h2>
        <div className="callout stack small">
          <p><b>Cell scale hides field sites.</b> A 55 km cell around McMurdo’s Dry Valleys is mostly ice sheet (12 snow months), and Mauna Kea’s cell includes the wet windward island (over 1,800 mm of rain). The small, dry field site inside fails a limit its surroundings fail. Measured 2 km patches and site-scale overrides are the fix.</p>
          <p><b>Precedent sites disagree.</b> The Dry Valleys and the Atacama were both chosen for cold-and-dry testing, but they share almost nothing numerically. A model that learns from one cannot find the other: the thermal test’s held-out percentile is low for that reason.</p>
          <p><b>Some targets are beyond Earth.</b> No Earth surface reaches the lunar south pole’s day–night swing or its permanent low sun (Earth tops out near 39% of daylight hours under 10°). The ranking then finds Earth’s extreme and the report says to add a chamber test.</p>
          <p><b>Four features have no Earth layer yet</b> (rock abundance, soil strength, ice depth, salts). They count against evidence and show as Unknown everywhere until the planned layers are added.</p>
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
          {ml.validation?.some((v) => !v.held_out) && (
            <div className="table-scroll"><table className="dt">
              <thead><tr><th>Validation reported by the model</th><th>Result</th></tr></thead>
              <tbody>{ml.validation.filter((v) => !v.held_out).map((v, k) => (
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
