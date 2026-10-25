"""Reference maths for fair points on the sphere. The web page ports this; this is the truth.

Points are unit vectors in R^3. A population grid becomes (xyz, w): one row per populated cell.
"""
import numpy as np

R_KM = 6371.0088


def to_xyz(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def to_latlon(x):
    x = x / np.linalg.norm(x)
    return np.degrees(np.arcsin(np.clip(x[2], -1, 1))), np.degrees(np.arctan2(x[1], x[0]))


def angles(x, xyz):
    return np.arccos(np.clip(xyz @ x, -1.0, 1.0))


def cost(x, xyz, w, p):
    """Mean of (great-circle distance in km)^p, raised to 1/p, so it reads as a distance."""
    d = angles(x, xyz) * R_KM
    return (np.sum(w * d**p) / np.sum(w)) ** (1 / p)


def log_map(x, xyz):
    """Tangent vectors at x pointing to each cell, length = angle."""
    th = angles(x, xyz)
    t = xyz - np.outer(xyz @ x, x)
    n = np.linalg.norm(t, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        v = np.where(n[:, None] > 1e-12, t * (th / n)[:, None], 0.0)
    return v, th


def exp_map(x, v):
    n = np.linalg.norm(v)
    if n < 1e-15:
        return x
    y = np.cos(n) * x + np.sin(n) * v / n
    return y / np.linalg.norm(y)


def centroid(xyz, w):
    """3D centre of mass. Its norm < 1; (1 - norm) * R is the depth below the surface."""
    return (w[:, None] * xyz).sum(0) / w.sum()


def fair_point(xyz, w, p=1.0, x0=None, iters=500, tol=1e-12):
    """Minimise sum w * angle^p on the sphere.

    p <= 2: iteratively reweighted Riemannian steps (Weiszfeld at p=1), which descend there.
    p > 2: the reweighting overshoots and wanders, so use gradient descent with backtracking.
    """
    x = centroid(xyz, w) if x0 is None else x0
    x = x / np.linalg.norm(x)
    eps = 1e-9
    if p > 2:
        return _descend(xyz, w, p, x, iters, tol)
    for _ in range(iters):
        v, th = log_map(x, xyz)
        a = w * np.maximum(th, eps) ** (p - 2)
        step = (a[:, None] * v).sum(0) / a.sum()
        x_new = exp_map(x, step)
        if np.linalg.norm(x_new - x) < tol:
            return x_new
        x = x_new
    return x


def _descend(xyz, w, p, x, iters, tol):
    f = lambda y: np.sum(w * angles(y, xyz) ** p)
    fx, t = f(x), 0.1
    for _ in range(iters):
        v, th = log_map(x, xyz)
        g = ((w * th ** (p - 2))[:, None] * v).sum(0) / w.sum()  # minus the gradient / p, scaled
        while t > 1e-14:
            y = exp_map(x, t * g / max(np.linalg.norm(g), 1e-300))
            fy = f(y)
            if fy < fx:
                break
            t /= 2
        else:
            return x
        if np.linalg.norm(y - x) < tol:
            return y
        x, fx, t = y, fy, t * 2
    return x


def quantile_distance(x, xyz, w, q):
    """Distance (km) within which a share q of people live, seen from x."""
    d = angles(x, xyz)
    o = np.argsort(d)
    c = np.cumsum(w[o]) / w.sum()
    return d[o][min(np.searchsorted(c, q), len(d) - 1)] * R_KM


def worst_off_point(xyz, w, q=0.999, n_seeds=4000, seed=0):
    """Clipped minimax: the point minimising the distance that covers a share q of humanity.

    q=1 is decided by the remotest few islands, so the page clips. Non-smooth: seed + random refine.
    """
    rng = np.random.default_rng(seed)
    best = min(fibonacci(n_seeds), key=lambda s: quantile_distance(s, xyz, w, q))
    b, step = quantile_distance(best, xyz, w, q), 0.05
    while step > 1e-4:
        improved = False
        for _ in range(40):
            c = best + rng.normal(size=3) * step
            c /= np.linalg.norm(c)
            cb = quantile_distance(c, xyz, w, q)
            if cb < b:
                best, b, improved = c, cb, True
        if not improved:
            step /= 2
    return best, b


def fibonacci(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = np.pi * (1 + 5**0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)


def fair_point_global(xyz, w, p=1.0, n_seeds=400):
    """The objective is not convex on the sphere: seed from a Fibonacci sphere, refine the best few."""
    seeds = fibonacci(n_seeds)
    costs = np.array([cost(s, xyz, w, p) for s in seeds])
    best = None
    for s in seeds[np.argsort(costs)[:5]]:
        x = fair_point(xyz, w, p, x0=s)
        c = cost(x, xyz, w, p)
        if best is None or c < best[1]:
            best = (x, c)
    return best
