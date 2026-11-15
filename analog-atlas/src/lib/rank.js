/** 'Top 0.01%': rank as a share of the ranked places, rounded UP so it never overclaims. */
export function topPct(rank, n) {
  if (!Number.isFinite(rank) || !Number.isFinite(n) || n <= 0) return null;
  const p = (100 * rank) / n;
  const up = (v, dp) => Math.ceil(v * 10 ** dp - 1e-9) / 10 ** dp;
  const shown = p < 0.01 ? 0.01 : p < 1 ? up(p, 2) : p < 10 ? up(p, 1) : Math.ceil(p);
  return `Top ${shown}%`;
}
