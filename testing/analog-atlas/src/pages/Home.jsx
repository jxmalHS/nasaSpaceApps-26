import { useEffect, useRef, useState } from 'react';
import { PlaneLanding, Box, ArrowRight, Pause, Play, ChevronLeft, ChevronRight, Car, Shirt, Pickaxe, Home as HomeIcon, Microscope } from 'lucide-react';
import { HomeScene } from '../components/HomeScene.js';
import { LITE } from '../lib/perf.js';
import { systems, tests, T, A, F, limits, targets } from '../lib/catalog.js';
import { setState, selectTest, scoringConfig, getState } from '../lib/store.js';
import { go, Link } from '../lib/router.jsx';
import { ready, call } from '../lib/engine.js';
import { fmt } from '../lib/format.js';
import { Bullet, Status, Term, useReducedMotion } from '../components/ui.jsx';

const ICONS = { ltv: Car, eva: Shirt, isru: Pickaxe, hab: HomeIcon, sci: Microscope, land: PlaneLanding };

// Documented pairings: a field site and the lunar terrain it rehearsed (analogs.json).
const PAIRS = [
  { earth: 'black-point', moon: 'mons-mouton-plateau', test: 'ltv.wheels', note: 'Desert RATS rover trials, 2008–2010' },
  { earth: 'haughton-crater', moon: 'connecting-ridge', test: 'eva.lights', note: 'Arctic low-sun EVA studies' },
  { earth: 'mauna-kea', moon: 'marius-hills', test: 'isru.regolith', note: 'PISCES oxygen-from-regolith tests' },
  { earth: 'sf-volcanic-field', moon: 'malapert-massif', test: 'eva.boots', note: 'JETT5 Artemis EVA rehearsal, 2024' },
  { earth: 'mcmurdo-dry-valleys', moon: 'haworth', test: 'ltv.thermal', note: 'Cold-desert drilling and cold soak' },
].map((p) => ({ ...p, earth: { ...A[p.earth], id: p.earth }, moon: { ...T[p.moon], id: p.moon } }));

export default function Home() {
  return (
    <main id="main" className="home">
      <Hero />
      <Proof />
      <Roles />
      <Flow />
      <Limits />
      <Close />
    </main>
  );
}

function Hero() {
  const canvas = useRef(null);
  const scene = useRef(null);
  const reduced = useReducedMotion();
  const [pair, setPair] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let s;
    try {
      s = scene.current = new HomeScene(canvas.current, { pairs: PAIRS, onPair: setPair, reduced: reduced || LITE, base: import.meta.env.BASE_URL });
      s.resize();
      if (!(reduced || LITE)) s.start();
      setPaused(reduced || LITE);
    } catch (e) {
      canvas.current?.parentElement?.classList.add('no-webgl');
    }
    const ro = new ResizeObserver(() => s?.resize());
    ro.observe(canvas.current);
    return () => { ro.disconnect(); s?.dispose(); };
  }, [reduced]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.reduced = reduced || paused;
    if (paused) { s.stop(); s.requestFrame(); } else { s.pairStart = performance.now(); s.start(); }
  }, [paused, reduced]);

  const p = PAIRS[pair];
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="hero-scene" aria-hidden="true">
        <canvas ref={canvas} />
      </div>
      <div className="hero-copy">
        <h1 id="hero-h">Every analog is partial.<br /><span className="earth-c">Find the part</span> your hardware needs.</h1>
        <p className="lede">
          Pick the subsystem you are testing. Analog Atlas scores 78,993 places on Earth against a Moon or Mars site,
          shows where they beat NASA’s usual field site, and says plainly what Earth cannot reproduce.
        </p>
        <Starter />
      </div>
      <figure className="hero-caption">
        <div className="row">
          <span className="tag-ab a">A</span>
          <span className="ellipsis"><b>{p.earth.name}</b> <span className="dim">· {p.earth.place}</span></span>
        </div>
        <div className="row">
          <span className="tag-ab b">B</span>
          <span className="ellipsis"><b>{p.moon.name}</b> <span className="dim">· Moon</span></span>
        </div>
        <figcaption className="small dim">{tests[p.test].label}. {p.note}.</figcaption>
        <div className="row hero-ctrl">
          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => scene.current?.next(-1)} aria-label="Previous pairing"><ChevronLeft size={16} /></button>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => setPaused((v) => !v)} aria-label={paused ? 'Play animation' : 'Pause animation'}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
          <button className="btn btn-ghost btn-sm icon-btn" onClick={() => scene.current?.next(1)} aria-label="Next pairing"><ChevronRight size={16} /></button>
          <span className="tiny faint">Orbit not to scale</span>
        </div>
      </figure>
    </section>
  );
}

