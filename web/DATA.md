# Data contract for the page

The page is opened straight from disk (`web/index.html`, file://). So: no `fetch()`, no ES
modules, no CDN. Every data file is a plain `<script src="data/….js">` that writes into one
global, `window.FAIR`, and libraries are vendored under `web/vendor/`.

Generated files under `web/data/` are gitignored and rebuilt by scripts (see the README).

## Grid

- 0.5° global grid: 720 columns × 360 rows. Row 0 is the northernmost (cell centre lat
  89.75), col 0 is the westernmost (centre lon −179.75).
- Cell id = `row * 720 + col`. Centre: `lat = 89.75 − 0.5·row`, `lon = −179.75 + 0.5·col`.

## `data/cells.js`

```js
FAIR.cells = "<base64 of Uint32Array, little-endian>";   // sorted ascending
```

This is the union of every cell populated in any frame of any series. All per-frame arrays are
aligned to it.

## `data/series-<id>.js` (one per series)

```js
FAIR.addSeries({
  id: "ghsl",                  // isimip-hist | ghsl | ssp1 | ssp3 | ssp5
  label: "GHSL GHS-POP R2023A",
  source: "EC JRC, Global Human Settlement Layer",
  url: "https://ghsl.jrc.ec.europa.eu/",
  frames: [
    { year: 1975, confidence: "observed",   // modelled | observed | projected
      total: "<b64 Uint16>",                // log-quantised people per cell, see below
      urban: "<b64 Uint8>" | null },        // urban share of the cell, 0..255
  ],
});
```

- **Quantisation:** `people = expm1(q / 65535 * LMAX)` with `LMAX = FAIR.LMAX`, which
  `cells.js` sets to `log1p(5e7)`. Zero stays zero. The relative error is under 0.03%.
- **Urban share:** `urban_people = people * u / 255`. Rural is the rest. `null` means the
  source has no split.
- **The series and their years:**
  - `isimip-hist`: 1850–1970 every 5 years, `modelled` (a HYDE-based reconstruction).
  - `ghsl`: 1975–2020 `observed`, 2025 and 2030 `projected`. This is the backbone.
  - `ssp1`, `ssp3`, `ssp5`: 2035–2100 every 5 years, `projected`. The trail forks after
    2030.
- **Seams** at 1975 (`isimip-hist` → `ghsl`) and 2030 (`ghsl` → each SSP) are drawn as
  seams, not smoothed over.

## `data/reference.js` (Python truth, for testing the JS port and for warm starts)

```js
FAIR.reference = {
  "ghsl/2020": { median: [lat, lon], median_cost_km, p2: [lat, lon], centroid: [lat, lon],
                 depth_km, worst999: [lat, lon], worst999_km, pop },
  // ...one entry per series/year
};
```

The JS solver must reproduce `median` to within about 1 km.

## `data/towns.js` and `data/capitals.js`

```js
FAIR.towns = { name: [...], cc: [...], lat: Float32 b64, lon: Float32 b64, pop: [...] };
FAIR.countries = { "IN": "India", ... };
FAIR.capitals = [ { cc: "IN", country: "India", city: "New Delhi", lat, lon }, ... ];  // 193 UN member states
```

## Maths (ported 1:1 from `scripts/fair.py`)

- **Fairness dial:** p from 1 to 8. Minimise Σ w·θᵖ. For p ≤ 2 use IRLS/Weiszfeld; for
  p > 2 use gradient descent with backtracking, because IRLS diverges there.
  - Run the Fibonacci global search once per frame at p = 1 and cache the result.
  - Warm-start every slider tick from the previous answer.
- **Worst-off:** clipped minimax. Minimise the distance that covers a share q of people
  (q = 0.99 / 0.999). This is not the p → ∞ limit of the dial.
- **Centre of mass:** the 3D mean. `depth_km = (1 − |c|) · 6371`.
- p=2 is "squared distance", not the centroid. They differ by about 8° in 2020.
