/**
 * Threshold table: every pass/fail limit, its NASA reference and its NASA-site exceptions.
 *
 *   node scripts/threshold-table.mjs          writes docs/THRESHOLDS.md and docs/thresholds.csv
 *   node scripts/threshold-table.mjs --check  exits 1 if those files are out of date
 *
 * Built only from data files, so it cannot drift from what the app scores with:
 *   src/config/missions.json      website limits (v, op, hard), `src` ids, `basis`, `sources`
 *   src/config/limit_checks.json  NASA precedent-site check (ml/validate_limits.py)
 *   src/config/features.json      labels, units, data layers
 *   ../KNN-Model/config/missions.yaml  engine limits (interference + mandatory lines)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const J = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const ENGINE_YAML = new URL('../KNN-Model/config/missions.yaml', root);

/** Engine limits from missions.yaml. Reads only the two flow-style line formats the file uses. */
export function engineLimits(text = readFileSync(ENGINE_YAML, 'utf8')) {
  const out = [];
  let mission = null, block = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    let m;
    if ((m = line.match(/^([a-z0-9_]+):\s*$/))) { mission = m[1]; block = null; continue; }
    if (/^\s{4}interference:\s*$/.test(line)) { block = 'interference'; continue; }
    if (/^\s{2}mandatory:\s*$/.test(line)) { block = 'mandatory'; continue; }
    if (/^\s{0,4}[a-z_]+:/.test(line) && !/^\s{6}/.test(line) && !/^\s{4}-/.test(line)) block = null;
    if (block === 'interference' && (m = line.match(/^\s{6}([a-z_]+):\s*\{max:\s*([\d.]+)\}\s*$/))) {
      out.push({ mission, kind: 'interference', feature: m[1], rule: 'max', v: Number(m[2]), unit: 'share of 5 km tile' });
    } else if (block === 'mandatory' && (m = line.match(/^\s{4}-\s*\{feature:\s*([a-z_0-9]+),\s*(max_abs_diff|max|min):\s*([\d.]+),\s*unit:\s*([a-zA-Z_0-9]+)\}\s*$/))) {
      out.push({ mission, kind: 'mandatory', feature: m[1], rule: m[2], v: Number(m[3]), unit: m[4] });
    }
  }
  return out;
}

// Engine evidence, measured 14 Nov 2026 at each NASA baseline's official coordinates
// (nearest 5 km tile in KNN-Model/results/*/tiles.csv; 5 NASA sites per mission).
const ENGINE_REF = {
  tree_frac: 'NASA MCD12Q1 C6.1 guide, Table 3: Savannas "Tree cover 10-30%", Woody Savannas "30-60%"',
  cropland_frac: 'No NASA number (MCD12Q1 Table 3: Croplands "At least 60%")',
  builtup_frac: 'No NASA number (MCD12Q1 Table 3: Urban "At least 30% impervious")',
  snow_ice_frac: 'No NASA number (MCD12Q1 Table 3: Permanent Snow and Ice "At least 60% ... 10 months")',
  water_frac: 'No NASA number (MCD12Q1 Table 3: Water Bodies "At least 60%")',
};
const ENGINE_EVIDENCE = {
  'tree_frac|0.3': 'Cinder Lake 81%, Buffalo Park 59% break it',
  'tree_frac|0.2': 'Cinder Lake 81%, Buffalo Park 59% break it',
  'moon_rover_mons_mouton|slope_p90': '3 of 5 break it', 'moon_rover_mons_mouton|frac_steep': '2 of 5', 'moon_rover_mons_mouton|rough_small': '2 of 5',
  'moon_rover_south_pole|slope_p90': '4 of 5', 'moon_rover_south_pole|frac_steep': '4 of 5', 'moon_rover_south_pole|rough_small': '2 of 5',
  'moon_landing_hazards_south_pole|pit_density': '4 of 5', 'moon_landing_hazards_south_pole|relief': 'all 5',
  'moon_rover_thermal_south_pole|slope_p90': '4 of 5', 'moon_rover_thermal_south_pole|temp_range_mean': '3 of 5',
};

