/** The ranking uses one 55 km cell; 2 km patches can tell a different story.
 *  Returns null when the mean slopes agree (within 5° or 50% of the target), else how they differ. */
export function scaleMismatch(a, b) {
  const sa = a?.slopeMean, sb = b?.slopeMean;
  if (!Number.isFinite(sa) || !Number.isFinite(sb)) return null;
  if (Math.abs(sa - sb) < Math.max(5, 0.5 * sb)) return null;
  return { steeper: sa > sb, ratio: sb > 0 ? sa / sb : Infinity, a: sa, b: sb };
}
