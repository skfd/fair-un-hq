import sys, numpy as np, xarray as xr
sys.path.insert(0, "scripts")
from fair import *

def grid(path, year):
    ds = xr.open_dataset(path, engine="h5netcdf", decode_times=False)
    t0 = 1850 if "histsoc" in path else int(ds.time.units.split("since ")[1][:4])
    k = int(np.argmin(np.abs(ds.time.values + t0 - year)))
    pop = ds["total-population"].isel(time=k).values
    pop = np.where(np.isfinite(pop) & (pop < 1e19), pop, 0)
    lat, lon = np.meshgrid(ds.lat.values, ds.lon.values, indexing="ij")
    m = pop > 0
    return to_xyz(lat[m], lon[m]), pop[m], float(ds.time.values[k] + t0)

H1 = "data/raw/isimip/population_histsoc_30arcmin_annual_1850_1900.nc"
H2 = "data/raw/isimip/population_histsoc_30arcmin_annual_1901_2021.nc"
S = "data/raw/isimip/population_ssp{}_30arcmin_annual_2015_2100.nc"
print(xr.open_dataset(H2, engine="h5netcdf", decode_times=False).time.units)
print(xr.open_dataset(S.format(2 if False else 1), engine="h5netcdf", decode_times=False).time.units)
runs = [(H1, 1850), (H2, 1900), (H2, 1950), (H2, 2000), (H2, 2020)] + [(S.format(s), 2100) for s in (1, 3, 5)]
for path, y in runs:
    xyz, w, yy = grid(path, y)
    c = centroid(xyz, w)
    x1, c1 = fair_point_global(xyz, w, 1)
    x2, c2 = fair_point_global(xyz, w, 2)
    tag = path.split("population_")[1].split("_30")[0]
    print(f"{tag:8} {yy:.0f} pop={w.sum()/1e9:.2f}B cells={len(w)} "
          f"median={to_latlon(x1)[0]:6.2f},{to_latlon(x1)[1]:7.2f} mean_km={c1:5.0f} "
          f"p2={to_latlon(x2)[0]:6.2f},{to_latlon(x2)[1]:7.2f} "
          f"centroid={to_latlon(c)[0]:6.2f},{to_latlon(c)[1]:7.2f} depth_km={(1-np.linalg.norm(c))*R_KM:5.0f}")
