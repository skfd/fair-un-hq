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
    """Minimise sum w * angle^p by iteratively reweighted Riemannian steps (Weiszfeld at p=1)."""
    x = centroid(xyz, w) if x0 is None else x0
    x = x / np.linalg.norm(x)
    eps = 1e-9
    for _ in range(iters):
        v, th = log_map(x, xyz)
        a = w * np.maximum(th, eps) ** (p - 2)
        step = (a[:, None] * v).sum(0) / a.sum()
        x_new = exp_map(x, step)
        if np.linalg.norm(x_new - x) < tol:
            return x_new
        x = x_new
    return x


def fair_point_global(xyz, w, p=1.0, n_seeds=400):
    """The objective is not convex on the sphere: seed from a Fibonacci sphere, refine the best few."""
    i = np.arange(n_seeds) + 0.5
    phi = np.arccos(1 - 2 * i / n_seeds)
    th = np.pi * (1 + 5**0.5) * i
    seeds = np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)
    costs = np.array([cost(s, xyz, w, p) for s in seeds])
    best = None
    for s in seeds[np.argsort(costs)[:5]]:
        x = fair_point(xyz, w, p, x0=s)
        c = cost(x, xyz, w, p)
        if best is None or c < best[1]:
            best = (x, c)
    return best
