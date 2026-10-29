"""Build web/data/*.js from the raw HYDE, ISIMIP and GHSL downloads, exactly per web/DATA.md.

    .venv/Scripts/python scripts/build_data.py [--cache DIR] [--workers N]

Outputs cells.js, series-{hyde,isimip-hist,ghsl,ssp1,ssp3,ssp5}.js, reference.js and checks.md (all
under web/data/). --cache keeps the GHSL block sums between runs (they take a few minutes).
"""
import argparse
import base64
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import fair  # noqa: E402  (the reference maths; never reimplemented here)

RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "web", "data")
GHSL_ZIP = os.path.join(RAW, "ghsl", "GHS_POP_E{y}_GLOBE_R2023A_4326_30ss_V1_0.zip")
GHSL_TIF = "GHS_POP_E{y}_GLOBE_R2023A_4326_30ss_V1_0.tif"
H1 = os.path.join(RAW, "isimip", "population_histsoc_30arcmin_annual_1850_1900.nc")
H2 = os.path.join(RAW, "isimip", "population_histsoc_30arcmin_annual_1901_2021.nc")
SSP = os.path.join(RAW, "isimip", "population_ssp{}_30arcmin_annual_2015_2100.nc")
HYDE = os.path.join(RAW, "hyde", "3.3", "{}_{}.asc.gz")   # popc / urbc, from scripts/fetch_hyde.py

NROW, NCOL = 360, 720
LMAX = float(np.log1p(5e7))
QMAX = 65535

# HYDE's own steps before ISIMIP takes over: millennia, then centuries, then decades. Shipped as
# they are rather than resampled to 5 years, so the timeline is uneven before 1850.
HYDE_YEARS = list(range(-10000, 0, 1000)) + list(range(0, 1700, 100)) + list(range(1700, 1850, 10))
HIST_YEARS = list(range(1850, 1971, 5))
GHSL_YEARS = list(range(1975, 2031, 5))
SSP_YEARS = list(range(2035, 2101, 5))
SSPS = (1, 3, 5)

META = {
    "hyde": dict(label="HYDE 3.3 population",
                 source="Klein Goldewijk / Utrecht University and PBL, History Database of the Global "
                        "Environment (via a Kaggle mirror)",
                 url="https://www.kaggle.com/datasets/ilyenkov/hyde-3-3"),
    "isimip-hist": dict(label="ISIMIP3a histsoc population (HYDE 3.2 based)",
                        source="ISIMIP, Inter-Sectoral Impact Model Intercomparison Project",
                        url="https://data.isimip.org/"),
    "ghsl": dict(label="GHSL GHS-POP R2023A", source="EC JRC, Global Human Settlement Layer",
                 url="https://ghsl.jrc.ec.europa.eu/"),
}
for _s in SSPS:
    META[f"ssp{_s}"] = dict(label=f"ISIMIP3b SSP{_s} population",
                            source="ISIMIP, Inter-Sectoral Impact Model Intercomparison Project",
                            url="https://data.isimip.org/")

LOG = []


def say(s=""):
    print(s, flush=True)
    LOG.append(s)


# ---------------------------------------------------------------- grid helpers

def cell_latlon(ids, res=0.5):
    ncol = int(round(360 / res))
    r, c = np.divmod(ids, ncol)
    return 90 - res / 2 - res * r, -180 + res / 2 + res * c


def cell_xyz(ids, res=0.5):
    return fair.to_xyz(*cell_latlon(ids, res))


def km(a, b):
    """Great-circle km between two [lat, lon]."""
    return float(fair.angles(fair.to_xyz(*a), fair.to_xyz(*b)[None])[0] * fair.R_KM)


def quantise(p):
    q = np.rint(np.log1p(np.maximum(p, 0)) / LMAX * QMAX)
    return np.clip(q, 0, QMAX).astype(np.uint16)


def dequantise(q):
    return np.expm1(q.astype(np.float64) / QMAX * LMAX)


def b64(a, dtype):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode("ascii")


# ---------------------------------------------------------------- GHSL

