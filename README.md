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

- **Artifact: a static web page with a globe**, live at https://skfd.github.io/fair-un-hq/
  (GitHub Pages publishes `web/` on every push to main) and also openable locally. Python preprocesses population into small binary grids per epoch; plain
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
- **Show the calculation, not just the answer** (2026-10-31). The reader should be able to
  see why the HQ lands where it does:
  - **People as blocks.** Each frame's people are shared out as 1,000 blocks stacked on
    ~500 km patches, so a block is always 0.1% of everyone alive that year. Too few people for
    a block stay as faint dots (about 4%).
  - **A tug of war.** Every block pulls the HQ towards itself, with strength distanceᵖ⁻¹
    (equal ropes at p=1). The fair HQ is where the pulls cancel. Ropes are drawn from every
    stack and bundled stack → region → continent → HQ, each cable as wide as the pull it
    carries. The dial, the offices and city/country folk are all the same ropes, reweighted.
  - **Why here? card.** Each region's pull, chained tip to tail: at the fair HQ the chain
    closes into a loop, anywhere else the gap is the net pull.
  - **Drag the pin** to test any spot: the ropes and the net pull follow, and letting go
    replays the solver's own steps (Weiszfeld) back home.
  - **Step-by-step story** and an optional **bowl**: rings of extra average trip around the HQ.
  - The depth-of-humanity card (3D centre of mass) is dropped. The centroid stays only as the
    solver's starting guess.
- **Time span: 10,000 BC to 2100.** All series use a 0.5° grid, every 5 years from 1850:
  - **10,000 BC–1840:** HYDE 3.3, at HYDE's own steps: every 1000 years to 0 AD, every 100
    to 1700, every 10 to 1840. The timeline gives this era its left 30%.
  - **1850–1970:** ISIMIP3a histsoc, a HYDE-based reconstruction.
  - **1975–2030:** GHSL GHS-POP R2023A, the backbone. 2025 and 2030 are projections.
  - **2035–2100:** the trail **forks** into ISIMIP3b SSP1, SSP3 and SSP5. ISIMIP has no
    SSP2.
  - **Seams:** the joins at 1850, 1975 and 2030 are drawn as seams, with their size in km,
    not smoothed over.
  - **Where HYDE comes from:** Utrecht's own copy sits behind an Anubis bot wall, so
    `scripts/fetch_hyde.py` uses a Kaggle mirror of it, with the DANS archive of HYDE 3.2.1
    as a fallback.
- **Data honesty: fade by confidence.** The trail is dotted for modelled years, solid for
  observed and dashed for projected, with the source named on hover.
- **Silly landings: show the raw point and name the nearest town.** A "welcome to your new
  capital" card gives the nearest settlement and a short blurb. A point at sea gets a
  floating HQ barge.
- **Extra toys:**
  - **Weight by…** Urban only or rural only. HYDE and ISIMIP carry an urban/rural split
    (HYDE has no town dwellers in 10,000 BC, so that one frame has none). For GHSL epochs v1
    borrows ISIMIP's per-cell urban share. GHS-SMOD would be the honest source,
    but it ships only at 1 km Mollweide.
  - **Drift speed.** Headline numbers per epoch, like "the HQ would have to crawl N metres
    a day".
  - **Relocation postcard.** A shareable card with the new capital's nearest town, the
    moving date and the drift speed.

## Still open

- **Grid resolution.** 0.5° is assumed. The build checks it against finer GHSL aggregates.
- **GHS-SMOD for urban/rural** in GHSL epochs, replacing the borrowed ISIMIP share.
- **The country-vote point per state.** v1 uses each UN member state's capital, weighted
  equally. A refinement would use each country's own population median.
- **Wikipedia blurbs** for the nearest-town card. The town names come from GeoNames
  `cities15000`.


## Leads (unverified, evaluate before using)

- GHSL data: the JRC GHSL site (ghsl.jrc.ec.europa.eu), GHS-POP (population) and GHS-SMOD
  (degree of urbanisation), epochs 1975–2030 in 5-year steps.
- HYDE (History Database of the Global Environment, PBL / Utrecht University): gridded
  historical population going back to 10,000 BC. Checked: the Kaggle 3.3 mirror's
  `popc_r.txt` is byte-identical to datahub.io's copy, and its grids sum to that table. Its
  licence is CC BY 4.0 according to the DOI's registered metadata (DataCite,
  10.24416/UU01-67UHB4). The other labels disagree: an earlier read of YODA's metadata said
  CC BY-NC-SA 4.0, the readme says CC BY 3.0 and Kaggle says CC BY-SA 4.0. The DANS archive
  of HYDE 3.2.1 is CC0.
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
- Blocks are a share of that year's people (1,000 per frame), not a fixed headcount, so the
  picture works in 10,000 BC too. Patches are a 2,000-point Fibonacci lattice. Rounding is
  largest remainder, so every frame has exactly 1,000.
