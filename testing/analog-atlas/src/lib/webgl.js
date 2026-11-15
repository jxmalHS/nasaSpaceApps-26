/** True when the browser can create a WebGL context (cached). Hardware acceleration off,
 *  blocked drivers or remote desktops often make this false. */
let ok;
export function hasWebGL() {
  if (ok !== undefined) return ok;
  try {
    const c = document.createElement('canvas');
    ok = !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch { ok = false; }
  return ok;
}
export const WEBGL_HELP = 'Your browser could not start WebGL (3D graphics). Turn on hardware acceleration (Chrome/Edge: Settings → System → “Use graphics acceleration when available”, then restart the browser) for the 3D globe.';
