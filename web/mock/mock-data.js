// Synthetic stand-in for web/data/*.js, in the exact DATA.md shape. Loaded only when the
// real pipeline output is missing (see js/fallback.js). Deterministic, so a node harness and
// the browser see the same numbers. Works in node too: `globalThis.window = globalThis`.
(function () {
  var G = typeof window !== "undefined" ? window : globalThis;
  var FAIR = (G.FAIR = G.FAIR || {});
  FAIR.series = FAIR.series || {};
  FAIR.addSeries = FAIR.addSeries || function (s) { FAIR.series[s.id] = s; };
  FAIR.isMock = true;

  var N = FAIR.MOCK_CELLS || 6000;
  var LMAX = Math.log1p(5e7);

  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var R = rng(20261024);
  function gauss() { var u = R() || 1e-12, v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function b64(u8) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  // Blobs: centre, spread (deg), and population share at key years (1850, 1950, 2020) and
  // in 2100 per scenario [ssp1, ssp3, ssp5].
  var blobs = [
    { n: "South Asia",   lat: 23,  lon: 80,  s: 6, sh: [0.20, 0.18, 0.24], f: [0.22, 0.25, 0.21] },
    { n: "China",        lat: 31,  lon: 113, s: 6, sh: [0.33, 0.22, 0.18], f: [0.11, 0.10, 0.12] },
    { n: "Japan/Korea",  lat: 36,  lon: 133, s: 3, sh: [0.04, 0.04, 0.03], f: [0.02, 0.015, 0.03] },
    { n: "SE Asia",      lat: 2,   lon: 108, s: 6, sh: [0.03, 0.06, 0.09], f: [0.08, 0.09, 0.08] },
    { n: "Europe",       lat: 50,  lon: 12,  s: 8, sh: [0.21, 0.17, 0.09], f: [0.07, 0.05, 0.10] },
    { n: "Russia",       lat: 55,  lon: 45,  s: 7, sh: [0.06, 0.06, 0.03], f: [0.02, 0.02, 0.03] },
    { n: "Middle East",  lat: 32,  lon: 43,  s: 5, sh: [0.02, 0.03, 0.05], f: [0.06, 0.07, 0.05] },
    { n: "West Africa",  lat: 9,   lon: 4,   s: 5, sh: [0.02, 0.03, 0.06], f: [0.14, 0.17, 0.10] },
    { n: "East Africa",  lat: -2,  lon: 34,  s: 6, sh: [0.02, 0.03, 0.06], f: [0.13, 0.15, 0.09] },
    { n: "N America",    lat: 39,  lon: -85, s: 7, sh: [0.02, 0.07, 0.05], f: [0.05, 0.03, 0.09] },
    { n: "Mesoamerica",  lat: 18,  lon: -98, s: 4, sh: [0.01, 0.02, 0.025], f: [0.02, 0.025, 0.02] },
    { n: "S America",    lat: -15, lon: -50, s: 8, sh: [0.02, 0.04, 0.05], f: [0.04, 0.04, 0.04] },
  ];
  var totals = { 1850: 1.26e9, 1950: 2.5e9, 2020: 7.8e9, ssp1: 7.0e9, ssp3: 12.6e9, ssp5: 7.4e9 };

  // Cells: sample from blobs by share, snap to the 0.5 degree grid, dedupe.
  var seen = new Set(), cells = [];
  var wsum = blobs.reduce(function (a, b) { return a + b.sh[2] + 0.02; }, 0);
  var guard = 0;
  while (cells.length < N && guard++ < N * 50) {
    var r = R() * wsum, b = blobs[0];
    for (var i = 0; i < blobs.length; i++) { r -= blobs[i].sh[2] + 0.02; if (r <= 0) { b = blobs[i]; break; } }
    var lat = b.lat + gauss() * b.s * 1.4, lon = b.lon + gauss() * b.s * 1.4 / Math.max(0.3, Math.cos(b.lat * Math.PI / 180));
    if (lat > 89.7 || lat < -89.7) continue;
    lon = ((lon + 540) % 360) - 180;
    var row = Math.min(359, Math.max(0, Math.floor((90 - lat) / 0.5)));
    var col = Math.min(719, Math.max(0, Math.floor((lon + 180) / 0.5)));
    var id = row * 720 + col;
    if (!seen.has(id)) { seen.add(id); cells.push(id); }
  }
  cells.sort(function (a, b) { return a - b; });
  var n = cells.length;
  var clat = new Float64Array(n), clon = new Float64Array(n), noise = new Float64Array(n * 3);
  for (i = 0; i < n; i++) {
    clat[i] = 89.75 - 0.5 * Math.floor(cells[i] / 720);
    clon[i] = -179.75 + 0.5 * (cells[i] % 720);
    noise[3 * i] = gauss(); noise[3 * i + 1] = gauss(); noise[3 * i + 2] = gauss();
  }
  // Per-cell kernel weight for each blob.
  var K = blobs.map(function (b) {
    var k = new Float64Array(n), cl = Math.cos(b.lat * Math.PI / 180);
    for (var i = 0; i < n; i++) {
      var dy = clat[i] - b.lat, dx = (((clon[i] - b.lon) + 540) % 360 - 180) * Math.max(cl, 0.3);
      k[i] = Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s));
    }
    var s = 0; for (i = 0; i < n; i++) s += k[i];
    for (i = 0; i < n; i++) k[i] /= s;
    return k;
  });

  function lerp(a, b, t) { return a + (b - a) * t; }
  function shareAt(b, year, branch) {
    var bi = { ssp1: 0, ssp3: 1, ssp5: 2 }[branch];
    if (year <= 1950) return lerp(b.sh[0], b.sh[1], (year - 1850) / 100);
    if (year <= 2020) return lerp(b.sh[1], b.sh[2], (year - 1950) / 70);
    return lerp(b.sh[2], b.f[bi === undefined ? 0 : bi], (year - 2020) / 80);
  }
  function totalAt(year, branch) {
    if (year <= 1950) return Math.exp(lerp(Math.log(totals[1850]), Math.log(totals[1950]), (year - 1850) / 100));
    if (year <= 2020) return Math.exp(lerp(Math.log(totals[1950]), Math.log(totals[2020]), (year - 1950) / 70));
    var end = totals[branch || "ssp1"], peak = Math.max(end, 9.5e9 * (branch === "ssp3" ? 1.3 : 1));
    var t = (year - 2020) / 80;
    return lerp(totals[2020], end, t) + (peak - Math.max(end, totals[2020])) * Math.sin(Math.PI * t) * 0.6;
  }

  function frame(series, year, conf, branch, noiseCh, withUrban) {
    var w = new Float64Array(n), tot = totalAt(year, branch), sh = 0;
    for (var j = 0; j < blobs.length; j++) sh += shareAt(blobs[j], year, branch);
    for (j = 0; j < blobs.length; j++) {
      var a = tot * shareAt(blobs[j], year, branch) / sh, k = K[j];
      for (var i = 0; i < n; i++) w[i] += a * k[i];
    }
    var q = new Uint16Array(n), u = withUrban ? new Uint8Array(n) : null, urb = Math.min(0.85, 0.05 + (year - 1850) / 250 * 0.8);
    for (i = 0; i < n; i++) {
      var p = Math.min(5e7, w[i] * Math.exp(0.35 * noise[3 * i + noiseCh]));
      if (p < 0.5) p = 0;
      q[i] = Math.round(Math.log1p(p) / LMAX * 65535);
      if (u) {
        var dens = Math.log10(1 + p) / 7.7;
        u[i] = Math.max(0, Math.min(255, Math.round(255 * Math.min(1, urb * (0.4 + dens) + 0.1 * noise[3 * i + 2]))));
      }
    }
    return { year: year, confidence: conf, total: b64(new Uint8Array(q.buffer)), urban: u ? b64(u) : null };
  }

  FAIR.LMAX = LMAX;
  FAIR.cells = b64(new Uint8Array(new Uint32Array(cells).buffer));
  var y, fr = [];
  for (y = 1850; y <= 1970; y += 5) fr.push(frame("isimip-hist", y, "modelled", null, 0, y >= 1900));
  FAIR.addSeries({ id: "isimip-hist", label: "ISIMIP3a histsoc (MOCK)", source: "Synthetic mock data", url: "", frames: fr });
  fr = [];
  for (y = 1975; y <= 2030; y += 5) fr.push(frame("ghsl", y, y <= 2020 ? "observed" : "projected", null, 1, true));
  FAIR.addSeries({ id: "ghsl", label: "GHSL GHS-POP R2023A (MOCK)", source: "Synthetic mock data", url: "", frames: fr });
  ["ssp1", "ssp3", "ssp5"].forEach(function (id) {
    var f = [];
    for (var y = 2035; y <= 2100; y += 5) f.push(frame(id, y, "projected", id, 0, true));
    FAIR.addSeries({ id: id, label: "ISIMIP3b " + id.toUpperCase() + " (MOCK)", source: "Synthetic mock data", url: "", frames: f });
  });

  if (!FAIR.towns) {
    var T = [
      ["Lahore", "PK", 31.55, 74.34, 6310888], ["Bahawalpur", "PK", 29.4, 71.68, 552607],
      ["Samarkand", "UZ", 39.65, 66.96, 319366], ["Kazan", "RU", 55.79, 49.12, 1104738],
      ["Minsk", "BY", 53.9, 27.57, 1742124], ["Mosul", "IQ", 36.34, 43.13, 1739800],
      ["Agadez", "NE", 16.97, 7.99, 88569], ["Kashgar", "CN", 39.47, 75.99, 506640],
      ["Herat", "AF", 34.35, 62.2, 272806], ["Jodhpur", "IN", 26.27, 73.02, 1033918],
      ["Tabriz", "IR", 38.08, 46.29, 1424641], ["Benghazi", "LY", 32.12, 20.07, 650629],
    ];
    FAIR.towns = {
      name: T.map(function (t) { return t[0]; }), cc: T.map(function (t) { return t[1]; }),
      lat: b64(new Uint8Array(new Float32Array(T.map(function (t) { return t[2]; })).buffer)),
      lon: b64(new Uint8Array(new Float32Array(T.map(function (t) { return t[3]; })).buffer)),
      pop: T.map(function (t) { return t[4]; }),
    };
    FAIR.countries = { PK: "Pakistan", UZ: "Uzbekistan", RU: "Russia", BY: "Belarus", IQ: "Iraq", NE: "Niger",
      CN: "China", AF: "Afghanistan", IN: "India", IR: "Iran", LY: "Libya", BR: "Brazil", NG: "Nigeria", JP: "Japan" };
  }
  if (!FAIR.capitals) {
    FAIR.capitals = [
      ["IN", "India", "New Delhi", 28.61, 77.21], ["CN", "China", "Beijing", 39.9, 116.4],
      ["BR", "Brazil", "Brasilia", -15.78, -47.93], ["NG", "Nigeria", "Abuja", 9.06, 7.5],
      ["RU", "Russia", "Moscow", 55.75, 37.62], ["JP", "Japan", "Tokyo", 35.69, 139.69],
      ["PK", "Pakistan", "Islamabad", 33.69, 73.06], ["IR", "Iran", "Tehran", 35.69, 51.42],
      ["LY", "Libya", "Tripoli", 32.89, 13.19], ["BY", "Belarus", "Minsk", 53.9, 27.57],
    ].map(function (c) { return { cc: c[0], country: c[1], city: c[2], lat: c[3], lon: c[4] }; });
  }
})();
