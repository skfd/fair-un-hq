// Fair points on the sphere: a 1:1 port of scripts/fair.py (the Python is the truth).
//
// A population is P = { xyz: Float64Array(3n) of unit vectors, w: Float64Array(n), n, W }.
// Points are plain [x, y, z] arrays. Nothing here touches the DOM, so node can load it.
//
// The slow searches (global Fibonacci, worst-off, k-medians) are generators that yield now
// and then; FairSolver.run() drains one synchronously, the page pumps them in time slices.
(function (G) {
  "use strict";
  var R_KM = 6371.0088;
  var D2R = Math.PI / 180;

  function toXYZ(lat, lon) {
    var la = lat * D2R, lo = lon * D2R;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  }
  function toLatLon(x) {
    var n = Math.hypot(x[0], x[1], x[2]);
    return [Math.asin(Math.max(-1, Math.min(1, x[2] / n))) / D2R, Math.atan2(x[1], x[0]) / D2R];
  }
  function norm(x) { return Math.hypot(x[0], x[1], x[2]); }
  function unit(x) { var n = norm(x); return [x[0] / n, x[1] / n, x[2] / n]; }
  function angle(a, b) {
    var c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
  }
  function km(a, b) { return angle(a, b) * R_KM; }

  // cells.js: base64 Uint32 cell ids -> xyz of the cell centres (0.5 degree grid).
  function gridXYZ(ids) {
    var n = ids.length, X = new Float64Array(3 * n);
    for (var i = 0; i < n; i++) {
      var row = Math.floor(ids[i] / 720), col = ids[i] - row * 720;
      var la = (89.75 - 0.5 * row) * D2R, lo = (-179.75 + 0.5 * col) * D2R, cl = Math.cos(la);
      X[3 * i] = cl * Math.cos(lo); X[3 * i + 1] = cl * Math.sin(lo); X[3 * i + 2] = Math.sin(la);
    }
    return X;
  }

  function makePop(xyz, w) {
    var W = 0;
    for (var i = 0; i < w.length; i++) W += w[i];
    return { xyz: xyz, w: w, n: w.length, W: W };
  }

  // Sum of w * angle^p (radians). cost() below is the readable km version.
  var stats = { passes: 0 };   // full passes over the cells, a load-independent cost measure
  function sumPow(x, P, p) {
    stats.passes++;
    var X = P.xyz, w = P.w, n = P.n, x0 = x[0], x1 = x[1], x2 = x[2], s = 0;
    for (var i = 0, j = 0; i < n; i++, j += 3) {
      var c = X[j] * x0 + X[j + 1] * x1 + X[j + 2] * x2;
      var th = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
      s += w[i] * (p === 1 ? th : p === 2 ? th * th : Math.pow(th, p));
    }
    return s;
  }
  // Mean of (great-circle distance in km)^p, raised to 1/p, so it reads as a distance.
  function cost(x, P, p) { return Math.pow(sumPow(x, P, p) / P.W, 1 / p) * R_KM; }

  function expMap(x, v) {
    var n = norm(v);
    if (n < 1e-15) return x;
    var c = Math.cos(n), s = Math.sin(n) / n;
    return unit([c * x[0] + s * v[0], c * x[1] + s * v[1], c * x[2] + s * v[2]]);
  }

  // 3D centre of mass. Its norm < 1; (1 - norm) * R is the depth below the surface.
  function centroid(P) {
    var X = P.xyz, w = P.w, a = 0, b = 0, c = 0;
    for (var i = 0, j = 0; i < P.n; i++, j += 3) { a += w[i] * X[j]; b += w[i] * X[j + 1]; c += w[i] * X[j + 2]; }
    return [a / P.W, b / P.W, c / P.W];
  }

  // One Riemannian step of the reweighted (Weiszfeld at p=1) iteration at x.
  //   v_i = log_map(x, cell_i) (tangent, length = angle; 0 when |t| <= 1e-12)
  //   a_i = w_i * max(th_i, eps)^(p-2);  step = sum(a v) / sum(a)
  function irlsStep(x, P, p) {
    stats.passes++;
    var X = P.xyz, w = P.w, n = P.n, x0 = x[0], x1 = x[1], x2 = x[2];
    var sx = 0, sy = 0, sz = 0, sa = 0, eps = 1e-9, e = p - 2;
    for (var i = 0, j = 0; i < n; i++, j += 3) {
      var X0 = X[j], X1 = X[j + 1], X2 = X[j + 2];
      var c = X0 * x0 + X1 * x1 + X2 * x2;
      if (c > 1) c = 1; else if (c < -1) c = -1;
      var th = Math.acos(c);
      var tx = X0 - c * x0, ty = X1 - c * x1, tz = X2 - c * x2;
      var tn = Math.sqrt(tx * tx + ty * ty + tz * tz);
      var thc = th > eps ? th : eps;
      var a = e === -1 ? w[i] / thc : e === 0 ? w[i] : w[i] * Math.pow(thc, e);
      sa += a;
      if (tn > 1e-12) { var f = a * th / tn; sx += f * tx; sy += f * ty; sz += f * tz; }
    }
    return expMap(x, [sx / sa, sy / sa, sz / sa]);
  }

  // Minimise sum w * angle^p on the sphere (fair_point in fair.py).
  // p <= 2: iteratively reweighted Riemannian steps (Weiszfeld at p=1).
  // p > 2: gradient descent with backtracking (the reweighting overshoots there).
  // opts: iters (500), tol (1e-12) as in fair.py. Returns { x, iters, converged } and, for
  // p > 2, the step size t so a capped call can be resumed exactly where it stopped.
  function fairPoint(P, p, x0, opts) {
    opts = opts || {};
    var iters = opts.iters == null ? 500 : opts.iters, tol = opts.tol == null ? 1e-12 : opts.tol;
    var x = unit(x0 || centroid(P));
    if (p > 2) return descend(P, p, x, iters, tol, opts.t);
    for (var k = 0; k < iters; k++) {
      var y = irlsStep(x, P, p);
      if (Math.hypot(y[0] - x[0], y[1] - x[1], y[2] - x[2]) < tol) return { x: y, iters: k + 1, converged: true };
      x = y;
    }
    return { x: x, iters: iters, converged: false };
  }

  // f(y) = sum w th^p, and into g the descent direction sum (w th^(p-2)) v / sum w at y
  // (v = log map, |v| = th), in one pass: fair.py computes the same two sums separately.
  function fGrad(y, P, p, g) {
    stats.passes++;
    var X = P.xyz, w = P.w, n = P.n, y0 = y[0], y1 = y[1], y2 = y[2], e = p - 1;
    var f = 0, gx = 0, gy = 0, gz = 0;
    for (var i = 0, j = 0; i < n; i++, j += 3) {
      var X0 = X[j], X1 = X[j + 1], X2 = X[j + 2];
      var c = X0 * y0 + X1 * y1 + X2 * y2;
      if (c > 1) c = 1; else if (c < -1) c = -1;
      var th = Math.acos(c), pw = w[i] * Math.pow(th, e);
      f += pw * th;
      var tx = X0 - c * y0, ty = X1 - c * y1, tz = X2 - c * y2;
      var tn = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tn > 1e-12) { var k = pw / tn; gx += k * tx; gy += k * ty; gz += k * tz; }
    }
    g[0] = gx / P.W; g[1] = gy / P.W; g[2] = gz / P.W;
    return f;
  }

  function descend(P, p, x, iters, tol, t0) {
    var g = [0, 0, 0], gy = [0, 0, 0];
    var fx = fGrad(x, P, p, g), t = t0 == null ? 0.1 : t0;
    for (var k = 0; k < iters; k++) {
      var gn = Math.max(Math.hypot(g[0], g[1], g[2]), 1e-300), y = null, fy;
      while (t > 1e-14) {
        y = expMap(x, [t * g[0] / gn, t * g[1] / gn, t * g[2] / gn]);
        fy = fGrad(y, P, p, gy);
        if (fy < fx) break;
        t /= 2;
        y = null;
      }
      if (!y) return { x: x, iters: k + 1, converged: true, t: t };
      if (Math.hypot(y[0] - x[0], y[1] - x[1], y[2] - x[2]) < tol) return { x: y, iters: k + 1, converged: true, t: t };
      x = y; fx = fy; t *= 2;
      var sw = g; g = gy; gy = sw;
    }
    return { x: x, iters: iters, converged: false, t: t };
  }

  function fibonacci(n) {
    var F = new Float64Array(3 * n), g = Math.PI * (1 + Math.sqrt(5));
    for (var i = 0; i < n; i++) {
      var ii = i + 0.5, phi = Math.acos(1 - 2 * ii / n), th = g * ii;
      F[3 * i] = Math.cos(th) * Math.sin(phi); F[3 * i + 1] = Math.sin(th) * Math.sin(phi); F[3 * i + 2] = Math.cos(phi);
    }
    return F;
  }
  function seedAt(F, i) { return [F[3 * i], F[3 * i + 1], F[3 * i + 2]]; }

  // The objective is not convex on the sphere: seed from a Fibonacci sphere, refine the best 5.
  function* fairPointGlobalGen(P, p, nSeeds) {
    nSeeds = nSeeds || 400;
    var F = fibonacci(nSeeds), costs = new Float64Array(nSeeds), order = [];
    for (var i = 0; i < nSeeds; i++) {
      costs[i] = sumPow(seedAt(F, i), P, p);
      order.push(i);
      if (i % 20 === 19) yield;
    }
    order.sort(function (a, b) { return costs[a] - costs[b]; });
    var best = null;
    for (var r = 0; r < 5 && r < nSeeds; r++) {
      var x = seedAt(F, order[r]);
      // Same as fair_point(p, x0=seed) with fair.py's defaults, run in yielding chunks.
      var st = { t: undefined }, left = 500, res;
      while (true) {
        var chunk = Math.min(left, 25);
        res = fairPoint(P, p, x, { iters: chunk, tol: 1e-12, t: st.t });
        left -= res.iters; x = res.x; st = res;
        if (res.converged || left <= 0) break;
        yield;
      }
      var c = cost(x, P, p);
      if (!best || c < best.cost) best = { x: x, cost: c };
      yield;
    }
    return best;
  }

  // ---- worst-off: clipped minimax --------------------------------------------------------

  // Distance (km) within which a share q of people live, seen from x. Same answer as sorting
  // all distances and taking searchsorted(cumsum/W, q); done with a histogram on cos(angle)
  // plus a sort of the one bin where the quantile falls, so it is O(n).
  var QB = 4096, qHist = new Float64Array(QB), qDot = null;
  function quantileDistance(x, P, q) {
    var X = P.xyz, w = P.w, n = P.n, x0 = x[0], x1 = x[1], x2 = x[2];
    if (!qDot || qDot.length < n) qDot = new Float64Array(n);
    qHist.fill(0);
    for (var i = 0, j = 0; i < n; i++, j += 3) {
      var c = X[j] * x0 + X[j + 1] * x1 + X[j + 2] * x2;
      if (c > 1) c = 1; else if (c < -1) c = -1;
      qDot[i] = c;
      var b = Math.min(QB - 1, Math.floor((1 - c) * 0.5 * QB)); // bin 0 = nearest
      qHist[b] += w[i];
    }
    var target = q * P.W, cum = 0, k = 0;
    for (; k < QB; k++) { if (cum + qHist[k] >= target) break; cum += qHist[k]; }
    if (k >= QB) k = QB - 1;
    var inBin = [];
    for (i = 0; i < n; i++) {
      var bb = Math.min(QB - 1, Math.floor((1 - qDot[i]) * 0.5 * QB));
      if (bb === k) inBin.push(i);
    }
    inBin.sort(function (a, b) { return qDot[b] - qDot[a]; });
    var last = inBin.length ? inBin[inBin.length - 1] : 0;
    for (i = 0; i < inBin.length; i++) {
      cum += w[inBin[i]];
      if (cum >= target) { last = inBin[i]; break; }
    }
    return Math.acos(qDot[last]) * R_KM;
  }

  // Does x cover a share q of people strictly within bKm? Equivalent to
  // quantileDistance(x) < bKm, but a single pass with no acos and no sort.
  function beats(x, P, q, bKm) {
    var X = P.xyz, w = P.w, n = P.n, x0 = x[0], x1 = x[1], x2 = x[2];
    var cb = Math.cos(bKm / R_KM), s = 0, target = q * P.W;
    for (var i = 0, j = 0; i < n; i++, j += 3) {
      if (X[j] * x0 + X[j + 1] * x1 + X[j + 2] * x2 > cb) s += w[i];
    }
    return s >= target;
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalRng(seed) {
    var u = mulberry(seed);
    return function () { return Math.sqrt(-2 * Math.log(u() || 1e-300)) * Math.cos(2 * Math.PI * u()); };
  }

  // Clipped minimax: the point minimising the distance that covers a share q of humanity.
  // Non-smooth, so: best Fibonacci seed, then random refinement with a shrinking step.
  // (numpy's RNG is not reproduced, so the refined point can differ from Python by a little.)
  function* worstOffGen(P, q, nSeeds, seed) {
    nSeeds = nSeeds || 4000;
    var F = fibonacci(nSeeds), best = seedAt(F, 0), b = quantileDistance(best, P, q);
    for (var i = 1; i < nSeeds; i++) {
      var s = seedAt(F, i);
      if (beats(s, P, q, b)) {
        var d = quantileDistance(s, P, q);
        if (d < b) { best = s; b = d; }
      }
      if (i % 200 === 0) yield;
    }
    var rn = normalRng(seed || 0), step = 0.05;
    while (step > 1e-4) {
      var improved = false;
      for (var k = 0; k < 40; k++) {
        var c = unit([best[0] + rn() * step, best[1] + rn() * step, best[2] + rn() * step]);
        if (beats(c, P, q, b)) {
          var cb = quantileDistance(c, P, q);
          if (cb < b) { best = c; b = cb; improved = true; }
        }
      }
      if (!improved) step /= 2;
      yield;
    }
    return { x: best, km: b };
  }

  // ---- k HQs: spherical k-medians ---------------------------------------------------------
  // k-means++-style seeding on population (D^1 weighting, since this is a median), Lloyd
  // iterations with a weighted Weiszfeld per cluster, a few restarts, keep the lowest total.
  function* kMediansGen(P, k, opts) {
    opts = opts || {};
    var restarts = opts.restarts || 4, maxLloyd = opts.lloyd || 25, rnd = mulberry(opts.seed || 7);
    var X = P.xyz, w = P.w, n = P.n;
    var lab = new Int8Array(n), bestLab = null, best = null, D = new Float64Array(n);
    var subX = new Float64Array(3 * n), subW = new Float64Array(n);
    function pick(weights, total) {
      var r = rnd() * total;
      for (var i = 0; i < n; i++) { r -= weights[i]; if (r <= 0) return i; }
      return n - 1;
    }
    function cellAt(i) { return [X[3 * i], X[3 * i + 1], X[3 * i + 2]]; }
    for (var rs = 0; rs < restarts; rs++) {
      var C = [cellAt(pick(w, P.W))];
      while (C.length < k) {
        var tot = 0;
        for (var i = 0; i < n; i++) {
          var mx = -2;
          for (var c = 0; c < C.length; c++) {
            var d = X[3 * i] * C[c][0] + X[3 * i + 1] * C[c][1] + X[3 * i + 2] * C[c][2];
            if (d > mx) mx = d;
          }
          D[i] = w[i] * Math.acos(Math.max(-1, Math.min(1, mx)));
          tot += D[i];
        }
        C.push(cellAt(pick(D, tot)));
      }
      var total = Infinity;
      for (var it = 0; it < maxLloyd; it++) {
        var changed = 0;
        total = 0;
        for (i = 0; i < n; i++) {
          var bi = 0, bd = -2;
          for (c = 0; c < k; c++) {
            var dd = X[3 * i] * C[c][0] + X[3 * i + 1] * C[c][1] + X[3 * i + 2] * C[c][2];
            if (dd > bd) { bd = dd; bi = c; }
          }
          if (lab[i] !== bi || it === 0) { changed++; lab[i] = bi; }
          total += w[i] * Math.acos(Math.max(-1, Math.min(1, bd)));
        }
        if (it > 0 && changed === 0) break;
        for (c = 0; c < k; c++) {
          var m = 0;
          for (i = 0; i < n; i++) if (lab[i] === c) {
            subX[3 * m] = X[3 * i]; subX[3 * m + 1] = X[3 * i + 1]; subX[3 * m + 2] = X[3 * i + 2]; subW[m] = w[i]; m++;
          }
          if (m === 0) { C[c] = cellAt(pick(w, P.W)); continue; }
          var S = makePop(subX.subarray(0, 3 * m), subW.subarray(0, m));
          C[c] = fairPoint(S, 1, C[c], { iters: 40, tol: 1e-10 }).x;
        }
        yield;
      }
      if (total < (best ? best.total : Infinity)) {
        best = { centers: C.map(function (x) { return x.slice(); }), total: total };
        bestLab = lab.slice();
      }
    }
    best.labels = bestLab;
    best.meanKm = best.total / P.W * R_KM;
    return best;
  }

  function run(gen) { var r; do { r = gen.next(); } while (!r.done); return r.value; }

  G.FairSolver = {
    stats: stats,
    R_KM: R_KM, toXYZ: toXYZ, toLatLon: toLatLon, unit: unit, angle: angle, km: km,
    gridXYZ: gridXYZ, makePop: makePop, cost: cost, sumPow: sumPow, centroid: centroid,
    fairPoint: fairPoint, fibonacci: fibonacci,
    fairPointGlobalGen: fairPointGlobalGen, worstOffGen: worstOffGen, kMediansGen: kMediansGen,
    quantileDistance: quantileDistance, beats: beats, run: run,
    fairPointGlobal: function (P, p, n) { return run(fairPointGlobalGen(P, p, n)); },
    worstOffPoint: function (P, q, n, s) { return run(worstOffGen(P, q, n, s)); },
    kMedians: function (P, k, o) { return run(kMediansGen(P, k, o)); },
  };
})(typeof window !== "undefined" ? window : globalThis);
