# Data licence

The code is MIT (see `LICENSE`). The generated data under `web/data/` is not code. It is
adapted from the sources below and is released under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0).
Credit the upstream sources as well as this project when you reuse it.

Changes made: every population grid was summed onto a 0.5° grid, log-quantised to 16 bits and
re-encoded as base64. The urban share was quantised to 8 bits. The towns were filtered to
GeoNames' `cities15000` and the capitals to the 193 UN member states. `reference.js` and
`checks.md` are results computed from these grids.

Everything under `web/vendor/` keeps its own licence: see `web/vendor/LICENSES.md`.

## Sources

| File | Source | Upstream terms |
| --- | --- | --- |
| `series-hyde.js` | HYDE 3.3 | CC BY 4.0 |
| `series-isimip-hist.js` | ISIMIP3a histsoc population | CC0 1.0 |
| `series-ghsl.js` | GHSL GHS-POP R2023A | CC BY 4.0 (Commission reuse decision 2011/833/EU) |
| `series-ssp1.js`, `series-ssp3.js`, `series-ssp5.js` | ISIMIP3b SSP population | CC0 1.0 |
| `towns.js`, `capitals.js` | GeoNames | CC BY 4.0 |
| `cells.js`, `reference.js`, `checks.md` | all of the population series above | as above |

- **HYDE 3.3.** Klein Goldewijk, C.G.M. (Kees), Utrecht University (2023): *History Database
  of the Global Environment 3.3*. doi:[10.24416/UU01-67UHB4](https://doi.org/10.24416/UU01-67UHB4).
  The terms are those in the DOI's registered metadata. The files were fetched from a
  [Kaggle mirror](https://www.kaggle.com/datasets/ilyenkov/hyde-3-3), and the mirror's own
  CC BY-SA 4.0 label does not change Utrecht's terms.
- **GHSL.** Schiavina M., Freire S., Carioli A., MacManus K. (2023): *GHS-POP R2023A – GHS
  population grid multitemporal (1975–2030)*. European Commission, Joint Research Centre (JRC).
  doi:[10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE](https://doi.org/10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE).
- **ISIMIP.** Population input data from the [ISIMIP repository](https://data.isimip.org/),
  dedicated to the public domain (CC0 1.0). ISIMIP asks to be credited anyway. The histsoc grids
  are based on HYDE 3.2. The SSP grids are based on Jones & O'Neill
  (doi:[10.5065/D60Z721H](https://doi.org/10.5065/D60Z721H)) and Gao
  (doi:[10.7927/q7z9-9r69](https://doi.org/10.7927/q7z9-9r69)).
- **GeoNames.** "Contains data from GeoNames (www.geonames.org), licensed under CC BY 4.0."
