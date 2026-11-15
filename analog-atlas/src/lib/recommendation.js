import { STATUS } from './scoring.js';

export function recommendation(site) {
  if (site.status === STATUS.FAIL) return 'Exclude from this test while a strict mission limit is exceeded.';
  if (site.status !== STATUS.PASS) return 'Collect the missing mission evidence before shortlisting this site.';
  if (!Number.isFinite(site.ml)) return 'Rules-only candidate. Compare its measured conditions with the mission requirements before shortlisting.';
  if (!site.mlDetail || site.mlDetail.low_evidence !== false) return 'Request more site measurements before shortlisting. The model evidence is limited or unavailable.';
  if (site.warn) return 'Review the soft-limit warnings before shortlisting. The site passes the strict limits.';
  return 'Consider for field verification. Compare its model rank with other sites for this same target and test.';
}
