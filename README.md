# fair-un-hq

*Fun category.*

## The goal

Work out where the UN headquarters *should* be if it were placed fairly for all of humanity,
and show how that fair spot drifts through history: a live, draggable globe with a year
slider, computing the answer in the browser as you play with it.

The real UN never appears: not New York, not Geneva, Vienna or Nairobi. This is a pure
"where would fair be" page, not a critique of where things are.

This is a playful map, not a policy paper.

## Decided

Settled in a brainstorm (2026-10-24); change on purpose, not by drift.

- **Artifact: a static web page with a globe, run locally for now** (open `index.html`; no
  hosting decided). Python preprocesses population into small binary grids per epoch; plain
  JS plus a globe library does the maths live, so every toy below is interactive rather than
  precomputed. A 0.5° grid is roughly 60k populated cells per epoch, and Weiszfeld's
  algorithm on that runs in milliseconds.
- **Notions of fair, all shown:**
  - **Fairness dial.** Minimise Σ wᵢ·dᵢᵖ (great-circle distance) and let the reader drag p
    from 1 to 8. p=1 is the geometric median (least total travel) and p=2 is squared
    distance, which is *not* the centroid (they are about 8° apart in 2020). The point
    slides as you drag: in 2020 it runs from Punjab (p=1) through Uzbekistan (p=2) and the
    Volga (p=3) to near Minsk (p=8).
  - **Worst-off.** A clipped minimax, kept separate from the dial: minimise the distance
    that covers 99% or 99.9% of people. In 2020 the 99.9% point is near Jordan and the 99%
    point is in Libya.
  - **Country vs person.** One country, one vote: the median of the member states (where
    to put each state is still open: capital or its population centroid). Compare it with
    one person, one vote.
  - **k HQs.** The optimal 2, 3 or 4 offices (spherical k-medians), with the world coloured
    by which office each person is closest to. No comparison with real UN offices.
  - **Depth of humanity.** The 3D centre of mass of all people lies inside the Earth; its
    depth below the surface measures how lopsided humanity is, epoch by epoch.
- **Time span: 1850 to 2100 for now.** All series use a 0.5° grid every 5 years:
  - **1850–1970:** ISIMIP3a histsoc, a HYDE-based reconstruction.
  - **1975–2030:** GHSL GHS-POP R2023A, the backbone. 2025 and 2030 are projections.
  - **2035–2100:** the trail **forks** into ISIMIP3b SSP1, SSP3 and SSP5. ISIMIP has no
    SSP2.
  - **Seams:** the joins at 1975 and 2030 are drawn as seams, with their size in km, not
    smoothed over.
  - **Antiquity is later:** HYDE 3.3 (before 1850) sits behind an Anubis browser-only bot
    wall at public.yoda.uu.nl. Download it by hand from a browser; scripts can't get
    through.
- **Data honesty: fade by confidence.** The trail is dotted for modelled years, solid for
  observed and dashed for projected, with the source named on hover.
- **Silly landings: show the raw point and name the nearest town.** A "welcome to your new
  capital" card gives the nearest settlement and a short blurb. A point at sea gets a
  floating HQ barge.
- **Extra toys:**
  - **Weight by…** Urban only or rural only. ISIMIP carries an urban/rural split. For GHSL
    epochs v1 borrows ISIMIP's per-cell urban share. GHS-SMOD would be the honest source,
    but it ships only at 1 km Mollweide.
  - **Drift speed.** Headline numbers per epoch, like "the HQ would have to crawl N metres
    a day".
  - **Relocation postcard.** A shareable card with the new capital's nearest town, the
    moving date and the drift speed.

## Still open

- **Grid resolution.** 0.5° is assumed. The build checks it against finer GHSL aggregates.
- **GHS-SMOD for urban/rural** in GHSL epochs, replacing the borrowed ISIMIP share.
- **HYDE 3.3 for antiquity**, once it has been downloaded by hand.
- **Hosting.** Generated `web/data/` is gitignored for now, so a clone needs the fetch and
  build scripts.
- **The country-vote point per state.** v1 uses each UN member state's capital, weighted
  equally. A refinement would use each country's own population median.
- **Wikipedia blurbs** for the nearest-town card. The town names come from GeoNames
  `cities15000`.


## Leads (unverified, evaluate before using)

- GHSL data: the JRC GHSL site (ghsl.jrc.ec.europa.eu), GHS-POP (population) and GHS-SMOD
  (degree of urbanisation), epochs 1975–2030 in 5-year steps.
- HYDE (History Database of the Global Environment, PBL / Utrecht University): gridded
  historical population going back to 10,000 BC.
- UN World Population Prospects: country-level projections to 2100.
- "Centre of world population" / "world population centre of gravity" is a known idea with
  earlier estimates. Look into it for prior art and as a comparison.
- Weiszfeld's algorithm (geometric median), adapted to the sphere; iteratively reweighted
  versions handle general p.

## Decided by Claude (overridable)

- The page runs from file:// with vendored libraries and data as `<script>` files. See
  `web/DATA.md`.
- The anti-HQ is dropped: the point farthest on average turns out to be exactly the
  antipode of the fair HQ.
- The dial is capped at p=8.

## Running it

Double-click `web/index.html`. It needs the generated `web/data/`, which is gitignored. From a
fresh clone, build it first:

```sh
python -m venv .venv && .venv/Scripts/pip install numpy rasterio xarray h5netcdf h5py
sh scripts/fetch_ghsl.sh      # ~5.5 GB, GHS-POP 30 arcsec, 12 epochs
sh scripts/fetch_isimip.sh    # ~220 MB, ISIMIP 30 arcmin history + SSP1/3/5
.venv/Scripts/python scripts/build_data.py    # ~5 min, writes web/data/*.js + checks.md
.venv/Scripts/python scripts/build_towns.py   # GeoNames towns + UN member capitals
```

Without `web/data/`, the page falls back to a synthetic mock (`web/mock/`).

## Status

- **Built:**
  - The data pipeline. Its checks are in `docs/checks.md`.
  - The globe page, with every feature listed under "Decided".
  - The JS solver. It matches the Python reference (`scripts/fair.py`) to under 1 m on all
    79 frames.
- **Findings:** the sanity check holds. The trail is smooth and 0.5° matches 0.1° to 0.2 km
  (see `docs/checks.md`).
  - The fair HQ sits in Punjab in 2020.
  - It drifts west through Baluchistan by 2100 (SSP1/SSP5), or to near Abqaiq in Saudi
    Arabia (SSP3).
  - The worst-off (99.9%) point has two real basins, the Levant and the North Pole, and
    flips between them.
- **Known gaps:**
  - A dial tick above p=2 takes about 70–110 ms, against a 50 ms target. A Web Worker pool
    would fix that.
  - HYDE antiquity is still pending.
  - GHS-SMOD for urban/rural is still pending.
  - Generated data isn't committed.
