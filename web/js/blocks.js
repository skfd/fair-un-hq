// People as blocks, and the tug of war that places the HQ.
//
// Blocks: the globe is cut into M equal-area patches (a Fibonacci lattice, ~500 km across).
// Each frame's people are shared out as exactly NB blocks (largest remainder), so a block is
// always 1/NB of everyone alive that year. A patch's blocks stand on it as one stack.
//
// The tug of war: at a point a, every person pulls a towards themselves along the great circle,
// with strength (distance)^(p-1). At p = 1 every rope pulls equally. The fair HQ for p is the
// point where all the pulls cancel (the gradient of sum w d^p is zero there). Pulls add up, so a
// region's pull is the sum of its people's: that is what the rope web and the force polygon show.
// pulls() is exact over every 0.5° cell; the drawn ropes use the blocks.
//
// No DOM here, so node can load it after solver.js and data.js.
(function (G) {
  "use strict";
  var S = G.FairSolver, R_KM = 6371.0088, M = 2000, NB = 1000;

  // ---------------------------------------------------------------- regions
  var REG = (function () {
    var F = G.FAIR || {}, r = F.regions;
    if (r) {
      var s = atob(r.cell), u = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return { continents: r.continents, subs: r.subregions, cell: u };
    }
    return null;   // mock data: regions are guessed from lat/lon below
  })();
  var CONT = REG ? REG.continents : ["Africa", "Asia", "Europe", "Latin America", "North America", "Oceania"];
  var SUBS = REG ? REG.subs : CONT.map(function (n, i) { return { name: n, continent: i }; });
  var COLORS = ["#d68a1c", "#c8463d", "#3b74c4", "#2a9a6c", "#7d5cc6", "#1798ad"];
  function guessCont(x) {   // only for the synthetic mock, which has no regions.js
    var a = S.toLatLon(x), la = a[0], lo = a[1];
    if (lo < -30) return la > 15 ? 4 : 3;
    if (lo > 110 && la < -10) return 5;
    if (la > 36 && lo < 60) return 2;
    if (la < 36 && lo < 52 && !(la > 12 && lo > 35)) return 0;
    return 1;
  }

  // ---------------------------------------------------------------- lattice and bins
  var LAT = new Float64Array(3 * M);
  (function () {
    var g = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < M; i++) {
      var z = 1 - 2 * (i + 0.5) / M, r = Math.sqrt(1 - z * z), t = g * i;
      LAT[3 * i] = r * Math.cos(t); LAT[3 * i + 1] = r * Math.sin(t); LAT[3 * i + 2] = z;
    }
  })();
  // Lattice point i has z = 1 - 2(i + .5)/M, so the nearest one is among a few hundred indices
  // around the cell's own z: no full scan needed.
  function binOfXYZ(x, y, z) {
    var dz = 0.09, lo = Math.max(0, Math.floor((1 - (z + dz)) * M / 2 - 0.5)), hi = Math.min(M - 1, Math.ceil((1 - (z - dz)) * M / 2 - 0.5));
    var best = -2, bi = lo;
    for (var j = lo; j <= hi; j++) {
      var d = LAT[3 * j] * x + LAT[3 * j + 1] * y + LAT[3 * j + 2] * z;
      if (d > best) { best = d; bi = j; }
    }
    return bi;
  }
  var cellBin = null, cellSub = null;
  function prepare(D) {
    if (cellBin && cellBin.length === D.N) return;
    cellBin = new Uint16Array(D.N); cellSub = new Uint8Array(D.N);
    var useReg = REG && REG.cell.length === D.N;
    G.FairBlocks.hasRegions = !!useReg;
    for (var i = 0; i < D.N; i++) {
      var x = D.xyz[3 * i], y = D.xyz[3 * i + 1], z = D.xyz[3 * i + 2];
      cellBin[i] = binOfXYZ(x, y, z);
      cellSub[i] = useReg ? REG.cell[i] : guessCont([x, y, z]);
    }
  }

  // ---------------------------------------------------------------- blocks of a population
  // P must come from FairData.population (it carries idx, the cell of each entry).
  function ofPop(D, P) {
    if (P._blocks) return P._blocks;
    prepare(D);
    var nS = SUBS.length, bw = new Float64Array(M), bc = new Float64Array(3 * M), bs = new Float64Array(M * nS);
    for (var m = 0; m < P.n; m++) {
      var c = P.idx[m], b = cellBin[c], w = P.w[m];
      bw[b] += w; bc[3 * b] += w * P.xyz[3 * m]; bc[3 * b + 1] += w * P.xyz[3 * m + 1]; bc[3 * b + 2] += w * P.xyz[3 * m + 2];
      bs[b * nS + cellSub[c]] += w;
    }
    var cnt = new Int32Array(M), rem = [], got = 0;
    for (b = 0; b < M; b++) {
      if (!bw[b]) continue;
      var s = bw[b] / P.W * NB;
      cnt[b] = Math.floor(s); got += cnt[b];
      rem.push([s - cnt[b], b]);
    }
    rem.sort(function (a, b2) { return b2[0] - a[0]; });
    for (var k = 0; k < NB - got && k < rem.length; k++) cnt[rem[k][1]]++;
    var stacks = [];
    for (b = 0; b < M; b++) {
      if (!cnt[b]) continue;
      var sub = 0, sw = -1;
      for (var r = 0; r < nS; r++) if (bs[b * nS + r] > sw) { sw = bs[b * nS + r]; sub = r; }
      stacks.push({ b: b, x: S.unit([bc[3 * b], bc[3 * b + 1], bc[3 * b + 2]]), n: cnt[b], people: bw[b], sub: sub, cont: SUBS[sub].continent });
    }
    var inBlocks = stacks.reduce(function (a, st) { return a + st.people; }, 0);
    P._blocks = { stacks: stacks, unit: P.W / NB, W: P.W, loose: 1 - inBlocks / P.W };
    return P._blocks;
  }

  // ---------------------------------------------------------------- the pulls (exact)
  function frame(a) {   // east and north unit vectors at a
    var e = [-a[1], a[0], 0], n = Math.hypot(e[0], e[1]);
    e = n < 1e-9 ? [0, 1, 0] : [e[0] / n, e[1] / n, 0];
    return { e: e, n: [a[1] * e[2] - a[2] * e[1], a[2] * e[0] - a[0] * e[2], a[0] * e[1] - a[1] * e[0]] };
  }
  // Every pull at a, summed per subregion and continent, as east/north vectors in units of the
  // total rope tension (so 1 would be everyone pulling the same way). Also the net pull in xyz.
  function pulls(D, P, a, p) {
    prepare(D);
    var nS = SUBS.length, acc = new Float64Array(3 * nS), ppl = new Float64Array(nS), T = 0, e1 = p - 1;
    var X = P.xyz, w = P.w, a0 = a[0], a1 = a[1], a2 = a[2], cost = 0;
    for (var m = 0, j = 0; m < P.n; m++, j += 3) {
      var X0 = X[j], X1 = X[j + 1], X2 = X[j + 2], c = X0 * a0 + X1 * a1 + X2 * a2;
      if (c > 1) c = 1; else if (c < -1) c = -1;
      var th = Math.acos(c), ten = w[m] * (e1 === 0 ? 1 : Math.pow(th, e1)), r = cellSub[P.idx[m]];
      T += ten; cost += ten * th; ppl[r] += w[m];
      var tx = X0 - c * a0, ty = X1 - c * a1, tz = X2 - c * a2, tn = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tn > 1e-12) { var f = ten / tn; acc[3 * r] += f * tx; acc[3 * r + 1] += f * ty; acc[3 * r + 2] += f * tz; }
    }
    var fr = frame(a), sub = [], cont = CONT.map(function (nm, i) { return { name: nm, i: i, v: [0, 0, 0], people: 0 }; });
    var net = [0, 0, 0];
    for (r = 0; r < nS; r++) {
      var v = [acc[3 * r] / T, acc[3 * r + 1] / T, acc[3 * r + 2] / T], k = SUBS[r].continent;
      sub.push({ name: SUBS[r].name, i: r, cont: k, v: v, people: ppl[r], en: [dot(v, fr.e), dot(v, fr.n)] });
      cont[k].v[0] += v[0]; cont[k].v[1] += v[1]; cont[k].v[2] += v[2]; cont[k].people += ppl[r];
      net[0] += v[0]; net[1] += v[1]; net[2] += v[2];
    }
    cont.forEach(function (o) { o.en = [dot(o.v, fr.e), dot(o.v, fr.n)]; });
    return { sub: sub, cont: cont, net: net, netEN: [dot(net, fr.e), dot(net, fr.n)], W: P.W, p: p,
      meanKm: Math.pow(cost / P.W, 1 / p) * R_KM };   // (mean of d^p)^(1/p): the dial's own "average trip"
  }
  function dot(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }

  // ---------------------------------------------------------------- the rope web
  function slerp(a, b, t) {
    var th = S.angle(a, b);
    if (th < 1e-9) return a.slice();
    if (Math.PI - th < 1e-3) return a.slice();   // antipodal: no unique great circle
    var s = Math.sin(th), ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
    return S.unit([ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]]);
  }
  // Ropes from every stack to a. Bundled: stack -> its subregion's knot -> its continent's
  // knot -> a, each cable as wide as the tension it carries. A stack nearer to a than its knot
  // goes straight on (it would otherwise ride out and back). offices: ropes go to the nearest
  // office instead, unbundled.
  function web(B, a, p, opts) {
    opts = opts || {};
    var st = B.stacks, e1 = p - 1, sumT = 0, i;
    var th = st.map(function (s) { return S.angle(s.x, a); });
    var tau = th.map(function (t) { return e1 === 0 ? 1 : Math.pow(Math.max(t, 1e-6), e1); });
    st.forEach(function (s, i2) { sumT += s.n * tau[i2]; });
    var norm = sumT > 0 ? NB / sumT : 1;
    var segs = [], knots = [];
    if (opts.offices) {
      st.forEach(function (s, i2) {
        var best = 0, bd = -2;
        opts.offices.forEach(function (o, k) { var d = dot(o, s.x); if (d > bd) { bd = d; best = k; } });
        segs.push({ a: s.x, b: opts.offices[best], T: s.n, office: best, level: 0 });
      });
      return { segs: segs, knots: knots };
    }
    if (opts.direct) {
      st.forEach(function (s, i2) { segs.push({ a: s.x, b: a, T: s.n * tau[i2] * norm, cont: s.cont, level: 0, stack: s }); });
      return { segs: segs, knots: knots };
    }
    var nS = SUBS.length, sc = [], cc = [];
    for (i = 0; i < nS; i++) sc.push({ v: [0, 0, 0], T: 0, n: 0 });
    for (i = 0; i < CONT.length; i++) cc.push({ v: [0, 0, 0], T: 0, n: 0 });
    st.forEach(function (s) {
      [sc[s.sub], cc[s.cont]].forEach(function (o) { o.v[0] += s.n * s.x[0]; o.v[1] += s.n * s.x[1]; o.v[2] += s.n * s.x[2]; o.n += s.n; });
    });
    var ck = cc.map(function (o) { return o.n ? slerp(a, S.unit(o.v), 0.3) : null; });
    var sk = sc.map(function (o, r) { return o.n ? slerp(a, S.unit(o.v), 0.6) : null; });
    var ckTh = ck.map(function (x) { return x ? S.angle(x, a) : 0; });
    var skTh = sk.map(function (x) { return x ? S.angle(x, a) : 0; });
    // Where each subregion's cable goes: its continent knot, unless that is no nearer to a.
    var subTo = sk.map(function (x, r) { return x && skTh[r] > ckTh[SUBS[r].continent] * 1.15 ? "cont" : "hq"; });
    st.forEach(function (s, i2) {
      var T = s.n * tau[i2] * norm, r = s.sub, k = s.cont;
      if (th[i2] > skTh[r] * 1.15 && sk[r]) {
        segs.push({ a: s.x, b: sk[r], T: T, cont: k, level: 0, stack: s });
        sc[r].T += T;
      } else if (th[i2] > ckTh[k] * 1.15 && ck[k]) {
        segs.push({ a: s.x, b: ck[k], T: T, cont: k, level: 0, stack: s });
        cc[k].T += T;
      } else segs.push({ a: s.x, b: a, T: T, cont: k, level: 0, stack: s });
    });
    sc.forEach(function (o, r) {
      if (!o.T) return;
      var k = SUBS[r].continent;
      if (subTo[r] === "cont") { segs.push({ a: sk[r], b: ck[k], T: o.T, cont: k, level: 1, sub: r }); cc[k].T += o.T; }
      else segs.push({ a: sk[r], b: a, T: o.T, cont: k, level: 1, sub: r });
      knots.push({ x: sk[r], level: 1, sub: r, cont: k, T: o.T, n: o.n });
    });
    cc.forEach(function (o, k) {
      if (!o.T) return;
      segs.push({ a: ck[k], b: a, T: o.T, cont: k, level: 2 });
      knots.push({ x: ck[k], level: 2, cont: k, T: o.T, n: o.n });
    });
    return { segs: segs, knots: knots };
  }

  // ---------------------------------------------------------------- the bowl
  // (mean of d^p)^(1/p) over the blocks on a 2° grid, as a generator (it yields per band of
  // rows). The grid has one wrapped column so rings close across the date line.
  var GW = 181, GH = 90;
  function* bowlGen(B, p) {
    var st = B.stacks, ns = st.length, X = new Float64Array(3 * ns), w = new Float64Array(ns), i;
    st.forEach(function (s, k) { X[3 * k] = s.x[0]; X[3 * k + 1] = s.x[1]; X[3 * k + 2] = s.x[2]; w[k] = s.n / NB; });
    var vals = new Float64Array(GW * GH), D2R = Math.PI / 180;
    for (var y = 0; y < GH; y++) {
      var la = (89 - 2 * y) * D2R, cl = Math.cos(la), sl = Math.sin(la);
      for (var x = 0; x < GW; x++) {
        var lo = (-179 + 2 * x) * D2R, q0 = cl * Math.cos(lo), q1 = cl * Math.sin(lo), s = 0;
        for (i = 0; i < ns; i++) {
          var c = X[3 * i] * q0 + X[3 * i + 1] * q1 + X[3 * i + 2] * sl;
          var t = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
          s += w[i] * (p === 1 ? t : Math.pow(t, p));
        }
        vals[y * GW + x] = Math.pow(s, 1 / p) * R_KM;
      }
      if (y % 6 === 5) yield;
    }
    return vals;
  }
  // Rings at (lowest + step) km as lists of [lon, lat] lines. d3.contours closes rings along
  // the grid edge; those edge runs are dropped so only real contour lines are drawn.
  var STEPS = [100, 250, 500, 1000, 2000, 3000, 4000, 6000];
  function rings(vals, base) {
    var lines = [];
    var cs = d3.contours().size([GW, GH]).thresholds(STEPS.map(function (s) { return base + s; }))(Array.from(vals));
    cs.forEach(function (cnt, k) {
      var out = [];
      cnt.coordinates.forEach(function (poly) {
        poly.forEach(function (ring) {
          var cur = [];
          ring.forEach(function (pt) {
            var edge = pt[0] <= 0.5 || pt[0] >= GW - 0.5 || pt[1] <= 0.5 || pt[1] >= GH - 0.5;
            if (edge) { if (cur.length > 1) out.push(cur); cur = []; return; }
            cur.push([-180 + 2 * pt[0], 90 - 2 * pt[1]]);
          });
          if (cur.length > 1) out.push(cur);
        });
      });
      if (out.length) lines.push({ km: STEPS[k], lines: out });
    });
    return lines;
  }

  G.FairBlocks = {
    NB: NB, M: M, COLORS: COLORS, continents: CONT, subregions: SUBS,
    ofPop: ofPop, pulls: pulls, web: web, bowlGen: bowlGen, rings: rings, frame: frame, slerp: slerp,
    hasRegions: !!REG,
  };
})(typeof window !== "undefined" ? window : globalThis);
