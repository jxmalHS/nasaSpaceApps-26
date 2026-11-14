"""Made-up terrain for tests (no internet needed)."""
import numpy as np


def bumpy(n: int, amplitude: float, seed: int) -> np.ndarray:
    """Smooth random hills: random noise blurred by a Fourier filter."""
    rng = np.random.default_rng(seed)
    f = np.hypot(*np.meshgrid(np.fft.fftfreq(n), np.fft.fftfreq(n)))
    f[0, 0] = 1
    z = np.real(np.fft.ifft2(np.fft.fft2(rng.normal(size=(n, n))) / f ** 1.5))
    return (z - z.mean()) / z.std() * amplitude


def cratered(n: int, px: float, seed: int, n_craters: int = 60) -> np.ndarray:
    """Bumpy ground plus bowl-shaped craters."""
    rng = np.random.default_rng(seed)
    z = bumpy(n, 20, seed)
    yy, xx = np.mgrid[0:n, 0:n] * px
    for _ in range(n_craters):
        r = rng.uniform(200, 1500)
        cx, cy = rng.uniform(0, n * px, 2)
        d = np.hypot(xx - cx, yy - cy) / r
        z += np.where(d < 1, 0.4 * r * (d ** 2 - 1), 0.0)
    return z