- Regions are the UN M49 subregions, grouped into six continents (the Americas split into
  Latin America and North America). Cells take their country from the vendored Natural Earth
  outlines (`scripts/build_regions.js`).
- The Why here? card and the knot tooltips use exact pulls over every 0.5° cell. The drawn
  ropes and the bowl use the blocks: the HQ solved from the blocks alone lands within
  10–60 km of the real one (245 km in 10,000 BC, where the bowl is flat).
- HYDE's uneven steps are shipped as they are, not resampled to 5 years. The timeline is
  piecewise linear (10,000 BC–0 AD, 0–1700, 1700–1850, 1850–2100 at 13/9/8/70% of its
  width), and Play runs from 10,000 BC.

## Running it

Double-click `web/index.html`. The generated `web/data/` (about 28 MB) is committed, so a
clone opens as-is. To rebuild it:

```sh
python -m venv .venv && .venv/Scripts/pip install numpy rasterio xarray h5netcdf h5py
sh scripts/fetch_ghsl.sh      # ~5.5 GB, GHS-POP 30 arcsec, 12 epochs
sh scripts/fetch_isimip.sh    # ~220 MB, ISIMIP 30 arcmin history + SSP1/3/5
.venv/Scripts/python -m pip install inflate64   # only for fetch_hyde.py --release 3.2.1
.venv/Scripts/python scripts/fetch_hyde.py    # ~900 MB, HYDE 3.3 total + urban 10000 BC-1850
.venv/Scripts/python scripts/build_data.py    # ~5 min, writes web/data/*.js + checks.md
.venv/Scripts/python scripts/build_towns.py   # GeoNames towns + UN member capitals
node scripts/build_regions.js                  # cell -> UN subregion, for the rope web
```

Without `web/data/`, the page falls back to a synthetic mock (`web/mock/`).

## Licence

The code is MIT (`LICENSE`). The generated `web/data/` is CC BY 4.0, adapted from HYDE 3.3
(CC BY 4.0), GHSL (CC BY 4.0), ISIMIP (CC0) and GeoNames (CC BY 4.0). The sources and
citations are in `LICENSE-DATA.md`. The vendored libraries keep their own licences
(`web/vendor/LICENSES.md`).

## Status

- **Built:**
  - The data pipeline. Its checks are in `docs/checks.md`.
  - The globe page, with every feature listed under "Decided".
  - The tug of war: at the fair HQ the exact net pull is ~10⁻¹² (balanced); move off it and
    the net pull points back.
  - The JS solver. It matches the Python reference (`scripts/fair.py`) to under 1 m on all
    121 frames.
- **Findings:** the sanity check holds. The trail is smooth and 0.5° matches 0.1° to 0.2 km
  (see `docs/checks.md`).
  - The fair HQ sits in Punjab in 2020.
  - In 10,000 BC it sits in Virginia, then west of Scotland (9000 BC) and in Denmark
    (8000 BC). With 4.5 million people spread over every continent the objective is
    nearly flat: those three spots are within 3% of each other in mean trip length. It
    then marches east across the steppe and reaches North India by 2000 BC.
  - How flat: in 9000 BC west of Scotland and New Brunswick are within 0.5 km of each other
    in mean trip length (7,676 km). Leaving out HYDE's 1,224 town dwellers ("Country folk")
    tips the HQ across the Atlantic.
  - From 0 AD to 1700 it stays around Delhi, wandering between Punjab and the Nepal border.
    From 1700 it climbs north-east into Tibet, peaking at 34.8° N, 88.7° E in 1840, before
    the modern drift back west to Punjab.
  - The 1850 seam is clean: HYDE 3.3 and ISIMIP's 1850 put the HQ 6 km apart, with
    totals within 0.2%.
  - It drifts west through Baluchistan by 2100 (SSP1/SSP5), or to near Abqaiq in Saudi
    Arabia (SSP3).
  - The worst-off (99.9%) point has two real basins, the Levant and the North Pole, and
    flips between them.
- **Known gaps:**
  - A dial tick above p=2 takes about 70–110 ms, against a 50 ms target. A Web Worker pool
    would fix that.
  - GHS-SMOD for urban/rural is still pending.
