// Decoding the DATA.md formats into typed arrays, and the frame list (series/year) the page
// walks. No DOM here either, so the node harness can share it.
(function (G) {
  "use strict";
  var FAIR = G.FAIR;

  function bytes(b64) {
    var s = atob(b64), n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function u32(b64) { var b = bytes(b64); return new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2); }
  function u16(b64) { var b = bytes(b64); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1); }
  function f32(b64) { var b = bytes(b64); return new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2); }

  var SERIES = ["isimip-hist", "ghsl", "ssp1", "ssp3", "ssp5"];
  var BRANCHES = ["ssp1", "ssp3", "ssp5"];

  // Everything derived once at load: cell ids, their xyz, and the frame index.
  function build() {
    var D = {};
    D.ids = u32(FAIR.cells);
    D.N = D.ids.length;
    D.xyz = FairSolver.gridXYZ(D.ids);
    D.LMAX = FAIR.LMAX || Math.log1p(5e7);
    D.frames = [];
    D.byKey = {};
    var all = FAIR.series || {};
    SERIES.forEach(function (sid) {
      var s = Array.isArray(all) ? all.filter(function (x) { return x.id === sid; })[0] : all[sid];
      if (!s) return;
      s.frames.forEach(function (f) {
        var fr = {
          key: sid + "/" + f.year, sid: sid, year: f.year, conf: f.confidence,
          branch: BRANCHES.indexOf(sid) >= 0 ? sid : null, raw: f, hasUrban: !!f.urban,
          series: s,
        };
        D.frames.push(fr);
        D.byKey[fr.key] = fr;
      });
    });
    // Chronological order per lineage; prev links the trail (ssp*/2035 -> ghsl/2030).
    D.frames.sort(function (a, b) { return a.year - b.year || SERIES.indexOf(a.sid) - SERIES.indexOf(b.sid); });
    var trunk = D.frames.filter(function (f) { return !f.branch; });
    trunk.forEach(function (f, i) { f.prev = trunk[i - 1] || null; });
    BRANCHES.forEach(function (b) {
      var fs = D.frames.filter(function (f) { return f.sid === b; });
      fs.forEach(function (f, i) { f.prev = fs[i - 1] || trunk[trunk.length - 1] || null; });
    });
    D.frames.forEach(function (f) { f.seam = !!(f.prev && f.prev.sid !== f.sid); });
    D.trunk = trunk;
    return D;
  }

  // People per cell for a frame, over the union of cells (length N).
  function people(D, fr) {
    var q = u16(fr.raw.total), out = new Float64Array(D.N), k = D.LMAX / 65535;
    for (var i = 0; i < q.length; i++) out[i] = q[i] ? Math.expm1(q[i] * k) : 0;
    return out;
  }
  function urbanShare(fr) { return fr.raw.urban ? bytes(fr.raw.urban) : null; }

  // Compact population of a frame (only cells with weight), for the solver.
  // mode: "all" | "urban" | "rural".
  function population(D, fr, mode) {
    var p = people(D, fr), u = mode !== "all" ? urbanShare(fr) : null, n = 0, i;
    if (mode !== "all" && !u) mode = "all";
    var w = new Float64Array(D.N);
    for (i = 0; i < D.N; i++) {
      var v = p[i];
      if (mode === "urban") v = v * u[i] / 255;
      else if (mode === "rural") v = v * (1 - u[i] / 255);
      w[i] = v;
      if (v > 0) n++;
    }
    var xyz = new Float64Array(3 * n), ww = new Float64Array(n), idx = new Uint32Array(n), m = 0;
    for (i = 0; i < D.N; i++) if (w[i] > 0) {
      xyz[3 * m] = D.xyz[3 * i]; xyz[3 * m + 1] = D.xyz[3 * i + 1]; xyz[3 * m + 2] = D.xyz[3 * i + 2];
      ww[m] = w[i]; idx[m] = i; m++;
    }
    var P = FairSolver.makePop(xyz, ww);
    P.idx = idx;
    P.mode = mode;
    return P;
  }

  function towns() {
    var T = FAIR.towns;
    if (!T) return null;
    var lat = typeof T.lat === "string" ? f32(T.lat) : T.lat, lon = typeof T.lon === "string" ? f32(T.lon) : T.lon;
    var n = T.name.length, xyz = new Float64Array(3 * n);
    for (var i = 0; i < n; i++) {
      var v = FairSolver.toXYZ(lat[i], lon[i]);
      xyz[3 * i] = v[0]; xyz[3 * i + 1] = v[1]; xyz[3 * i + 2] = v[2];
    }
    return { name: T.name, cc: T.cc, pop: T.pop, lat: lat, lon: lon, xyz: xyz, n: n };
  }

  G.FairData = { bytes: bytes, u16: u16, u32: u32, f32: f32, build: build, people: people,
    urbanShare: urbanShare, population: population, towns: towns, SERIES: SERIES, BRANCHES: BRANCHES };
})(typeof window !== "undefined" ? window : globalThis);