/** The real first step of the app, not a link to it. */
function Starter() {
  const [sys, setSys] = useState('ltv');
  const [test, setTest] = useState('ltv.wheels');
  const [world, setWorld] = useState('moon');
  const sysTests = systems.find((s) => s.id === sys).tests;
  const valid = tests[test]?.bodies.includes(world);

  const start = () => {
    selectTest(test);
    setState({ targetId: world === 'moon' ? 'connecting-ridge' : 'jezero' });
    go('/explore');
  };

  return (
    <div className="starter" role="group" aria-labelledby="starter-h">
      <div className="starter-h" id="starter-h">What are you testing?</div>
      <div className="sys-row" role="radiogroup" aria-label="System">
        {systems.map((s) => {
          const I = ICONS[s.id] || Box;
          return (
            <button key={s.id} role="radio" aria-checked={sys === s.id} className="sys-chip"
              onClick={() => { setSys(s.id); const first = s.tests.find((t) => t.bodies.includes(world)) || s.tests[0]; setTest(first.id); if (!first.bodies.includes(world)) setWorld(first.bodies[0]); }}>
              <I size={16} aria-hidden="true" /> {s.label}
            </button>
          );
        })}
      </div>
      <div className="test-row" role="radiogroup" aria-label="Test">
        {sysTests.map((t) => (
          <button key={t.id} role="radio" aria-checked={test === t.id} className="test-chip"
            onClick={() => { setTest(t.id); if (!t.bodies.includes(world)) setWorld(t.bodies[0]); }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="row wrap starter-go">
        <span className="dim small">for use on</span>
        <div className="seg" role="radiogroup" aria-label="Target world">
          {['moon', 'mars'].map((w) => (
            <button key={w} role="radio" aria-checked={world === w} disabled={!tests[test].bodies.includes(w)} onClick={() => setWorld(w)}>
              <i className={'dot ' + w} aria-hidden="true" />{w === 'moon' ? 'the Moon' : 'Mars'}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-lg" onClick={start} disabled={!valid} data-testid="start">
          Find Earth test sites <ArrowRight size={18} />
        </button>
      </div>
      <p className="tiny faint">{tests[test].question}</p>
    </div>
  );
}

/** Live proof from the real index: a less-used site beats the usual one on the stressor that matters. */
function Proof() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        await ready();
        const cfg = { ...scoringConfig({ ...getState(), testId: 'ltv.thermal', targetId: 'connecting-ridge', mode: 'stress', weights: {}, roles: {}, thresholds: {}, rankBy: 'rules',
          filters: { minEvidence: 0.5, region: 'all', includeUnknown: false, beatsBaseline: false } }) };
        const r = await call('score', cfg);
        const top = r.list[0];
        const det = await call('detail', { cfg, i: top.i });
        if (alive) setD({ r, det, cfg });
      } catch (e) { if (alive) setErr(String(e.message || e)); }
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { run(); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(ref.current);
    return () => { alive = false; io.disconnect(); };
  }, []);

  const rows = ['lst_dtr_K', 't_mean_C', 't_range_K'];
  const det = d?.det;
  return (
    <section className="band proof" ref={ref} aria-labelledby="proof-h">
      <div className="wrap two">
        <div className="prose">
          <h2 id="proof-h">Looking like Mars is not the same as testing like Mars.</h2>
          <p>
            Take a rover’s thermal system bound for the Shackleton connecting ridge. The usual answer is the Atacama.
            Score Earth on the stressor that actually breaks hardware, the <Term id="lst_dtr_K">day–night surface swing</Term>,
            plus cold and seasonal range, and rule out anywhere wet enough to freeze-thaw.
          </p>
          <p>
            The winner is not on anyone’s list of famous analogs. And no place on Earth reaches the ridge’s swing at all, so
            the report tells you to pair the field test with a thermal-vacuum chamber.
          </p>
          <button className="btn" onClick={() => { if (d) { setState({ ...d.cfg, sel: det.id }); go('/explore'); } }} disabled={!d}>
            Open this result <ArrowRight size={16} />
          </button>
        </div>
        <div className="proof-card panel" aria-live="polite">
          {!d && !err && <div className="stack" style={{ padding: 18 }}><div className="skeleton" style={{ height: 20, width: '60%' }} /><div className="skeleton" style={{ height: 120 }} /></div>}
          {err && <div className="empty">Could not load the Earth index: {err}</div>}
          {d && (
            <>
              <div className="proof-head">
                <div>
                  <div className="row"><span className="tag-ab a">A</span><b>{det.place ? `Near ${det.place}` : 'Unnamed cell'}, {det.country}</b></div>
                  <div className="small dim">Rank #1 of {d.r.scored.toLocaleString()} passing cells · score {Math.round(det.score * 100)}</div>
                </div>
                <Status kind="beats" />
              </div>
              <table className="proof-table">
                <thead><tr><th scope="col">Stressor</th><th scope="col" className="earth-c">This site</th><th scope="col">{det.baseline ? det.baseline.name.split(',')[0] : 'Baseline'}</th><th scope="col" className="target-c">Ridge</th></tr></thead>
                <tbody>
                  {rows.map((fid) => {
                    const row = det.rows.find((r) => r.fid === fid);
                    const col = d.r.envelope.find((e) => e.fid === fid);
                    return (
                      <tr key={fid}>
                        <th scope="row"><Term id={fid}>{F[fid].short}</Term></th>
                        <td className="num earth-c">{fmt(row?.x, fid)}</td>
                        <td className="num">{fmt(det.baseline?.values?.[fid], fid)}</td>
                        <td className="num target-c">{fmt(row?.tv, fid)}</td>
                        <td className="bullet-cell"><Bullet fid={fid} x={row?.x} t={row?.tv} b={det.baseline?.values?.[fid]} min={col?.min} max={col?.max} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="small dim proof-foot">
                Blue band: everything Earth offers. Red tick: the ridge. White ring: NASA’s usual site.
                Rain/snow here: {fmt(det.values.precip_mm, 'precip_mm')}, under the 250 mm/yr limit.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Roles() {
  return (
    <section className="band roles" aria-labelledby="roles-h">
      <div className="wrap">
        <h2 id="roles-h">Every condition gets one of three jobs.</h2>
        <p className="lede-2">A site does not have to be Moon-like overall. It has to be right on what the test stresses, and harmless on what could spoil it.</p>
        <div className="roles-grid">
          <div className="role-col">
            <div className="role-name earth-c">Target</div>
            <p>Must match or beat the Moon or Mars value. Scored against it in real units.</p>
            <ul><li>Slope</li><li>Roughness</li><li>Rock abundance</li></ul>
          </div>
          <div className="role-col">
            <div className="role-name">Ignored</div>
            <p>Allowed to be un-lunar because this test does not care.</p>
            <ul><li>Air temperature</li><li>Day–night swing</li></ul>
          </div>
          <div className="role-col">
            <div className="role-name" style={{ color: 'var(--warn)' }}>Interference</div>
            <p>Need not match, but must stay below a limit or it causes a different failure.</p>
            <ul><li>Snow season over 9 months</li><li>Vegetation above NDVI 0.3</li><li>Wet soil</li></ul>
          </div>
        </div>
        <p className="small dim">Example: rover wheel traction for the lunar south pole. Every role, weight and limit loads with sensible defaults and can be overridden.</p>
      </div>
    </section>
  );
}

function Flow() {
  const steps = [
    ['Pick the hardware', 'Rover, suit, drill, habitat or instrument, then the specific test. The interface starts from what you are testing, not from a map.'],
    ['Check the weights', 'Defaults load with a reason for each feature. Strict requirements pass, fail, or stay unknown. Unknown never passes.'],
    ['Find candidates', 'All 78,993 land cells are scored instantly. The best show on the globe and in a ranked list, beside NASA’s usual site.'],
    ['Compare and report', 'Put an Earth site and the target side by side at the same scale, then export a report with sources and limits.'],
  ];
  return (
    <section className="band flow" aria-labelledby="flow-h">
      <div className="wrap">
        <h2 id="flow-h">From subsystem to field site in four steps.</h2>
        <ol className="flow-list">
          {steps.map(([h, p], i) => (
            <li key={h}><span className="flow-n num">{i + 1}</span><div><h3>{h}</h3><p className="dim">{p}</p></div></li>
          ))}
        </ol>
        <div className="row wrap" style={{ gap: 12 }}>
          <button className="btn btn-primary" onClick={() => { go('/explore'); setTimeout(() => setState({ tourStep: 0 }), 300); }}>Take the 4-step tour <ArrowRight size={16} /></button>
          <Link className="btn btn-ghost" to="/trust">How we validate</Link>
        </div>
      </div>
    </section>
  );
}

function Limits() {
  return (
    <section className="band limits" aria-labelledby="limits-h">
      <div className="wrap">
        <h2 id="limits-h">What no place on Earth can give you.</h2>
        <p className="lede-2">Every site report states these. Field tests are paired with the lab or chamber that covers the rest.</p>
        <div className="limits-grid">
          {['moon', 'mars'].map((b) => (
            <div key={b} className={'limits-col ' + (b === 'moon' ? 'side-target' : 'side-target')}>
              <h3>{b === 'moon' ? 'The Moon' : 'Mars'}</h3>
              <dl>
                {limits[b].map((l) => (
                  <div key={l.id} className="lim">
                    <dt><span>{l.title}</span><span className={'earth-can ' + l.earth}>{l.earth === 'no' ? 'Earth: no' : 'Earth: partly'}</span></dt>
                    <dd className="dim small">{l.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="band close" aria-labelledby="close-h">
      <div className="wrap close-in">
        <h2 id="close-h">Start with the subsystem.</h2>
        <p className="dim">{targets.length} Moon and Mars targets · {Object.keys(tests).length} subsystem tests · 15 measured Earth layers from NASA MODIS, POWER/MERRA-2 and SRTM-derived terrain</p>
        <button className="btn btn-primary btn-lg" onClick={() => go('/explore')}>Open the atlas <ArrowRight size={18} /></button>
      </div>
      <footer className="foot wrap small faint">
        <span>Analog Atlas · NASA Space Apps Challenge 2026</span>
        <span>Data: NASA MODIS, NASA POWER (MERRA-2), MERRA-2 dust, AWS Terrarium DEM, GLiM, Natural Earth. Textures: NASA Blue Marble, LRO, Viking.</span>
        <Link to="/trust">Validation and sources</Link>
      </footer>
    </section>
  );
}
