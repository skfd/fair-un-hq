# Third-party licences

Everything under `web/vendor/` and the generated `web/data/towns.js` and `web/data/capitals.js`
comes from the projects below. Refresh with `scripts/build_towns.py --vendor`.

## d3 7.9.0 (`d3.min.js`)

From https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js. ISC licence:

```
Copyright 2010-2023 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## topojson-client 3.1.0 (`topojson-client.min.js`)

From https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js. Licence:

```
Copyright 2012-2019 Michael Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## world-atlas 2.0.2 (`world-50m.js`)

`countries-50m.json` and `land-50m.json` from https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/, wrapped as JS so the page can load them
over file://. The world-atlas package licence:

```
Copyright 2013-2019 Michael Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

The geometry is derived from [Natural Earth](https://www.naturalearthdata.com/) 1:50m data,
which is in the public domain ("Made with Natural Earth. Free vector and raster map data @
naturalearthdata.com.").

## GeoNames (`web/data/towns.js`, `web/data/capitals.js`)

Town names, coordinates, populations, capitals and country names come from the
[GeoNames](https://www.geonames.org/) geographical database dumps
(https://download.geonames.org/export/dump/), licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Attribution: "Contains data from GeoNames (www.geonames.org), licensed under CC BY 4.0."
The data was filtered (UN member states, one capital each) and re-encoded.
