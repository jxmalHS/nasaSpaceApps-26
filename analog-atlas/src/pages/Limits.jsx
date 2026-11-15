import { systems, F, sources } from '../lib/catalog.js';
import { Status } from '../components/ui.jsx';

const OP = { '<=': '≤', '>=': '≥', '<': '<', '>': '>' };

/** Every pass/fail limit, per test, with the number's source. Read straight from src/config/missions.json. */
export default function Limits() {
  return (
    <main id="main" className="doc">
      <header>
        <h1>Limits and their sources</h1>
        <p>Limits are pass/fail rules about things that would spoil a test (snow, plants, rain), not about how
          Moon- or Mars-like a place is. Breaking a <b>strict</b> limit takes the site out of the ranking; breaking a
          <b> soft</b> one cuts its score by 25% and shows a warning. Where NASA publishes a number we use it, and the
          source is listed. Where NASA’s own field sites break a limit, the limit stays and the site is tagged as an
          exception on the Trust page.</p>
        <p className="small dim">The detailed model has its own land-cover limits (most trees, crops, water and buildings
          allowed per 5 km square). Those are team values based on the IGBP land-cover classes, listed in
          KNN-Model/config/missions.yaml.</p>
      </header>
      {systems.map((sys) => (
        <section key={sys.id} aria-labelledby={'lim-' + sys.id}>
          <h2 id={'lim-' + sys.id}>{sys.label}</h2>
          <div className="table-scroll"><table className="dt">
            <thead><tr><th scope="col">Test</th><th scope="col">Limit</th><th scope="col">Rule</th><th scope="col">Type</th><th scope="col">Why this number</th><th scope="col">Source</th></tr></thead>
            <tbody>
              {sys.tests.flatMap((t) => {
                const lims = Object.entries(t.interference || {});
                if (!lims.length) return [<tr key={t.id}><td>{t.label}</td><td colSpan={5} className="dim small">No limits for this test.</td></tr>];
                return lims.map(([fid, c], k) => (
                  <tr key={t.id + fid}>
                    <td>{k === 0 ? <b>{t.label}</b> : ''}</td>
                    <td>{F[fid]?.label || fid}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{OP[c.op] || c.op} {c.v}{F[fid]?.unit ? ` ${F[fid].unit}` : ''}</td>
                    <td>{c.hard ? <Status kind="fail">Strict</Status> : <Status kind="warn">Soft</Status>}</td>
                    <td className="small">{c.basis || c.why || '—'}</td>
                    <td className="small">{(c.src || []).length
                      ? (c.src || []).map((id) => sources[id]
                        ? <div key={id} style={{ marginBottom: 8 }}>{sources[id].url ? <a href={sources[id].url} target="_blank" rel="noreferrer">{sources[id].cite}</a> : sources[id].cite}</div>
                        : <div key={id} className="dim">{id}</div>)
                      : <span className="dim">Team value, no NASA source</span>}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table></div>
        </section>
      ))}
    </main>
  );
}