def ghsl_job(year, cache):
    """Block sums of one GHSL epoch at 0.1 deg (1800x3600) and 0.5 deg, read in tile-aligned strips."""
    if cache:
        f = os.path.join(cache, f"ghsl_{year}.npz")
        if os.path.exists(f):
            z = np.load(f, allow_pickle=True)
            return year, z["g05"], z["g01"], z["info"].item()
    import rasterio
    from rasterio.windows import Window

    path = f"zip://{GHSL_ZIP.format(y=year)}!{GHSL_TIF.format(y=year)}"
    # GDAL's default block cache is 5% of RAM per process; with a pool of readers that exhausts commit.
    with rasterio.Env(GDAL_CACHEMAX=256), rasterio.open(path) as r:
        t = r.transform
        px = 1 / 120
        assert abs(t.a - px) < 1e-9 and abs(t.e + px) < 1e-9, t
        # Pixel edges sit ~0.05 px off the 30" grid; snap. Row/col offsets into the ideal +-180/+-90 grid.
        row_off_f = (90 - t.f) / px
        col_off_f = (t.c + 180) / px
        row_off, col_off = int(round(row_off_f)), int(round(col_off_f))
        info = dict(bounds=tuple(r.bounds), shape=r.shape, nodata=r.nodata, dtype=r.dtypes[0],
                    row_off=row_off, col_off=col_off, row_off_f=row_off_f, col_off_f=col_off_f)
        assert abs(row_off_f - row_off) < 0.1 and abs(col_off_f - col_off) < 0.1, info
        H, W = r.shape
        # Ideal 30" columns k_ideal = k + col_off; keep 0..43199, the rest wraps across the antimeridian.
        k = np.arange(W) + col_off
        keep = (k >= 0) & (k < 43200)
        assert keep.sum() == 43200, (W, col_off)
        k0 = int(np.argmax(keep))
        g01 = np.zeros((1800, 3600))
        edge = {}
        n_neg = n_nan = 0
        neg_sum = 0.0
        raw_min = np.inf
        step = 256
        for r0 in range(0, H, step):
            h = min(step, H - r0)
            a = r.read(1, window=Window(0, r0, W, h)).astype(np.float64)
            raw_min = min(raw_min, float(np.nanmin(a)))
            bad_nan = ~np.isfinite(a)
            bad_neg = (a < 0) & ~bad_nan
            n_nan += int(bad_nan.sum())
            n_neg += int(bad_neg.sum())
            neg_sum += float(a[bad_neg].sum())
            if r.nodata is not None:
                a[a == r.nodata] = 0
            a[bad_nan | bad_neg] = 0
            for j in (k0, k0 + 43199):
                edge[int(j)] = edge.get(int(j), 0.0) + float(a[:, j].sum())
            cs = a[:, k0:k0 + 43200].reshape(h, 3600, 12).sum(2)
            for j in np.where(~keep)[0]:
                # Extra columns past +-180 hold distinct (not duplicated) people: wrap them, don't drop.
                edge[int(j)] = edge.get(int(j), 0.0) + float(a[:, j].sum())
                cs[:, ((j + col_off) % 43200) // 12] += a[:, j]
            rows01 = (np.arange(r0, r0 + h) + row_off) // 12
            np.add.at(g01, rows01, cs)
        info.update(n_neg=n_neg, n_nan=n_nan, neg_sum=neg_sum, raw_min=raw_min, edge_cols=edge,
                    kept_cols=(k0, k0 + 43199))
    g05 = g01.reshape(NROW, 5, NCOL, 5).sum((1, 3))
    if year != 2020:
        g01 = np.zeros(0)
    if cache:
        os.makedirs(cache, exist_ok=True)
        np.savez(os.path.join(cache, f"ghsl_{year}.npz"), g05=g05, g01=g01, info=np.array(info, dtype=object))
    return year, g05, g01, info


# ---------------------------------------------------------------- HYDE

def hyde_grid(var, year):
    """One HYDE grid (5 arcmin, people per cell) summed into 0.5 deg blocks; also the count of
    negative cells it masked."""
    import gzip
    with gzip.open(HYDE.format(var, year), "rt") as f:
        head = dict(next(f).split() for _ in range(6))
        a = np.loadtxt(f, dtype=np.float64)
    assert (int(head["ncols"]), int(head["nrows"])) == (4320, 2160), head
    assert float(head["xllcorner"]) == -180 and float(head["yllcorner"]) == -90, head
    assert a.shape == (2160, 4320), a.shape
    nodata = float(head["NODATA_value"])
    n_neg = int(((a < 0) & (a != nodata)).sum())
    a[(a == nodata) | ~np.isfinite(a) | (a < 0)] = 0
    # ASCII grids are written north row first, as the contract wants.
    return a.reshape(NROW, 6, NCOL, 6).sum((1, 3)), n_neg


def hyde_job(year):
    tot, n1 = hyde_grid("popc", year)
    urb, n2 = hyde_grid("urbc", year)
    return year, tot, urb, n1 + n2


# ---------------------------------------------------------------- ISIMIP

class Isimip:
    def __init__(self):
        import xarray as xr
        self.ds = {}
        for name, path, base in [("h1", H1, 1850), ("h2", H2, 1850)] + [(f"ssp{s}", SSP.format(s), 2015) for s in SSPS]:
            ds = xr.open_dataset(path, engine="h5netcdf", decode_times=False)
            assert f"since {base}" in ds.time.units, ds.time.units
            lat, lon = ds.lat.values, ds.lon.values
            # Contract: row 0 north (89.75), col 0 west (-179.75). Flip if a file is stored otherwise.
            flip_lat = lat[0] < lat[-1]
            assert np.allclose(np.sort(lat)[::-1], 89.75 - 0.5 * np.arange(NROW))
            assert np.allclose(lon, -179.75 + 0.5 * np.arange(NCOL)), "lon order"
            self.ds[name] = (ds, base, flip_lat, set(ds.data_vars))
        self.orient = {k: ("south-up, flipped" if v[2] else "north-up, as contract") for k, v in self.ds.items()}

    def _get(self, name, var, year):
        ds, base, flip, vars_ = self.ds[name]
        if var not in vars_:
            return None
        tv = ds.time.values
        k = int(np.argmin(np.abs(tv + base - year)))
        assert abs(tv[k] + base - year) < 0.01, (name, year, tv[k])
        a = ds[var].isel(time=k).values.astype(np.float64)
        a = np.where(np.isfinite(a) & (a < 1e19), a, 0.0)
        a = np.maximum(a, 0.0)
        return a[::-1] if flip else a

    def hist_name(self, year):
        return "h1" if year <= 1900 else "h2"

    def get(self, series, var, year):
        name = self.hist_name(year) if series == "hist" else series
        return self._get(name, var, year)


def share_with_fallback(urban, total, need):
    """Per-cell urban share urban/total. Where total==0 but `need` (people elsewhere) > 0, borrow the
    pooled share of the nearest ring (radius 1..5 cells, lon wraps); else 0 (rural). Returns share, stats."""
    with np.errstate(invalid="ignore", divide="ignore"):
        s = np.where(total > 0, urban / total, np.nan)
    s = np.clip(s, 0, 1)
    miss = np.isnan(s) & (need > 0)
    stats = dict(cells_missing=int(miss.sum()), people_missing=float(need[miss].sum()))
    filled = np.zeros_like(miss)
    for rad in range(1, 6):
        U = np.zeros_like(total)
        T = np.zeros_like(total)
        up = np.pad(urban, ((rad, rad), (0, 0)))
        tp = np.pad(total, ((rad, rad), (0, 0)))
        for dr in range(-rad, rad + 1):
            u_r = up[rad + dr:rad + dr + NROW]
            t_r = tp[rad + dr:rad + dr + NROW]
            for dc in range(-rad, rad + 1):
                U += np.roll(u_r, dc, axis=1)
                T += np.roll(t_r, dc, axis=1)
        take = miss & ~filled & (T > 0)
        s[take] = np.clip(U[take] / T[take], 0, 1)
        filled |= take
    rest = miss & ~filled
    s[np.isnan(s)] = 0.0
    stats.update(people_neighbour=float(need[filled].sum()), people_zero=float(need[rest].sum()))
    return s, stats


# ---------------------------------------------------------------- reference maths (worker side)

def ref_job(key, ids, w, res, full):
    xyz = cell_xyz(ids, res)
    t = time.time()
    x1, c1 = fair.fair_point_global(xyz, w, 1)
    out = dict(median=[float(v) for v in fair.to_latlon(x1)], median_cost_km=float(c1), pop=float(w.sum()))
    if full:
        x2, _ = fair.fair_point_global(xyz, w, 2)
        c = fair.centroid(xyz, w)
        xw, bw = fair.worst_off_point(xyz, w, q=0.999)
        out.update(p2=[float(v) for v in fair.to_latlon(x2)],
                   centroid=[float(v) for v in fair.to_latlon(c)],
                   depth_km=float((1 - np.linalg.norm(c)) * fair.R_KM),
                   worst999=[float(v) for v in fair.to_latlon(xw)], worst999_km=float(bw))
    out["secs"] = time.time() - t
    return key, out


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    T0 = time.time()

    gx = ProcessPoolExecutor(max_workers=min(args.workers, 6))
    ghsl_futs = [gx.submit(ghsl_job, y, args.cache) for y in GHSL_YEARS]
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        hyde_futs = [ex.submit(hyde_job, y) for y in HYDE_YEARS + [1850]]

        isi = Isimip()
        say("ISIMIP orientation: " + ", ".join(f"{k} {v}" for k, v in isi.orient.items()))
        for k, (ds, base, flip, vars_) in isi.ds.items():
            say(f"ISIMIP {k}: vars {sorted(vars_)}")

        # frames: key -> dict(series, year, conf, total(360x720 float), urban_share or None)
        frames = {}
        raw_total = {}
        notes = []
        isi_checks = []

        def isi_frame(series, year):
            tot = isi.get(series, "total-population", year)
            urb = isi.get(series, "urban-population", year)
            rur = isi.get(series, "rural-population", year)
            if urb is not None and rur is not None:
                m = tot > 0
                rel = np.abs(urb + rur - tot)[m].sum() / tot.sum()
                isi_checks.append((series, year, tot.sum(), urb.sum() / tot.sum(), rel, tot.max()))
            return tot, urb

        hyde_neg = 0
        hyde_urban = {}
        for f in hyde_futs:
            y, tot, urb, n_neg = f.result()
            hyde_neg += n_neg
            if y < 1850:
                # 10,000 BC has no town dwellers at all: no split rather than an empty city-folk map.
                share = share_with_fallback(urb, tot, tot)[0] if urb.sum() > 0 else None
                hyde_urban[y] = (float(urb.sum()), float((urb > tot * (1 + 1e-9) + 1e-6).sum()))
                frames[f"hyde/{y}"] = dict(series="hyde", year=y, conf="modelled", total=tot, share=share)
            else:
                hyde_1850 = tot
        say(f"HYDE read: {len(HYDE_YEARS)} frames, {hyde_neg} negative cells masked")
        for y in HIST_YEARS:
            tot, urb = isi_frame("hist", y)
            share, _ = share_with_fallback(urb, tot, tot) if urb is not None else (None, None)
            frames[f"isimip-hist/{y}"] = dict(series="isimip-hist", year=y, conf="modelled", total=tot, share=share)
        for s in SSPS:
            for y in SSP_YEARS:
                tot, urb = isi_frame(f"ssp{s}", y)
                share = share_with_fallback(urb, tot, tot)[0] if urb is not None else None
                if urb is None:
                    notes.append(f"ssp{s} has no urban-population: urban null")
                frames[f"ssp{s}/{y}"] = dict(series=f"ssp{s}", year=y, conf="projected", total=tot, share=share)

        # seam-only frames (not shipped)
        seam = {"hyde/1850": hyde_1850}
        seam["isimip-hist/1975"] = isi.get("hist", "total-population", 1975)
        seam["isimip-hist/2020"] = isi.get("hist", "total-population", 2020)
        for s in SSPS:
            seam[f"ssp{s}/2030"] = isi.get(f"ssp{s}", "total-population", 2030)
        annual = {f"hist-annual/{y}": isi.get("hist", "total-population", y) for y in range(1895, 1907)}

        # GHSL
        ghsl = {}
        g01_2020 = None
        ghsl_info = {}
        for f in ghsl_futs:
            y, g05, g01, info = f.result()
            ghsl[y] = g05
            ghsl_info[y] = info
            say(f"GHSL {y}: total {g05.sum() / 1e9:.4f} B, masked {info['n_neg']} negative + {info['n_nan']} NaN px")
            if y == 2020:
                g01_2020 = g01
        gx.shutdown()
        say(f"GHSL read in {time.time() - T0:.0f}s")

        urban_stats = {}
        ssp_urban_spread = {}
        for y in GHSL_YEARS:
            tot = ghsl[y]
            if y <= 2020:
                u, t = isi.get("hist", "urban-population", y), isi.get("hist", "total-population", y)
                src = f"ISIMIP histsoc {y}"
            else:
                us = [isi.get(f"ssp{s}", "urban-population", y) for s in SSPS]
                ts = [isi.get(f"ssp{s}", "total-population", y) for s in SSPS]
                if any(v is None for v in us):
                    u = t = None
                else:
                    u, t = sum(us), sum(ts)  # pooled share across SSP1/3/5
                    with np.errstate(invalid="ignore", divide="ignore"):
                        sh = np.stack([np.where(tt > 0, uu / tt, np.nan) for uu, tt in zip(us, ts)])
                    spread = np.nanmax(sh, 0) - np.nanmin(sh, 0)
                    m = np.isfinite(spread) & (tot > 0)
                    ssp_urban_spread[y] = dict(
                        wmean=float((spread[m] * tot[m]).sum() / tot[m].sum()),
                        p99=float(np.percentile(spread[m], 99)),
                        glob=[float((uu.sum() / tt.sum())) for uu, tt in zip(us, ts)])
                src = f"pooled ISIMIP SSP1/3/5 {y}"
            if u is None:
                share = None
                urban_stats[y] = dict(src="none", people_missing=0, people_neighbour=0, people_zero=0)
            else:
                share, st = share_with_fallback(u, t, tot)
                st["src"] = src
                st["glob"] = float((share * tot).sum() / tot.sum())
                urban_stats[y] = st
            frames[f"ghsl/{y}"] = dict(series="ghsl", year=y, conf="observed" if y <= 2020 else "projected",
                                       total=tot, share=share)

        # alignment proof: GHSL 2020 people landing in ISIMIP-2020-empty cells, as built and shifted one cell
        isi20 = isi.get("hist", "total-population", 2020)
        align = []
        for dr, dc in [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]:
            g = np.roll(ghsl[2020], (dr, dc), axis=(0, 1))
            align.append((dr, dc, float(g[isi20 <= 0].sum())))

        # ---- quantise, union
        order = ([f"hyde/{y}" for y in HYDE_YEARS] + [f"isimip-hist/{y}" for y in HIST_YEARS] + [f"ghsl/{y}" for y in GHSL_YEARS]
                 + [f"ssp{s}/{y}" for s in SSPS for y in SSP_YEARS])
        union = np.zeros(NROW * NCOL, bool)
        qs = {}
        for k in order:
            fr = frames[k]
            raw_total[k] = float(fr["total"].sum())
            q = quantise(fr["total"]).ravel()
            qs[k] = q
            union |= q > 0
        ids = np.nonzero(union)[0].astype(np.uint32)
        say(f"union of populated cells: {len(ids)}")
        max_cell = max(float(frames[k]["total"].max()) for k in order)
        n_sat = sum(int((frames[k]["total"] >= 5e7).sum()) for k in order)

        # ---- reference jobs
        ref_futs = []
        deq = {}
        for k in order:
            q = qs[k][ids]
            w = dequantise(q)
            deq[k] = w
            m = w > 0
            ref_futs.append(ex.submit(ref_job, k, ids[m].astype(np.int64), w[m], 0.5, True))
        extra = {}
        for k, g in list(seam.items()) + list(annual.items()):
            w = dequantise(quantise(g).ravel())
            m = w > 0
            extra[k] = float(w.sum())
            ref_futs.append(ex.submit(ref_job, k, np.nonzero(m)[0], w[m], 0.5, False))
        # resolution check, raw floats on both sides
        g05 = ghsl[2020].ravel()
        m05 = g05 > 0
        ref_futs.append(ex.submit(ref_job, "res/0.5", np.nonzero(m05)[0], g05[m05], 0.5, False))
        g01 = g01_2020.ravel()
        m01 = g01 > 0
        n01 = int(m01.sum())
        ref_futs.append(ex.submit(ref_job, "res/0.1", np.nonzero(m01)[0], g01[m01], 0.1, False))
        res = {}
        for f in ref_futs:
            k, o = f.result()
            res[k] = o
        say(f"reference done in {time.time() - T0:.0f}s (slowest frame {max(v['secs'] for v in res.values()):.0f}s)")

    # ---------------------------------------------------------------- write js
    hdr = "// Generated by scripts/build_data.py. Do not edit; see web/DATA.md.\n"
    boot = "window.FAIR = window.FAIR || {};\n"
    with open(os.path.join(OUT, "cells.js"), "w", newline="\n") as f:
        f.write(hdr + boot)
        f.write(f"FAIR.LMAX = {LMAX!r};  // log1p(5e7)\n")
        f.write(f"FAIR.cells = \"{b64(ids, '<u4')}\";  // {len(ids)} cells\n")

    for sid in ["hyde", "isimip-hist", "ghsl"] + [f"ssp{s}" for s in SSPS]:
        ks = [k for k in order if frames[k]["series"] == sid]
        with open(os.path.join(OUT, f"series-{sid}.js"), "w", newline="\n") as f:
            f.write(hdr + boot)
            f.write("FAIR.addSeries({\n")
            f.write(f"  id: {json.dumps(sid)},\n")
            for m in ("label", "source", "url"):
                f.write(f"  {m}: {json.dumps(META[sid][m])},\n")
            f.write("  frames: [\n")
            for k in ks:
                fr = frames[k]
                q = qs[k][ids]
                if fr["share"] is None:
                    u = "null"
                else:
                    sh = fr["share"].ravel()[ids]
                    uu = np.where(q > 0, np.rint(sh * 255), 0).astype(np.uint8)
                    u = '"' + b64(uu, "u1") + '"'
                f.write(f"    {{ year: {fr['year']}, confidence: \"{fr['conf']}\",\n"
                        f"      total: \"{b64(q, '<u2')}\",\n      urban: {u} }},\n")
            f.write("  ],\n});\n")

    ref_out = {}
    for k in order:
        o = res[k]
        r5 = lambda ll: [round(ll[0], 5), round(ll[1], 5)]
        ref_out[k] = dict(median=r5(o["median"]), median_cost_km=round(o["median_cost_km"], 2), p2=r5(o["p2"]),
                          centroid=r5(o["centroid"]), depth_km=round(o["depth_km"], 2),
                          worst999=r5(o["worst999"]), worst999_km=round(o["worst999_km"], 2),
                          pop=int(round(o["pop"])))
    with open(os.path.join(OUT, "reference.js"), "w", newline="\n") as f:
        f.write(hdr + boot + "FAIR.reference = {\n")
        for k in order:
            f.write(f"  {json.dumps(k)}: {json.dumps(ref_out[k])},\n")
        f.write("};\n")

    # ---------------------------------------------------------------- checks.md
    L = []
    P = L.append
    P("# Build checks\n")
    P(f"Generated by `scripts/build_data.py` in {time.time() - T0:.0f} s. "
      f"{len(ids)} cells in the union, {len(order)} shipped frames.\n")

    # 1. per-frame table
    trails = {f"ssp{s}": [f"hyde/{y}" for y in HYDE_YEARS] + [f"isimip-hist/{y}" for y in HIST_YEARS] + [f"ghsl/{y}" for y in GHSL_YEARS]
              + [f"ssp{s}/{y}" for y in SSP_YEARS] for s in SSPS}
    step = {}
    for tr in trails.values():
        for a, b in zip(tr, tr[1:]):
            d = km(res[a]["median"], res[b]["median"])
            step[b] = (a, d, d / (frames[b]["year"] - frames[a]["year"]))
    med_step = {s: float(np.median([step[k][2] for k in tr[1:]])) for s, tr in trails.items()}

    def flagged(k):
        s = next(s for s, t in trails.items() if k in t)
        tr = trails[s]
        i = tr.index(k)
        d = step[k][2]
        nb = [step[tr[j]][2] for j in (i - 1, i + 1) if 0 < j < len(tr)]
        f = []
        if nb and d > 2 * max(nb) and d > 4:
            f.append("2x neighbours")
        if d > 3 * med_step[s] and d > 4:
            f.append(f"3x {s} trail median")
        return ", ".join(f)

    P("## 1. Frames\n")
    P(f"`km moved` is the p=1 median's great-circle move since the previous frame of the same trail "
      f"(hyde -> isimip-hist -> ghsl -> each SSP). Steps are uneven (1000, 100, 10, then 5 years), so the "
      f"flag rule works on speed: a step is flagged if its km/yr is more than 2x both its neighbouring "
      f"steps', or more than 3x the median of its trail "
      f"({', '.join(f'{s} {v:.1f} km/yr' for s, v in med_step.items())}), and over 4 km/yr. "
      f"Totals are of the quantised data as shipped; `raw` is before quantisation.\n")
    P("The worst-off (99.9%) point is not part of the jump rule: its objective has two basins, near the Levant "
      "and near the North Pole, and the answer flips between them (checked with more seeds and other RNG "
      "seeds: the flips are real, not search misses). Its column is shown so the flips are visible.\n")
    P("| series | year | conf | total (M) | raw (M) | median lat | median lon | km moved | km/yr | from | flag | worst999 | worst999 km |")
    P("|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|")
    for k in order:
        fr = frames[k]
        o = res[k]
        st = step.get(k)
        P(f"| {fr['series']} | {fr['year']} | {fr['conf']} | {o['pop'] / 1e6:,.1f} | {raw_total[k] / 1e6:,.1f} | "
          f"{o['median'][0]:.3f} | {o['median'][1]:.3f} | "
          f"{'' if st is None else f'{st[1]:.0f}'} | {'' if st is None else f'{st[2]:.2f}'} | "
          f"{'' if st is None else st[0]} | "
          f"{flagged(k) if st else ''} | {o['worst999'][0]:.1f}, {o['worst999'][1]:.1f} | {o['worst999_km']:.0f} |")
    P("")
    P("### The 1900/1901 file boundary, annually\n")
    P("isimip-hist 1850-1900 comes from one file and 1901-2021 from another. Annual p=1 medians around the join:\n")
    P("| year | file | total (M) | median lat | median lon | km since previous year |")
    P("|---|---|---:|---:|---:|---:|")
    prev = None
    for y in range(1895, 1907):
        o = res[f"hist-annual/{y}"]
        d = "" if prev is None else f"{km(prev, o['median']):.1f}"
        P(f"| {y} | {'1850_1900' if y <= 1900 else '1901_2021'} | {o['pop'] / 1e6:,.1f} | "
          f"{o['median'][0]:.3f} | {o['median'][1]:.3f} | {d} |")
        prev = o["median"]
    P("")

    # 2. seams
    P("## 2. Seams\n")
    P("| seam | A | B | km between medians | total A (M) | total B (M) | total B/A |")
    P("|---|---|---|---:|---:|---:|---:|")

    def seam_row(name, a, b):
        ra, rb = res[a], res[b]
        P(f"| {name} | {a} | {b} | {km(ra['median'], rb['median']):.0f} | {ra['pop'] / 1e6:,.0f} | "
          f"{rb['pop'] / 1e6:,.0f} | {rb['pop'] / ra['pop']:.3f} |")

    seam_row("1850", "hyde/1850", "isimip-hist/1850")
    seam_row("1840 HYDE -> 1850 ISIMIP (as drawn)", "hyde/1840", "isimip-hist/1850")
    seam_row("1975", "isimip-hist/1975", "ghsl/1975")
    seam_row("1970->1975 inside ISIMIP", "isimip-hist/1970", "isimip-hist/1975")
    seam_row("1970 ISIMIP -> 1975 GHSL (as drawn)", "isimip-hist/1970", "ghsl/1975")
    seam_row("2020", "isimip-hist/2020", "ghsl/2020")
    for s in SSPS:
        seam_row(f"2030 ssp{s}", "ghsl/2030", f"ssp{s}/2030")
    for s in SSPS:
        seam_row(f"2030->2035 ssp{s} inside ISIMIP", f"ssp{s}/2030", f"ssp{s}/2035")
    P("")
    P("(`hyde/1850`, `isimip-hist/1975`, `isimip-hist/2020` and `sspN/2030` are computed for these checks only; they are "
      "not shipped.)\n")

    # 3. resolution
    a, b = res["res/0.5"], res["res/0.1"]
    P("## 3. Resolution\n")
    P("GHSL 2020, raw block sums (not quantised), populated cells only, p=1 median via `fair_point_global`:\n")
    P("| grid | cells | median lat | median lon | mean km |")
    P("|---|---:|---:|---:|---:|")
    P(f"| 0.5 deg | {int(m05.sum())} | {a['median'][0]:.4f} | {a['median'][1]:.4f} | {a['median_cost_km']:.1f} |")
    P(f"| 0.1 deg | {n01} | {b['median'][0]:.4f} | {b['median'][1]:.4f} | {b['median_cost_km']:.1f} |")
    P(f"\nDifference: **{km(a['median'], b['median']):.2f} km**. Shipped (quantised) 0.5 deg vs raw 0.5 deg: "
      f"{km(res['ghsl/2020']['median'], a['median']):.3f} km.\n")

    # 4. sizes
    P("## 4. File sizes\n")
    P("| file | bytes | MB |")
    P("|---|---:|---:|")
    tot_b = 0
    for fn in ["cells.js", "series-hyde.js", "series-isimip-hist.js", "series-ghsl.js"] + [f"series-ssp{s}.js" for s in SSPS] + ["reference.js"]:
        n = os.path.getsize(os.path.join(OUT, fn))
        tot_b += n
        P(f"| {fn} | {n:,} | {n / 1e6:.2f} |")
    P(f"| **all** | {tot_b:,} | {tot_b / 1e6:.2f} |\n")

    # 5. data notes
    P("## 5. Input checks\n")
    i0 = ghsl_info[2020]
    P(f"- **GHSL raster bounds are not +-180/+-90.** {i0['shape'][1]} x {i0['shape'][0]} px, bounds "
      f"left {i0['bounds'][0]:.6f}, bottom {i0['bounds'][1]:.6f}, right {i0['bounds'][2]:.6f}, "
      f"top {i0['bounds'][3]:.6f}. Pixel edges sit {i0['row_off_f'] - i0['row_off']:+.3f} px (rows) / "
      f"{i0['col_off_f'] - i0['col_off']:+.3f} px (cols) off the 30\" grid, snapped. The raster starts "
      f"{i0['row_off']} px below 90N (so 0.5 deg rows 0 and 359 are empty) and has one extra column per side "
      f"(offset {i0['col_off']}); columns {i0['kept_cols'][0]}..{i0['kept_cols'][1]} are the 43200 kept, "
      f"so 60x60 (and 12x12) blocks line up exactly with the ISIMIP / DATA.md grid.")
    for y in GHSL_YEARS:
        i = ghsl_info[y]
        same = (i["shape"] == i0["shape"] and (i["row_off"], i["col_off"]) == (i0["row_off"], i0["col_off"])
                and np.allclose(i["bounds"], i0["bounds"], atol=1e-9, rtol=0))
        P(f"  - {y}: total {ghsl[y].sum() / 1e9:.4f} B, dtype {i['dtype']}, nodata tag {i['nodata']}, "
          f"raw min {i['raw_min']}, masked {i['n_neg']} negative px (sum {i['neg_sum']:.0f}) + {i['n_nan']} NaN px, "
          f"people in raster columns {{{', '.join(f'{c}: {v:.0f}' for c, v in sorted(i['edge_cols'].items()))}}}"
          f"{'' if same else ', DIFFERENT GRID'}")
    P("- Alignment, shown empirically: GHSL 2020 people falling in cells where ISIMIP 2020 has nobody, as built "
      "and with GHSL shifted by one 0.5 deg cell (row + is south, col + is east):\n")
    P("| row shift | col shift | people in ISIMIP-empty cells (M) |")
    P("|---:|---:|---:|")
    for dr, dc, v in align:
        P(f"| {dr:+d} | {dc:+d} | {v / 1e6:.2f} |")
    P("")
    P(f"- ISIMIP orientation: {', '.join(f'{k} {v}' for k, v in isi.orient.items())}.")
    worst = max(isi_checks, key=lambda t: t[4])
    P(f"- ISIMIP urban + rural vs total: worst relative mismatch {worst[4]:.2e} ({worst[0]} {worst[1]}).")
    P(f"- Largest 0.5 deg cell in any shipped frame: {max_cell / 1e6:.2f} M people (quantisation ceiling 50 M; "
      f"{n_sat} cells saturated).")
    P("- Urban share for GHSL frames: ISIMIP histsoc share of the same year for 1975-2020; for 2025/2030 the "
      "share pooled over SSP1/3/5 (sum urban / sum total). Cells where GHSL has people but the ISIMIP "
      "source has none borrow the pooled share of the nearest ring of ISIMIP cells (radius 1-5), else 0 "
      "(rural):")
    P("\n| year | share source | global urban share | people w/o ISIMIP cell (M) | from neighbours (M) | set rural (M) |")
    P("|---|---|---:|---:|---:|---:|")
    for y in GHSL_YEARS:
        st = urban_stats[y]
        P(f"| {y} | {st['src']} | {st.get('glob', float('nan')):.3f} | {st['people_missing'] / 1e6:.2f} | "
          f"{st['people_neighbour'] / 1e6:.2f} | {st['people_zero'] / 1e6:.3f} |")
    for y, sp in ssp_urban_spread.items():
        P(f"\n- SSP disagreement on urban share at {y}: people-weighted mean (max - min) across SSP1/3/5 "
          f"{sp['wmean']:.3f}, 99th percentile cell {sp['p99']:.3f}; global urban share "
          f"{', '.join(f'ssp{s} {g:.3f}' for s, g in zip(SSPS, sp['glob']))}.")
    P("- HYDE urban share: `urbc / popc` per 0.5 deg cell, no neighbour borrowing needed (both grids come "
      "from the same model). 10,000 BC has no town dwellers at all, so it ships `urban: null`. The one-byte "
      "share drops cells whose urban share is under 1/510; `shipped` is the city-folk total the page "
      "actually weighs:")
    P("\n| year | HYDE urban (M) | shipped (M) | shipped / HYDE | cells with urban > total |")
    P("|---|---:|---:|---:|---:|")
    for y in HYDE_YEARS:
        k = f"hyde/{y}"
        raw_u, over = hyde_urban[y]
        sh = frames[k]["share"]
        shipped = 0.0 if sh is None else float((deq[k] * np.rint(sh.ravel()[ids] * 255) / 255).sum())
        P(f"| {y} | {raw_u / 1e6:.4f} | {shipped / 1e6:.4f} | "
          f"{'' if raw_u == 0 else f'{shipped / raw_u:.3f}'} | {over:.0f} |")
    P("")
    for n in sorted(set(notes)):
        P(f"- {n}")
    P("")
    P("## Log\n")
    P("```")
    L.extend(LOG)
    P("```")
    text = "\n".join(L) + "\n"
    with open(os.path.join(OUT, "checks.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("\n" + "=" * 72 + "\n" + text)


if __name__ == "__main__":
    main()
