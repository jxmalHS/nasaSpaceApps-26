import checks from '../config/limit_checks.json';

/**
 * NASA precedent-site exceptions from ml/validate_limits.py (src/config/limit_checks.json).
 * Limits stay strict; a NASA site that breaks one is tagged, never silently passed.
 *   field-site  breaks the limit at the field site itself (NASA site-scale data)
 *   cell-only   the 55 km cell breaks it, but the field site passes
 *   cell        the cell breaks it; no finer NASA data to check (rain)
 */
export const limitChecks = checks;
const BY = new Map();
for (const c of checks.checks || []) for (const e of c.exceptions || []) {
  BY.set(`${c.test_id}|${c.feature}|${e.site}`, { ...e, test_id: c.test_id, feature: c.feature, hard: c.hard });
}

/** The exception for one test, feature and NASA site, or null. */
export const exceptionFor = (testId, fid, siteId) => BY.get(`${testId}|${fid}|${siteId}`) || null;

/** All exceptions for one test and NASA site. */
export const exceptionsFor = (testId, siteId) => [...BY.values()].filter((e) => e.test_id === testId && e.site === siteId);

export const KIND_LABEL = { 'field-site': 'field site', 'cell-only': '55 km cell only', cell: 'cell, unverified' };
export const KIND_TIP = {
  'field-site': 'NASA used this site for this test, and it breaks the limit even at the field site (NASA site-scale data). The limit is kept strict and the conflict is listed.',
  'cell-only': 'NASA used this site for this test. Its 55 km cell breaks the limit, but the field site itself passes (NASA site-scale data).',
  cell: 'NASA used this site for this test. Its 55 km cell breaks the limit; no finer NASA data is available to check the field site.',
};

const fmtV = (fid, v) => (v == null ? '—' : fid === 'ndvi' ? Number(v).toFixed(2) : String(Math.round(v)));

/** "EXCEPTION · field site" chip. */
export function ExceptionTag({ kind }) {
  return (
    <span tabIndex={0} data-tooltip={KIND_TIP[kind]} style={{ display: 'inline-block', fontSize: 10, lineHeight: '16px', padding: '0 6px', borderRadius: 999, border: '1px solid var(--warn)', color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
      Exception · {KIND_LABEL[kind] || kind}
    </span>
  );
}

/** One-line evidence: values at the two scales. */
export function exceptionText(e) {
  const f = e.feature;
  if (e.kind === 'cell') return `${fmtV(f, e.cell)} on the 55 km cell; no field-site data`;
  return `${fmtV(f, e.cell)} on the 55 km cell, ${fmtV(f, e.site_scale)} at the field site${e.kind === 'cell-only' ? ' (passes)' : ''}`;
}