const KIND = { 'field-site': 'EXCEPTION · field site', 'cell-only': 'EXCEPTION · 55 km cell only', cell: 'EXCEPTION · cell, unverified' };
const cellEsc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const csvEsc = (s) => { const t = String(s ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const fmt = (fid, v) => (v == null ? '—' : fid === 'ndvi' ? Number(v).toFixed(2) : String(Math.round(v)));

export function buildRows() {
  const missions = J('src/config/missions.json');
  const checks = J('src/config/limit_checks.json');
  const F = Object.fromEntries(J('src/config/features.json').features.map((f) => [f.id, f]));
  const A = Object.fromEntries(J('src/config/analogs.json').sites.map((a) => [a.id, a.name]));
  const CH = Object.fromEntries(checks.checks.map((c) => [`${c.test_id}|${c.feature}`, c]));
  const rows = [];
  for (const s of missions.systems) for (const t of s.tests) for (const [fid, l] of Object.entries(t.interference || {})) {
    const c = CH[`${t.id}|${fid}`];
    const reps = c ? c.precedents.filter((p) => p.representative) : [];
    rows.push({
      test_id: t.id, test: t.label, feature: fid, feature_label: F[fid]?.label || fid, unit: F[fid]?.unit === 'NDVI' ? '' : F[fid]?.unit || '',
      op: l.op, v: l.v, strength: l.hard ? 'strict' : 'soft', was: l.was ?? null,
      data_layer: F[fid]?.source || '', sources: (l.src || []).join('; '), basis: l.basis || '',
      nasa_sites_checked: reps.length,
      exceptions: (c?.exceptions || []).map((e) => ({ ...e, name: A[e.site] || e.site,
        text: e.kind === 'cell' ? `${fmt(fid, e.cell)} on the 55 km cell; no field-site data` : `${fmt(fid, e.cell)} on the 55 km cell, ${fmt(fid, e.site_scale)} at the field site` })),
    });
  }
  return { rows, missions, checks, F };
}

export function buildTable() {
  const { rows, missions, checks, F } = buildRows();
  const S = missions.sources || {};
  const eng = existsSync(ENGINE_YAML) ? engineLimits() : [];
  const sym = (op) => (op === '<=' ? '≤' : '≥');
  const L = [];
  L.push('# Threshold table', '');
  L.push('Generated by `node scripts/threshold-table.mjs` from `src/config/missions.json`, `src/config/limit_checks.json` and `../KNN-Model/config/missions.yaml`. Do not edit by hand: `npm test` fails if this file is out of date.', '');
  L.push('**Strict** = breaking it marks the site "Fails a limit". **Soft** = score × 0.75 and a warning. Limits are kept strict; every NASA site that breaks one is listed as a tagged exception:', '');
  L.push('- `EXCEPTION · field site`: breaks it at the field site itself (NASA site-scale data)', '- `EXCEPTION · 55 km cell only`: the 55 km cell breaks it, the field site passes', '- `EXCEPTION · cell, unverified`: the cell breaks it; no finer NASA data to check (rain)', '');

  // 1. Summary by feature and value.
  L.push('## 1. Website limits by feature', '', '| Feature | Limit | Strict for | Soft for | NASA sites checked | Exceptions | Sources |', '|---|---|---|---|---|---|---|');
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.feature}|${r.op}|${r.v}`;
    if (!groups.has(k)) groups.set(k, { r, strict: [], soft: [], checked: 0, exc: 0, src: new Set() });
    const g = groups.get(k);
    g[r.strength].push(r.test); g.checked += r.nasa_sites_checked; g.exc += r.exceptions.length;
    r.sources.split('; ').filter(Boolean).forEach((x) => g.src.add(x));
  }
  for (const g of [...groups.values()].sort((a, b) => a.r.feature.localeCompare(b.r.feature) || a.r.v - b.r.v)) {
    L.push(`| ${g.r.feature_label} | ${sym(g.r.op)} ${g.r.v}${g.r.unit ? ' ' + g.r.unit : ''} | ${g.strict.join(', ') || '—'} | ${g.soft.join(', ') || '—'} | ${g.checked} | ${g.exc} | ${[...g.src].join(', ')} |`);
  }

  // 2. Every limit.
  L.push('', '## 2. Every limit, test by test', '', '| Test | Feature | Limit | Type | Why this number | NASA site exceptions |', '|---|---|---|---|---|---|');
  for (const r of rows) {
    const exc = r.exceptions.length ? r.exceptions.map((e) => `\`${KIND[e.kind]}\` ${e.name}: ${e.text}`).join('<br>') : `none (${r.nasa_sites_checked} NASA site${r.nasa_sites_checked === 1 ? '' : 's'} checked)`;
    L.push(`| ${cellEsc(r.test)} | ${cellEsc(r.feature_label)} | ${sym(r.op)} ${r.v}${r.unit ? ' ' + r.unit : ''}${r.was != null ? ` (was ${r.was})` : ''} | ${r.strength} | ${cellEsc(r.basis)} | ${cellEsc(exc)} |`);
  }

  // 3. Engine.
  L.push('', '## 3. Engine (KNN) limits', '', 'Read from `KNN-Model/config/missions.yaml`. NASA-site evidence was measured 14 Nov 2026 at each NASA baseline\'s official coordinates (nearest 5 km tile, 5 NASA sites per mission).', '');
  L.push('| Mission | Rule | Limit | NASA reference | NASA sites that break it |', '|---|---|---|---|---|');
  for (const e of eng) {
    const lim = e.rule === 'max_abs_diff' ? `within ${e.v} ${e.unit} of target` : e.rule === 'max' ? `≤ ${e.v * (e.unit === 'share of 5 km tile' ? 100 : 1)}${e.unit === 'share of 5 km tile' ? '%' : ' ' + e.unit}` : `≥ ${e.v} ${e.unit}`;
    const ref = e.kind === 'interference' ? ENGINE_REF[e.feature] || 'No NASA number' : 'No NASA source (team example value)';
    const ev = ENGINE_EVIDENCE[`${e.feature}|${e.v}`] || ENGINE_EVIDENCE[`${e.mission}|${e.feature}`] || 'none';
    L.push(`| ${e.mission} | ${e.feature} | ${lim} | ${cellEsc(ref)} | ${ev} |`);
  }

  // 4. Sources.
  L.push('', '## 4. Sources', '');
  for (const [id, s] of Object.entries(S)) L.push(`- **${id}**: ${s.cite}. ${s.url}  `, `  ${s.says}`);
  L.push('', `Precedent check: ${checks.method}`, '');

  const head = ['test_id', 'test', 'feature', 'op', 'value', 'unit', 'type', 'was', 'sources', 'basis', 'nasa_sites_checked', 'exceptions'];
  const csv = [head.join(',')].concat(rows.map((r) => [r.test_id, r.test, r.feature, r.op, r.v, r.unit, r.strength, r.was ?? '', r.sources, r.basis, r.nasa_sites_checked,
    r.exceptions.map((e) => `${KIND[e.kind]} ${e.name}: ${e.text}`).join(' | ')].map(csvEsc).join(','))).join('\n') + '\n';
  return { md: L.join('\n') + '\n', csv, rows, eng };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { md, csv } = buildTable();
  const mdPath = new URL('docs/THRESHOLDS.md', root), csvPath = new URL('docs/thresholds.csv', root);
  if (process.argv.includes('--check')) {
    const same = existsSync(mdPath) && existsSync(csvPath) && readFileSync(mdPath, 'utf8') === md && readFileSync(csvPath, 'utf8') === csv;
    console.log(same ? 'threshold table up to date' : 'threshold table OUT OF DATE: run node scripts/threshold-table.mjs');
    process.exit(same ? 0 : 1);
  }
  mkdirSync(new URL('docs/', root), { recursive: true });
  writeFileSync(mdPath, md); writeFileSync(csvPath, csv);
  console.log('wrote docs/THRESHOLDS.md and docs/thresholds.csv');
}
