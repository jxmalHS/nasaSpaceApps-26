/**
 * Lite mode for low-power machines: flat map instead of the globe, no continuous homepage
 * animation. Turned on automatically for ≤2 CPU cores or ≤2 GB memory, or reduced-motion,
 * and overridable with ?lite=1 / ?lite=0 (remembered).
 */
function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lite');
    if (q === '1' || q === '0') localStorage.setItem('aa-lite', q);
    const saved = localStorage.getItem('aa-lite');
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch { /* storage blocked */ }
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  return cores <= 2 || mem <= 2 || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export const LITE = typeof window !== 'undefined' ? detect() : false;
export function setLite(on) {
  try { localStorage.setItem('aa-lite', on ? '1' : '0'); } catch { /* ignore */ }
  location.reload();
}
